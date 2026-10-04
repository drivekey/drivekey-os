"""Local presentation primitives. Icons read only bundled static PNG assets."""
import pathlib
import time
import tkinter as tk
from PIL import Image, ImageDraw, ImageTk
import drivekey_theme as theme
from drivekey_appearance import ink
from drivekey_theme import shared_font, watch_theme, motion_enabled, BG, PANEL, EDGE, FG, MUTED, ACCENT


def rounded(canvas, x, y, w, h, radius, fill, outline=''):
    width,height=max(1,round(w)),max(1,round(h));scale=3
    image=Image.new('RGB',(width*scale,height*scale),canvas.cget('background'))
    draw=ImageDraw.Draw(image)
    draw.rounded_rectangle((0,0,width*scale-1,height*scale-1),radius=min(radius,width/2,height/2)*scale,fill=fill,outline=outline or None,width=scale)
    canvas.rounded_image=ImageTk.PhotoImage(image.resize((width,height),Image.Resampling.LANCZOS))
    return canvas.create_image(x,y,anchor='nw',image=canvas.rounded_image)



ICON_NAMES = {
    'Home':'house', 'Wallet':'vault', 'Settings':'settings-2', 'Vaults':'vault', 'Requests':'inbox',
    'Review & sign':'file-pen-line', 'Files':'folder-open', 'System':'settings-2',
    'Swap':'arrow-left-right', 'Send':'arrow-up-right', 'Receive':'arrow-down-left',
    'Request':'qr-code', 'Balance':'wallet', 'Eye':'eye', 'EyeOff':'eye-off',
    'User':'user-round', 'ETH':'asset-eth', 'SOL':'asset-sol', 'USDC':'asset-usdc',
    'USDG':'asset-usdg',
    'Key':'key-round', 'Shield':'shield-check', 'Lock':'lock-keyhole', 'USB':'usb',
    'Check':'check', 'History':'history', 'Download':'download', 'Upload':'upload',
    'Husher':'asset-husher', 'Refresh':'refresh-cw', 'Warning':'triangle-alert',
}
_ICON_SOURCE = {}


def icon(c,name,x,y,color,size=24):
    filename=ICON_NAMES[name]
    if filename not in _ICON_SOURCE:
        with Image.open(pathlib.Path(__file__).with_name('ui-icons')/(filename+'.png')) as source:
            _ICON_SOURCE[filename]=source.convert('RGBA')
    key=(name,color,size)
    # Keep Tk image references on their canvas, so repainting does not lose them.
    if not hasattr(c,'icon_images'):c.icon_images={}
    if key not in c.icon_images:
        source=_ICON_SOURCE[filename].resize((size,size),Image.Resampling.LANCZOS)
        if not filename.startswith('asset-'):
            tinted=Image.new('RGBA',source.size,color)
            tinted.putalpha(source.getchannel('A'));source=tinted
        c.icon_images[key]=ImageTk.PhotoImage(source,master=c)
    return c.create_image(x,y,anchor='nw',image=c.icon_images[key])


def sync_palette():
    globals().update({key:getattr(theme,key) for key in ('BG','PANEL','FIELD','EDGE','FG','MUTED','ACCENT','ON','OFF')})

sync_palette()


