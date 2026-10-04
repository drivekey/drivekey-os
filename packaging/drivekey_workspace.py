"""Terminal workspace. Presentation and fixed action routing only; no key access."""
import curses
import datetime
import json
import pathlib
import textwrap

SECTIONS=['HOME','VAULTS','REQUESTS','SIGN','FILES','SYSTEM']
PROFILE_LABELS={'eth':'Native ETH / Robinhood','multi':'Multi-chain / ETH + SOL'}
ACTIONS={
 'VAULTS':[('Check vault / password','check'),('Export public wallet file','export'),('Create a vault','create'),
           ('Create encrypted backup','backup'),('Verify encrypted backup','check-backup'),('Restore onto empty target','restore'),('Full public addresses','vault-details')],
 'REQUESTS':[('Inspect and validate request','inspect'),('Review and sign a transaction','sign'),('Refresh file status','refresh')],
 'SIGN':[('Review and sign a transaction','sign'),('Inspect without signing','inspect')],
 'FILES':[('Full file inventory','files'),('Create encrypted backup','backup'),('Verify encrypted backup','check-backup'),
          ('Restore onto empty target','restore'),('Export public wallet file','export')],
 'SYSTEM':[('UTC clock (read only)','clock'),('Device diagnostics','system-details'),('Display settings','display'),
           ('Keyboard shortcuts','shortcuts'),('Safely shut down',6),('Diagnostic shell',-1)]
}
SHORTCUTS=['TAB / LEFT / RIGHT: change section','UP / DOWN: select an action. ENTER opens it.',
 'P: switch between native ETH and multi-chain vault profiles.',
 '/: searchable command palette. ?: this help. D: display settings.',
 'F: full device / public-vault inventory.',
 '1 create ETH vault; 2 sign ETH request; 3 check ETH password.',
 '4 export ETH public file; 5 ETH backups; 6 device help.',
 '7 safe shutdown; 8 multi-chain tools; 9 UTC clock.',
 'Number keys retain their original profile-specific meaning.',
 'ESC cancels a dialog. No Enter shortcut can replace typing SIGN.',
 'Display preferences and activity are session-only. No secrets are recorded.']

def init(t):
    if not hasattr(t,'section'):t.section=0
    if not hasattr(t,'profile'):t.profile='eth'
    if not hasattr(t,'display_mode'):t.display_mode='normal'
    if not hasattr(t,'events'):t.events=[]
    if not hasattr(t,'request_status'):t.request_status={}

def record(t, action, ok):
    init(t)
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%H:%M:%S')
    t.events=(t.events+[(stamp,action,'completed' if ok else 'stopped')])[-4:]

def clip(t,y,x,text,width,attr=0):
    t.put(y,x,str(text)[:max(0,width)],attr)

def para(t,y,x,text,width,limit=3,attr=0):
    t.paragraph(y,x,text,max(1,width),limit,attr)

def icon(t,name,y,x,disabled=False):
    try:art=json.loads((pathlib.Path(__file__).parent/'chain-icons/terminal.json').read_text())[name]
    except (OSError,KeyError,ValueError):art=[name.upper()]
    for row,line in enumerate(art):
        if not t.ascii:line=line.translate(str.maketrans({'.':'░',':':'▒','+':'▓','#':'█'}))
        t.put(y+row,x,line,t.dim if disabled else t.strong)

def background(t,h,w):
    if t.display_mode=='contrast' or t.ascii:return
    # Sparse texture only in the navigation gutter; never behind transaction text.
    for y in range(20,h-7):
        for x in range(2,25):
            if (x*7+y*11)%23==0:t.put(y,x,'·',t.dim)

