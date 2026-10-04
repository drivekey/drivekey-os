"""Bounded, appearance-only configuration. No worker or wallet dependencies."""
import json
import os
import re
import stat
import tempfile

PRESETS = {
    'Default': ('#101114','#14151b','#18181f','#292c37','#f4f5f8','#9b9eaf','#7892ff','#22283e'),
    'Charcoal': ('#121212','#181818','#202020','#363636','#f5f5f5','#a3a3a3','#8e9fff','#292b38'),
    'Slate': ('#171a22','#1c202b','#252a38','#393f50','#f1f3fa','#abb2c4','#a7b5ff','#303a56'),
    'Emerald': ('#101714','#141f19','#1b2820','#30463a','#eff9f2','#9db8a7','#64d68b','#213d2d'),
    'Midnight': ('#090912','#11111e','#191928','#303048','#f2efff','#a8a1bd','#aa89ff','#2a2047'),
    'Light': ('#f6f7fb','#ffffff','#eef0f6','#c9cfdd','#202939','#596277','#3854d6','#e5eaff'),
    'Ice': ('#eff6ff','#f9fcff','#e6effa','#bccce1','#20324b','#526884','#315bd2','#dce7ff'),
    'Rose': ('#fff3f8','#fffafd','#f6e9f0','#dbc4d1','#3c2733','#775967','#aa2867','#f7dce9'),
}
ROLES = ('BG','PANEL','FIELD','EDGE','FG','MUTED','ACCENT','ACTIVE')
HEX = re.compile(r'#[0-9a-fA-F]{6}\Z')
FILENAME = 'drivekey-theme.json'

def luminance(color):
    channels = [int(color[i:i+2],16)/255 for i in (1,3,5)]
    linear = [v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in channels]
    return sum(v*w for v,w in zip(linear,(.2126,.7152,.0722)))

def contrast(a,b):
    x,y=sorted((luminance(a),luminance(b)))
    return (y+.05)/(x+.05)

def ink(background):
    return '#ffffff' if contrast(background,'#ffffff')>=contrast(background,'#101114') else '#101114'

def validate(value):
    if not isinstance(value,dict) or set(value)!={'version','base','accent'}:
        raise ValueError('Theme must contain only version, base and accent.')
    if type(value['version']) is not int or value['version']!=1:
        raise ValueError('Unsupported theme version.')
    if not isinstance(value['base'],str) or value['base'] not in PRESETS:
        raise ValueError('Unknown base theme.')
    accent=value['accent']
    if not isinstance(accent,str) or not HEX.fullmatch(accent):
        raise ValueError('Use a six-digit color, such as #7892FF.')
    roles=dict(zip(ROLES,PRESETS[value['base']]))
    if min(contrast(accent,roles[k]) for k in ('BG','PANEL','FIELD'))<3:
        raise ValueError('Choose a color with stronger contrast against this theme.')
    return {'version':1,'base':value['base'],'accent':accent.lower()}

def preset(name):
    return validate({'version':1,'base':name,'accent':PRESETS[name][6]})

def palette(value):
    value=validate(value)
    colors=dict(zip(ROLES,PRESETS[value['base']]))
    colors['ACCENT']=value['accent']
    light=luminance(colors['BG'])>.5
    colors.update(ON='#168253' if light else '#25d9a3',
                  OFF='#bc2853' if light else '#e94b75',
                  WARNING='#875b13' if light else '#e6b36a')
    return colors

def decode(data):
    if len(data)>4096:raise ValueError('Theme file exceeds 4 KB.')
    def unique(pairs):
        result={}
        for key,value in pairs:
            if key in result:raise ValueError('Duplicate theme field.')
            result[key]=value
        return result
    try:return validate(json.loads(data.decode('utf-8'),object_pairs_hook=unique))
    except (UnicodeError,RecursionError,json.JSONDecodeError) as exc:
        raise ValueError('Invalid theme JSON.') from exc

def read_theme(directory):
    path=directory/FILENAME
    if path.is_symlink():raise ValueError('Theme must be a regular file.')
    fd=os.open(path,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0)|getattr(os,'O_NONBLOCK',0))
    with os.fdopen(fd,'rb') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):raise ValueError('Theme must be a regular file.')
        return decode(stream.read(4097))

def write_theme(directory,value):
    data=(json.dumps(validate(value),indent=2)+'\n').encode('utf-8')
    path=directory/FILENAME
    if path.is_symlink() or (path.exists() and not path.is_file()):raise ValueError('Theme destination must be a regular file.')
    fd,temp=tempfile.mkstemp(prefix='.drivekey-theme-',dir=directory)
    try:
        with os.fdopen(fd,'wb') as stream:
            stream.write(data);stream.flush();os.fsync(stream.fileno())
        os.replace(temp,path)
    finally:
        if os.path.exists(temp):os.unlink(temp)