class PillButton(tk.Canvas):
    """A compact wrapping button; the historical class name keeps existing callers compatible."""
    def __init__(self,parent,text,command,primary=False,compact=False,icon_name=None,width=None,height=None,align='center',icon_color=None):
        if align not in ('center','left'):raise ValueError('Button alignment must be center or left')
        self.values={'text':text,'bg':ACCENT if primary else FIELD,'fg':ink(ACCENT) if primary else FG,'state':'normal','align':align,'outline':EDGE,'icon_color':icon_color,'indicator':None}
        self.command=command;self.icon_name=icon_name;self.compact=compact;self.fixed_width=width;self.fixed_height=height;self.focused=False;self.hover=False
        self.motion_timer=None;self.motion_frames=0;self.visual_bg=self.values['bg']
        super().__init__(parent,bg=parent.cget('bg'),highlightthickness=0,bd=0,takefocus=True,cursor='hand2')
        self.typeface=shared_font(self,10 if compact else 11,bold=True)
        watch_theme(self)
        self.bind('<Configure>',self.resized);self.bind('<Button-1>',self.pressed)
        self.bind('<Return>',self.keyboard);self.bind('<space>',self.keyboard)
        self.bind('<FocusIn>',lambda e:self.focus_change(True));self.bind('<FocusOut>',lambda e:self.focus_change(False))
        self.bind('<Enter>',lambda e:self.hover_change(True));self.bind('<Leave>',lambda e:self.hover_change(False))
        self.bind('<<DriveKeyThemeChanged>>',lambda e:self.measure())
        self.parent_configure=parent.bind('<Configure>',lambda e:self.measure(),add='+')
        self.bind('<Destroy>',self.cleanup,add='+')
        self.measure()

    def cleanup(self,event):
        if event.widget is self:
            self.stop_motion()
            try:self.master.unbind('<Configure>',self.parent_configure)
            except tk.TclError:pass

    def wrapped_text(self,width):
        """Wrap even unbroken labels instead of clipping controls on small screens."""
        available=max(16,width-(42 if self.icon_name else 20))
        lines=[]
        for paragraph in self.values['text'].split('\n'):
            line=''
            for word in paragraph.split(' '):
                candidate=(line+' '+word).strip()
                if line and self.typeface.measure(candidate)>available:
                    lines.append(line);line=''
                while self.typeface.measure(word)>available and len(word)>1:
                    split=1
                    while split<len(word) and self.typeface.measure(word[:split+1])<=available:split+=1
                    lines.append(word[:split]);word=word[split:]
                line=(line+' '+word).strip()
            lines.append(line)
        return '\n'.join(lines)

    def desired_height(self,width):
        lines=self.wrapped_text(width).count('\n')+1
        return self.fixed_height or max(26 if self.compact else 30,lines*self.typeface.metrics('linespace')+10)

    def measure(self):
        width=self.fixed_width or max(32,max(self.typeface.measure(line) for line in self.values['text'].split('\n'))+(42 if self.icon_name else 24))
        if self.fixed_width is None and self.master.winfo_width()>2:
            width=min(width,max(32,self.master.winfo_width()))
        super().configure(width=width,height=self.desired_height(width))
        self.paint()

    def resized(self,event):
        height=self.desired_height(event.width)
        if self.fixed_height is None and int(super().cget('height'))!=height:super().configure(height=height)
        self.paint()

    def configure(self,cnf=None,**kw):
        if cnf:kw.update(cnf)
        reset_motion='bg' in kw or 'state' in kw
        if 'align' in kw and kw['align'] not in ('center','left'):raise ValueError('Button alignment must be center or left')
        for key in list(kw):
            if key in self.values:self.values[key]=kw.pop(key)
        for key in ('anchor','highlightbackground','highlightcolor','padx','pady'):kw.pop(key,None)
        if 'width' in kw:self.fixed_width=kw.pop('width')
        if 'height' in kw:self.fixed_height=kw.pop('height')
        if kw:super().configure(**kw)
        super().configure(takefocus=self.values['state']!='disabled',cursor='arrow' if self.values['state']=='disabled' else 'hand2')
        if reset_motion:
            self.stop_motion();self.visual_bg=self.values['bg']
        self.measure()
    config=configure
    def cget(self,key):return self.values[key] if key in self.values else super().cget(key)
    def focus_change(self,value):self.focused=value;self.paint()
    def theme_changed(self):self.measure()
    def blend(self,start,end,fraction):
        a=self.winfo_rgb(start);b=self.winfo_rgb(end)
        return '#'+''.join('%02x'%round((x+(y-x)*fraction)/257) for x,y in zip(a,b))
    def stop_motion(self):
        if self.motion_timer is not None:
            try:self.after_cancel(self.motion_timer)
            except tk.TclError:pass
            self.motion_timer=None
    def hover_target(self):
        return self.blend(self.values['bg'],FG,.07) if self.hover and self.values['state']!='disabled' else self.values['bg']
    def motion_changed(self):
        if not motion_enabled():
            self.stop_motion();self.visual_bg=self.hover_target();self.paint()
    def hover_change(self,value):
        self.hover=value;self.stop_motion();target=self.hover_target()
        if not motion_enabled() or self.values['state']=='disabled':
            self.visual_bg=target;self.paint();return
        start=self.visual_bg;started=time.monotonic()
        def frame():
            self.motion_timer=None
            if not self.winfo_exists():return
            if not motion_enabled() or self.values['state']=='disabled':
                self.visual_bg=self.hover_target();self.paint();return
            elapsed=min(1.,(time.monotonic()-started)/.12)
            eased=1-(1-elapsed)**3
            self.visual_bg=self.blend(start,target,eased);self.motion_frames+=1;self.paint()
            if elapsed<1:self.motion_timer=self.after(15,frame)
        frame()
    def pressed(self,event):
        if self.values['state']!='disabled':self.focus_set();self.invoke()
        return 'break'
    def keyboard(self,event):
        self.invoke()
        return 'break'
    def invoke(self):
        if self.values['state']!='disabled':return self.command()
    def paint(self):
        self.delete('all');w=self.winfo_width();h=self.winfo_height()
        if w<2:return
        disabled=self.values['state']=='disabled';bg=self.visual_bg;fg=MUTED if disabled else self.values['fg']
        border=(FG if self.values['bg']==ACCENT else ACCENT) if self.focused else MUTED if self.hover and not disabled else self.values['outline']
        rounded(self,1,1,w-2,h-2,min(5,h/2),bg,border)
        glyph=16 if self.typeface.metrics('linespace')>18 else 14
        if self.icon_name:icon(self,self.icon_name,(w-glyph)/2 if not self.values['text'] else 10,(h-glyph)/2,MUTED if disabled else self.values['icon_color'] or fg,size=glyph)
        if self.values['indicator']:self.create_line(2,h/2-7,2,h/2+7,fill=self.values['indicator'],width=2)
        if self.values['text']:
            left=self.values['align']=='left'
            x=(32 if self.icon_name else 10) if left else w/2+(10 if self.icon_name else 0)
            self.create_text(x,h/2,text=self.wrapped_text(w),font=self.typeface,fill=fg,justify='left' if left else 'center',anchor='w' if left else 'center',tags='label')