def info(t,section,y,x,width,height):
    status=getattr(t,'dashboard',None) or {}
    profile=t.profile
    vault=status.get(profile,{})
    lines=[]
    if section=='HOME':
        storage=status.get('storage')
        lines=['DEVICE / EXCHANGE',
               'ETH vault: '+status.get('eth',{}).get('state','unavailable'),
               'Multi vault: '+status.get('multi',{}).get('state','unavailable')]
        if storage:lines += [storage['source']+' / '+storage['filesystem'],
            str(round(storage['availableBytes']/1048576,1))+' MiB free']
        lines+=['Balance unavailable offline.']
    elif section=='VAULTS':
        wallet=vault.get('wallet') or {}
        lines=['PUBLIC IDENTITIES / '+vault.get('state','unavailable'),
               'Parsed metadata; verify with your password.']
        for key in ['address','evmAddress','solanaAddress']:
            if key in wallet:lines += [key, wallet[key]]
        if not wallet:lines+=['No readable public metadata in this profile.']
    elif section in ('REQUESTS','SIGN'):
        lines=['REQUEST / '+status.get('requests',{}).get(profile,'unavailable'),
               t.request_status.get(profile,'Not validated this session.'),
               'Signing always rereads and validates the file.',
               '01  Read every transaction field',
               '02  Type SIGN to approve',
               '03  Unlock locally',
               '04  Save response / not broadcast']
    elif section=='FILES':
        lines=['FIXED EXCHANGE FILES']
        for name,state in status.get('files',{}).items():
            if ('multi' in name)==(profile=='multi'):lines += [name,state]
        lines+=['Public file -> website','Encrypted vault / backup -> keep private']
    else:
        system=status.get('system',{})
        lines=['THIS BOOT',system.get('build','Build unavailable'),
               'Kernel: '+system.get('kernel','unavailable'),
               'Architecture: '+system.get('architecture','unavailable'),
               system.get('isolation','Isolation status unavailable'),
               'UTC only / clock editing disabled']
    row=y
    if section=='VAULTS' and height>=28 and width>=32:
        clip(t,row,x,'PUBLIC IDENTITIES / '+vault.get('state','unavailable'),width,t.strong)
        icon(t,'sol' if profile=='multi' else 'eth',row+2,x+max(0,(width-24)//2))
        row+=15
        lines=lines[1:]
    for value in lines:
        wrapped=textwrap.wrap(value,max(1,width)) or ['']
        for part in wrapped:
            if row>=y+height:
                clip(t,y+height-1,x,'Open details for the complete record.',width,t.dim);return
            clip(t,row,x,part,width,t.strong if row==y else 0);row+=1
        if section in ('VAULTS','FILES','SYSTEM'):row+=1

def choices(t,legacy):
    name=SECTIONS[t.section]
    return [(label,i) for i,label in enumerate(legacy)] if name=='HOME' else ACTIONS[name]

def route(t,value):
    if isinstance(value,tuple):return value
    if isinstance(value,int):return value
    return (value,t.profile=='multi')

def palette(t,legacy):
    entries=[('Quick action '+str(i+1)+' / '+label,i) for i,label in enumerate(legacy)]
    entries += [(label,action) for section in ACTIONS.values() for label,action in section]
    entries += [('Go to '+name,'nav:'+str(i)) for i,name in enumerate(SECTIONS)]
    entries += [('Solana / multi-chain: create vault',('create',True)),('Solana / multi-chain: inspect request',('inspect',True))]
    entries=list(dict.fromkeys(entries))
    query='';index=0
    while True:
        t.frame('COMMAND PALETTE / fixed wallet actions')
        h,w=t.s.getmaxyx()
        if h<24 or w<60:
            t.put(4,2,'Resize to 60 x 24. ESC cancels.');t.s.refresh()
            if t.s.getch() in (27,3):return None
            continue
        filtered=[v for v in entries if query.lower() in v[0].lower()]
        index=min(index,max(0,len(filtered)-1))
        t.put(4,3,'Search > '+query,t.strong)
        size=h-11;start=(index//size)*size
        for row,(label,_) in enumerate(filtered[start:start+size]):
            clip(t,6+row,3,('> ' if start+row==index else '  ')+label,w-6,curses.A_REVERSE if start+row==index else 0)
        if not filtered:t.put(7,3,'No matching action. Nothing will run.')
        t.put(h-3,2,'Type to filter / arrows select / ENTER open / ESC cancel',t.strong)
        t.s.refresh();key=t.s.get_wch()
        if key in ('\x1b','\x03'):return None
        if key in ('\n','\r',curses.KEY_ENTER) and filtered:return filtered[index][1]
        if key==curses.KEY_DOWN and filtered:index=(index+1)%len(filtered)
        elif key==curses.KEY_UP and filtered:index=(index-1)%len(filtered)
        elif key in ('\b','\x7f',curses.KEY_BACKSPACE):query=query[:-1];index=0
        elif isinstance(key,str) and key.isprintable() and len(query)<64:query+=key;index=0

def web_workspace(t,section,items,index,h,w):
    """Website-inspired console layout. No key access or worker operations."""
    width=w-7
    navx=3
    for i,name in enumerate(SECTIONS):
        label=' %02d / %s '%(i+1,name)
        clip(t,4,navx,label,len(label),curses.A_REVERSE|t.strong if i==t.section else t.dim)
        navx+=len(label)+2
    t.rule(6,3,width)
    headings={'HOME':'Your keys. Your signature.', 'VAULTS':'Everything starts with your vault.',
              'REQUESTS':'Inspect before you authorize.', 'SIGN':'Review. Approve. Sign offline.',
              'FILES':'The bridge between two sessions.', 'SYSTEM':'Know your signing environment.'}
    clip(t,8,3,headings[section],width,t.strong)
    clip(t,10,3,'WORKSPACE / '+PROFILE_LABELS[t.profile]+'    [P] switch profile',width,t.dim)
    brandw=28
    actionx=33
    actionw=max(40,(width-brandw-4)//2)
    statex=actionx+actionw+2
    statew=w-4-statex
    top=13
    height=h-top-7
    t.card(top,3,brandw,height,'DRIVEKEY / OS')
    t.card(top,actionx,actionw,height,'01 / '+section.lower())
    t.card(top,statex,statew,height,'02 / device state')
    t.logo(top+2,6,brandw-6,max(3,min(16,height-7)))
    clip(t,top+height-4,6,'LOCAL KEY OPERATIONS',brandw-6,t.strong)
    clip(t,top+height-3,6,'No broadcast from USB.',brandw-6,t.dim)
    start=top+3
    spacing=2 if len(items)*2+4<=height else 1
    for row,(label,_) in enumerate(items):
        selected=row==index
        text=(' > ' if selected else '   ')+label
        clip(t,start+row*spacing,actionx+2,text.ljust(actionw-4),actionw-4,
             curses.A_REVERSE|t.strong if selected else 0)
    bottom=start+len(items)*spacing+1
    if top+height-bottom>=6:
        t.rule(bottom,actionx+2,actionw-4)
        para(t,bottom+2,actionx+3,'ENTER opens an action. Signing needs a separate review and typed approval.',
             actionw-6,max(0,top+height-2-(bottom+2)),t.dim)
    info(t,section,start,statex+2,statew-4,min(height-5,8) if section=='HOME' else height-5)
    if section=='HOME' and height>=20:
        row=top+height-9
        t.rule(row,statex+2,statew-4)
        for offset,line in enumerate(['NETWORK SUPPORT','Robinhood Chain / 4663','ETH / supported ERC-20',
                                      'Solana / SOL + standard SPL','BNB: Unavailable / no signer']):
            clip(t,row+1+offset,statex+2,line,statew-4,t.dim if offset else t.strong)
    clip(t,h-6,3,t.next_action() if section=='HOME' else 'SELECT / '+items[index][0],width,t.strong)

def home(t,legacy,Cancel):
    init(t);index=0
    while True:
        t.frame('OFFLINE WORKSPACE')
        h,w=t.s.getmaxyx()
        if h<24 or w<60:
            para(t,4,2,'Terminal too small. Use at least 60 columns x 24 rows. ESC returns.',w-4,4)
            t.s.refresh()
            if t.s.getch() in (27,3):raise Cancel()
            continue
        large=w>=120 and h>=40 and t.display_mode!='compact'
        section=SECTIONS[t.section]
        items=choices(t,legacy);index=min(index,len(items)-1)
        if large:
            web_workspace(t,section,items,index,h,w)
        else:
            x=3
            for i,name in enumerate(SECTIONS):
                clip(t,4,x,name,len(name),curses.A_REVERSE|t.strong if i==t.section else t.dim);x+=len(name)+2
            clip(t,6,3,'PROFILE: '+PROFILE_LABELS[t.profile]+' [P]',w-6,t.dim)
            start=8
            for row,(label,_) in enumerate(items):
                clip(t,start+row,3,(' > ' if row==index else '   ')+label,w-6,curses.A_REVERSE|t.strong if row==index else 0)
            remaining=h-5-(start+len(items)+1)
            if remaining>=2:
                info(t,section,start+len(items)+1,3,w-6,remaining)
        t.put(h-3,2,'TAB section  ENTER open  / search  ? help  P profile  1-9 quick',t.strong)
        t.s.refresh();t.s.timeout(1000)
        try:key=t.s.getch()
        finally:t.s.timeout(-1)
        if key in (27,3):
            if t.section:t.section=0;index=0;continue
            raise Cancel()
        if key in (ord('a'),ord('A')):return -1
        if ord('1')<=key<=ord('9'):return key-ord('1')
        if key in (ord('p'),ord('P')):t.profile='multi' if t.profile=='eth' else 'eth';index=0
        elif key in (9,curses.KEY_RIGHT,curses.KEY_LEFT,curses.KEY_BTAB):
            t.section=(t.section+(-1 if key in (curses.KEY_LEFT,curses.KEY_BTAB) else 1))%6;index=0
        elif key==curses.KEY_DOWN:index=(index+1)%len(items)
        elif key==curses.KEY_UP:index=(index-1)%len(items)
        elif key in (ord('f'),ord('F')):return ('inventory',False)
        elif key in (ord('d'),ord('D')):return ('display',False)
        elif key==ord('?'):return ('shortcuts',False)
        elif key==ord('/'):
            value=palette(t,legacy)
            if value is None:continue
            if isinstance(value,str) and value.startswith('nav:'):t.section=int(value[4:]);index=0;continue
            return route(t,value)
        elif key in (10,13,curses.KEY_ENTER):
            value=items[index][1]
            if section=='HOME' and t.profile=='multi' and value in range(5):
                return (['create','sign','check','export','backup-menu'][value],True)
            return route(t,value)