class Toggle(tk.Checkbutton):
    """Native accessible checkbutton behavior with a locally rendered switch image."""
    def __init__(self,parent,text='',variable=None,command=None,accent=None,**kw):
        self.switch_variable=variable if variable is not None else tk.BooleanVar(master=parent,value=False)
        self.accent=ON if accent is None else accent;self.switch_image=None;self.ready=False
        self.motion_timer=None;self.motion_frames=0
        defaults=dict(bg=parent.cget('bg'),fg=FG,activebackground=parent.cget('bg'),activeforeground=FG,
                      selectcolor=parent.cget('bg'),font=shared_font(parent,11,True),relief='flat',offrelief='flat',
                      overrelief='flat',bd=0,padx=0,pady=4,highlightthickness=1,highlightbackground=parent.cget('bg'),
                      highlightcolor=ACCENT,takefocus=True,cursor='hand2',anchor='w')
        defaults.update(kw)
        super().__init__(parent,text=text,variable=self.switch_variable,command=command,indicatoron=False,
                         compound='right',onvalue=True,offvalue=False,**defaults)
        self.ready=True;watch_theme(self)
        self.thumb_position=1. if self.selected() else 0.
        self.visual_track=ON if self.selected() else OFF
        self.trace=self.switch_variable.trace_add('write',lambda *args:self.selection_changed())
        self.bind('<Configure>',lambda event:self.render_switch())
        self.bind('<Return>',self.keyboard);self.bind('<space>',self.keyboard)
        self.bind('<<DriveKeyThemeChanged>>',lambda event:self.render_switch())
        self.bind('<Destroy>',self.cleanup,add='+');self.render_switch()
    def keyboard(self,event):
        self.invoke();return 'break'
    def theme_changed(self):self.render_switch()
    def selected(self):return bool(self.tk.getboolean(self.switch_variable.get()))
    def stop_motion(self):
        if self.motion_timer is not None:
            try:self.after_cancel(self.motion_timer)
            except tk.TclError:pass
            self.motion_timer=None
    def settle(self):
        self.stop_motion();self.thumb_position=1. if self.selected() else 0.
        self.visual_track=ON if self.selected() else OFF;self.render_switch()
    def motion_changed(self):
        if not motion_enabled():self.settle()
    def selection_changed(self):
        self.stop_motion()
        if not motion_enabled() or str(super().cget('state'))=='disabled':self.settle();return
        start=self.thumb_position;target=1. if self.selected() else 0.
        source_color=self.winfo_rgb(self.visual_track);target_color=self.winfo_rgb(ON if self.selected() else OFF)
        started=time.monotonic()
        def frame():
            self.motion_timer=None
            if not self.winfo_exists():return
            if not motion_enabled() or str(self.cget('state'))=='disabled':self.settle();return
            elapsed=min(1.,(time.monotonic()-started)/.12);eased=1-(1-elapsed)**3
            self.thumb_position=start+(target-start)*eased
            self.visual_track='#'+''.join('%02x'%round((a+(b-a)*eased)/257) for a,b in zip(source_color,target_color))
            self.motion_frames+=1;self.render_switch()
            if elapsed<1:self.motion_timer=self.after(15,frame)
        frame()
    def configure(self,cnf=None,**kw):
        if cnf:kw.update(cnf)
        if 'accent' in kw:self.accent=kw.pop('accent')
        result=super().configure(**kw)
        if self.ready:self.settle()
        return result
    config=configure
    def render_switch(self):
        if not self.winfo_exists():return
        disabled=str(super().cget('state'))=='disabled'
        height=20 if shared_font(self,11,True).metrics('linespace')>18 else 16;width=height*2
        # Reserve the row width after the native text so switches align at right.
        image_width=max(width+12,self.winfo_width()-shared_font(self,11,True).measure(str(self.cget('text')))-12)
        scale=3;image=Image.new('RGBA',(image_width*scale,(height+4)*scale),(0,0,0,0));draw=ImageDraw.Draw(image)
        track=EDGE if disabled else self.visual_track
        x,y=(image_width-width)*scale,2*scale
        draw.rounded_rectangle((x,y,image_width*scale-1,(height+2)*scale-1),radius=height*scale/2,fill=track)
        inset=3*scale;diameter=(height-6)*scale
        knob_x=x+(width-height)*scale*self.thumb_position+inset
        draw.ellipse((knob_x,y+inset,knob_x+diameter,y+inset+diameter),fill=MUTED if disabled else FG)
        self.switch_image=ImageTk.PhotoImage(image.resize((image_width,height+4),Image.Resampling.LANCZOS),master=self)
        super().configure(image=self.switch_image,takefocus=not disabled,cursor='arrow' if disabled else 'hand2')
    def cleanup(self,event):
        if event.widget is self:
            self.stop_motion()
            try:self.switch_variable.trace_remove('write',self.trace)
            except tk.TclError:pass


class SlimScrollbar(tk.Canvas):
    """Small themed scrollbar with click/drag behavior on all Tk platforms."""
    def __init__(self,parent,command,**kw):
        self.command=command;self.first=0.;self.last=1.;self.drag_offset=None
        super().__init__(parent,width=8,bg=parent.cget('bg'),highlightthickness=0,bd=0,takefocus=False)
        self.bind('<Configure>',lambda e:self.paint())
        self.bind('<Button-1>',self.press);self.bind('<B1-Motion>',self.drag)
        self.bind('<ButtonRelease-1>',lambda e:setattr(self,'drag_offset',None))
    def set(self,first,last):
        self.first=float(first);self.last=float(last);self.paint()
    def geometry(self):
        height=max(1,self.winfo_height());length=max(24,height*(self.last-self.first))
        travel=max(1,height-length);maximum=max(.0001,1-(self.last-self.first))
        return height,length,travel,maximum,self.first/maximum*travel
    def paint(self):
        self.delete('all')
        if self.last-self.first>=.999:return
        _,length,_,_,top=self.geometry()
        self.create_line(4,top+3,4,top+length-3,fill=EDGE,width=4,capstyle='round')
    def press(self,event):
        _,length,_,_,top=self.geometry()
        self.drag_offset=event.y-top if top<=event.y<=top+length else length/2
        self.drag(event)
    def drag(self,event):
        if self.drag_offset is None or self.last-self.first>=.999:return
        _,_,travel,maximum,_=self.geometry()
        self.command('moveto',max(0,min(maximum,(event.y-self.drag_offset)/travel*maximum)))


class Surface(tk.Canvas):
    def __init__(self,parent,color=None,border=None,radius=8,padding=16,accent=None,accent_side='top'):
        color=PANEL if color is None else color
        border=EDGE if border is None else border
        if accent_side not in ('top','left'):raise ValueError('Surface accent side must be top or left')
        super().__init__(parent,bg=parent.cget('bg'),highlightthickness=0,bd=0,height=1)
        self.color=color;self.border=border;self.radius=radius;self.padding=padding;self.stretch=False;self.accent=accent;self.accent_side=accent_side
        self.inner=tk.Frame(self,bg=color)
        self.window=self.create_window(padding,padding,anchor='nw',window=self.inner)
        self.inner.bind('<Configure>',self.fit);self.bind('<Configure>',self.fit)
    def fit(self,event=None):
        width=self.winfo_width();height=self.winfo_height() if self.stretch else self.inner.winfo_reqheight()+self.padding*2
        if not self.stretch and int(self.cget('height'))!=height:self.configure(height=height)
        self.itemconfigure(self.window,width=max(1,width-self.padding*2))
        if self.stretch:self.itemconfigure(self.window,height=max(1,height-self.padding*2))
        self.delete('surface');shape=rounded(self,1,1,max(1,width-2),max(1,height-2),self.radius,self.color,self.border)
        self.addtag_withtag('surface',shape);self.tag_lower('surface')
        if self.accent:
            if self.accent_side=='left':line=self.create_line(2,self.radius,2,max(self.radius,height-self.radius),fill=self.accent,width=3,tags='surface')
            else:line=self.create_line(self.radius,2,max(self.radius,width-self.radius),2,fill=self.accent,width=3,tags='surface')
            self.tag_lower(line,self.window)
