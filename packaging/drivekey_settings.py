"""Offline appearance modal. The in-memory backdrop is captured only from a non-secret view."""
import os
import pathlib
import time
import tkinter as tk
from PIL import Image, ImageFilter, ImageTk
import drivekey_theme as theme
from drivekey_appearance import PRESETS, palette, preset, validate, read_theme, write_theme, FILENAME
from drivekey_widgets import PillButton, Toggle, SlimScrollbar, icon


def capture_window(root):
    """Capture this app only on Windows; the fullscreen offline X11 app on Linux."""
    width,height=root.winfo_width(),root.winfo_height()
    if os.name!='nt':
        from PIL import ImageGrab
        x,y=root.winfo_rootx(),root.winfo_rooty()
        return ImageGrab.grab(bbox=(x,y,x+width,y+height),xdisplay=os.environ.get('DISPLAY')).convert('RGB')
    import ctypes
    from ctypes import wintypes as w
    u=ctypes.windll.user32;g=ctypes.windll.gdi32
    u.GetParent.argtypes=[w.HWND];u.GetParent.restype=w.HWND
    u.GetWindowDC.argtypes=[w.HWND];u.GetWindowDC.restype=w.HDC
    u.PrintWindow.argtypes=[w.HWND,w.HDC,w.UINT];u.PrintWindow.restype=w.BOOL
    u.ReleaseDC.argtypes=[w.HWND,w.HDC]
    g.CreateCompatibleDC.argtypes=[w.HDC];g.CreateCompatibleDC.restype=w.HDC
    g.CreateCompatibleBitmap.argtypes=[w.HDC,ctypes.c_int,ctypes.c_int];g.CreateCompatibleBitmap.restype=w.HBITMAP
    g.SelectObject.argtypes=[w.HDC,w.HGDIOBJ];g.SelectObject.restype=w.HGDIOBJ
    g.DeleteObject.argtypes=[w.HGDIOBJ];g.DeleteDC.argtypes=[w.HDC]
    class Header(ctypes.Structure):
        _fields_=[('size',w.DWORD),('width',w.LONG),('height',w.LONG),('planes',w.WORD),('bits',w.WORD),('compression',w.DWORD),('imageSize',w.DWORD),('xppm',w.LONG),('yppm',w.LONG),('colors',w.DWORD),('important',w.DWORD)]
    g.GetDIBits.argtypes=[w.HDC,w.HBITMAP,w.UINT,w.UINT,ctypes.c_void_p,ctypes.c_void_p,w.UINT]
    handle=u.GetParent(root.winfo_id()) or root.winfo_id()
    source=u.GetWindowDC(handle);target=g.CreateCompatibleDC(source);bitmap=g.CreateCompatibleBitmap(source,width,height)
    original=g.SelectObject(target,bitmap)
    try:
        if not u.PrintWindow(handle,target,2):raise RuntimeError('Application capture unavailable')
        pixels=ctypes.create_string_buffer(width*height*4)
        header=Header(ctypes.sizeof(Header),width,-height,1,32,0,len(pixels),0,0,0,0)
        if g.GetDIBits(target,bitmap,0,height,pixels,ctypes.byref(header),0)!=height:raise RuntimeError('Application capture incomplete')
        return Image.frombytes('RGB',(width,height),pixels.raw,'raw','BGRX')
    finally:
        g.SelectObject(target,original);g.DeleteObject(bitmap);g.DeleteDC(target);u.ReleaseDC(handle,source)


class SettingsModal:
    def __init__(self,app):
        if app.busy or app.mode!='section' or app.review or app.approved or app.action or app.passphrase.get() or app.confirmation.get():
            raise RuntimeError('Settings unavailable during a protected operation')
        self.app=app;self.root=app.root;self.previous_focus=self.root.focus_get()
        self.scroll_position=app.canvas.yview()[0];self.tab='Theme';self.error='';self.timer=None
        self.blurred=None;self.blur_available=False;self.controls={};self.window=None
        # Never saved to disk; the original is released immediately after blurring.
        try:
            capture=capture_window(self.root)
            self.blurred=Image.blend(capture.filter(ImageFilter.GaussianBlur(6)),Image.new('RGB',capture.size,theme.BG),.36)
            del capture
            self.blur_available=True
        except (OSError,RuntimeError,tk.TclError):
            self.blurred=Image.new('RGB',(self.root.winfo_width(),self.root.winfo_height()),theme.BG)
        self.window=tk.Toplevel(self.root);self.window.withdraw();self.window.overrideredirect(True)
        self.window.transient(self.root);self.window.configure(bg=theme.BG)
        self.window.bind('<Escape>',lambda e:self.close())
        self.window.bind('<Tab>',lambda e:self.cycle_focus(e,1))
        if os.name!='nt':self.window.bind('<ISO_Left_Tab>',lambda e:self.cycle_focus(e,-1))
        self.window.bind('<Shift-Tab>',lambda e:self.cycle_focus(e,-1))
        self.window.bind('<FocusIn>',self.reveal_focus,add='+')
        self.back=tk.Label(self.window,bd=0);self.back.place(x=0,y=0,relwidth=1,relheight=1)
        self.panel=None;self.dimensions=None
        self.root_binding=self.root.bind('<Configure>',self.root_resize,add='+')
        self.layout();self.render()
        self.window.deiconify();self.window.lift();self.window.grab_set()
        self.animate_open()
        self.window.after_idle(lambda:self.done.focus_set() if self.window and self.window.winfo_exists() else None)

    def root_resize(self,event):
        if event.widget is self.root:self.layout()

    def animate_open(self):
        if self.app.reduced_motion.get():return
        started=time.monotonic()
        def frame():
            self.timer=None
            if not self.window:return
            fraction=min(1.,(time.monotonic()-started)/.15)
            self.panel.place_configure(y=round(8*(1-fraction)**3))
            if fraction<1 and not self.app.reduced_motion.get():self.timer=self.window.after(15,frame)
        frame()

    def layout(self):
        if not self.window:return
        width,height=self.root.winfo_width(),self.root.winfo_height()
        self.window.geometry('%dx%d+%d+%d'%(width,height,self.root.winfo_rootx(),self.root.winfo_rooty()))
        if self.dimensions==(width,height):return
        self.dimensions=(width,height)
        self.back_image=ImageTk.PhotoImage(self.blurred.resize((width,height),Image.Resampling.LANCZOS),master=self.window)
        self.back.configure(image=self.back_image)
        if self.panel:self.place_panel()

    def place_panel(self):
        width,height=self.dimensions
        self.panel.place(relx=.5,rely=.5,anchor='center',width=min(760,width-32),height=min(610,height-32))

    def text(self,parent,text,size=10,color=None,bold=False):
        label=tk.Label(parent,text=text,bg=parent.cget('bg'),fg=color or theme.FG,
                       font=theme.shared_font(self.root,size,bold),anchor='w',justify='left')
        label.pack(fill='x',pady=(0,6))
        label.bind('<Configure>',lambda e:label.configure(wraplength=max(40,e.width-4)))
        return label

    def button(self,parent,text,command,primary=False,icon_name=None):
        b=PillButton(parent,text,command,primary=primary,compact=True,icon_name=icon_name)
        self.controls[text]=b
        return b

    def render(self,keep_scroll=False):
        position=self.canvas.yview()[0] if keep_scroll and hasattr(self,'canvas') else 0
        if self.panel:self.panel.destroy()
        self.controls={}
        self.panel=tk.Frame(self.window,bg=theme.PANEL,highlightthickness=1,highlightbackground=theme.EDGE)
        self.place_panel()
        head=tk.Frame(self.panel,bg=theme.PANEL,padx=16,pady=10);head.pack(fill='x')
        self.heading=self.text(head,'Settings',11,bold=True);self.heading.pack_forget();self.heading.pack(side='left')
        self.button(head,'×',self.close).pack(side='right')
        tk.Frame(self.panel,bg=theme.EDGE,height=1).pack(fill='x')
        footer=tk.Frame(self.panel,bg=theme.PANEL,padx=16,pady=12);footer.pack(side='bottom',fill='x')
        self.done=self.button(footer,'Done',self.close);self.done.configure(bg=theme.FG,fg=theme.BG,outline=theme.FG);self.done.pack(side='right')
        self.button(footer,'Import',self.import_theme,icon_name='Download').pack(side='left',padx=(0,8))
        self.button(footer,'Export',self.export_theme,icon_name='Upload').pack(side='left')
        tk.Frame(self.panel,bg=theme.EDGE,height=1).pack(side='bottom',fill='x')
        middle=tk.Frame(self.panel,bg=theme.PANEL);middle.pack(fill='both',expand=True)
        sidebar=tk.Frame(middle,bg=theme.PANEL,width=156);sidebar.pack(side='left',fill='y');sidebar.pack_propagate(False)
        tk.Frame(middle,bg=theme.EDGE,width=1).pack(side='left',fill='y')
        for category,tabs in [('Appearance',('Theme','Style')),('Session',('Session','About'))]:
            group=tk.Frame(sidebar,bg=theme.PANEL,padx=10,pady=10);group.pack(fill='x')
            self.text(group,category,9,theme.MUTED).pack_configure(padx=8)
            for name in tabs:
                b=self.button(group,name,lambda n=name:self.select(n),icon_name={'Theme':'Settings','Style':'Eye','Session':'Shield','About':'USB'}[name])
                b.configure(bg=theme.ACTIVE if name==self.tab else theme.PANEL,fg=theme.FG if name==self.tab else theme.MUTED,outline='',align='left',indicator=theme.ACCENT if name==self.tab else None)
                b.pack(fill='x',pady=2)
        viewport=tk.Frame(middle,bg=theme.PANEL);viewport.pack(fill='both',expand=True)
        self.canvas=tk.Canvas(viewport,bg=theme.PANEL,width=1,bd=0,highlightthickness=0)
        scrollbar=SlimScrollbar(viewport,command=self.canvas.yview)
        scrollbar.pack(side='right',fill='y');self.canvas.pack(side='left',fill='both',expand=True)
        self.canvas.configure(yscrollcommand=scrollbar.set)
        self.content=tk.Frame(self.canvas,bg=theme.PANEL,padx=16,pady=16)
        item=self.canvas.create_window(0,0,anchor='nw',window=self.content)
        self.canvas.bind('<Configure>',lambda e:self.canvas.itemconfigure(item,width=e.width))
        self.content.bind('<Configure>',lambda e:self.canvas.configure(scrollregion=(0,0,self.canvas.winfo_width(),self.content.winfo_reqheight())))
        {'Theme':self.theme_page,'Style':self.style_page,'Session':self.session_page,'About':self.about_page}[self.tab]()
        if self.error:self.text(self.content,self.error,10,theme.MUTED)
        self.window.update_idletasks();self.canvas.yview_moveto(position)

    def select(self,name):
        name={'Display':'Theme'}.get(name,name)
        if name not in ('Theme','Style','Session','About'):raise ValueError('Unknown settings tab')
        self.tab=name;self.error='';self.render();self.controls[name].focus_set()

    def theme_page(self):
        self.tiles={};grid=tk.Frame(self.content,bg=theme.PANEL);grid.pack(fill='x',pady=(0,20))
        for col in range(3):grid.columnconfigure(col,weight=1,uniform='themes')
        chosen=self.app.appearance
        custom=chosen['accent']!=PRESETS[chosen['base']][6]
        for i,name in enumerate((*PRESETS,'Custom')):
            colors=palette(chosen if name=='Custom' else preset(name))
            selected=(custom and name=='Custom') or (not custom and name==chosen['base'])
            tile=tk.Canvas(grid,bg=theme.FIELD,width=1,highlightthickness=0,height=100,takefocus=True,cursor='hand2')
            tile.grid(row=i//3,column=i%3,sticky='ew',padx=(0,8 if i%3<2 else 0),pady=(0,10))
            self.tiles[name]=tile
            def paint(event=None,t=tile,n=name,c=colors,active=selected):
                t.delete('all');w=t.winfo_width();h=t.winfo_height()
                focused=t.focus_get() is t
                t.create_rectangle(2,2,w-3,h-25,fill=c['BG'],outline=theme.ACCENT if active or focused else theme.EDGE,width=2 if active or focused else 1)
                t.create_rectangle(4,4,w-5,19,fill=c['FIELD'],outline='')
                t.create_rectangle(w-25,8,w-19,14,fill=c['ACCENT'],outline='')
                t.create_rectangle(w-15,8,w-9,14,fill=c['MUTED'],outline='')
                t.create_rectangle(10,25,22,h-27,fill=c['FIELD'],outline='')
                for y,length,color in [(32,.5,c['FG']),(40,.67,c['MUTED']),(48,.34,c['MUTED'])]:
                    t.create_line(29,y,max(30,w*length),y,fill=color,width=3)
                t.create_text(w/2,h-12,text=n,fill=theme.FG if active else theme.MUTED,font=theme.shared_font(self.root,9,True))
            tile.bind('<Configure>',paint);tile.bind('<FocusIn>',paint);tile.bind('<FocusOut>',paint)
            def choose(event=None,n=name):
                if n=='Custom':self.color_entry.focus_set();self.color_entry.selection_range(0,'end')
                else:self.change_theme(preset(n))
                return 'break'
            tile.bind('<Button-1>',choose);tile.bind('<Return>',choose);tile.bind('<space>',choose)
        self.text(self.content,'Primary color',10,bold=True)
        line=tk.Frame(self.content,bg=theme.PANEL);line.pack(fill='x',pady=(4,8))
        self.color_value=tk.StringVar(value=chosen['accent'].upper())
        self.color_entry=tk.Entry(line,textvariable=self.color_value,bg=theme.FIELD,fg=theme.FG,insertbackground=theme.FG,
              relief='flat',highlightthickness=1,highlightbackground=theme.EDGE,highlightcolor=theme.ACCENT,font=theme.shared_font(self.root,10))
        self.color_entry.pack(side='left',fill='x',expand=True,ipady=7)
        self.color_entry.bind('<Return>',lambda e:self.apply_custom())
        self.button(line,'Apply',self.apply_custom).pack(side='left',padx=8)
        self.button(line,'Reset',lambda:self.change_theme(preset(chosen['base']))).pack(side='left')
        self.text(self.content,'Session only · Import/export '+FILENAME,9,theme.MUTED)

    def change_theme(self,value):
        value=validate(value);self.app.apply_appearance(value);self.error='';self.render()
        self.root_binding=self.root.bind('<Configure>',self.root_resize,add='+')
        self.done.focus_set()

    def apply_custom(self):
        try:self.change_theme(dict(self.app.appearance,accent=self.color_value.get().strip()))
        except ValueError as exc:self.error=str(exc);self.render();self.color_entry.focus_set()

    def import_theme(self):
        try:
            value=read_theme(pathlib.Path('/mnt/drivekey/DriveKey'))
            self.change_theme(value);self.error='Theme imported.'
        except (ValueError,OSError) as exc:self.error='Import failed. '+str(exc)
        self.render(keep_scroll=True);self.done.focus_set()

    def export_theme(self):
        try:
            write_theme(pathlib.Path('/mnt/drivekey/DriveKey'),self.app.appearance)
            self.error='Saved '+FILENAME+'. Appearance only.'
        except (ValueError,OSError) as exc:self.error='Export failed. '+str(exc)
        self.render(keep_scroll=True);self.done.focus_set()

    def style_page(self):
        self.text(self.content,'Interface font',10,bold=True)
        row=tk.Frame(self.content,bg=theme.PANEL);row.pack(fill='x',pady=(0,16))
        for family in ('Inter','Nunito'):
            self.button(row,family,lambda f=family:self.font(f),primary=self.app.font_family.get()==family).pack(side='left',padx=(0,8))
        for title,var,note in [('Larger text',self.app.large_text,'Scale text and controls together.'),
                               ('Reduced motion',self.app.reduced_motion,'Keep transitions still.'),
                               ('Low effects',self.app.low_effects,'Use a plain background.')]:
            row=tk.Frame(self.content,bg=theme.PANEL,pady=10);row.pack(fill='x')
            switch=Toggle(row,text=title,variable=var,command=self.app.apply_preferences)
            switch.pack(fill='x');self.controls[title]=switch
            self.text(row,note,9,theme.MUTED)
            tk.Frame(self.content,bg=theme.EDGE,height=1).pack(fill='x')
        self.text(self.content,'Review and signing always remain still.',9,theme.MUTED).pack_configure(pady=(14,6))
        self.button(self.content,'Reset display',self.app.reset_preferences).pack(anchor='w',pady=8)

    def font(self,family):
        self.app.select_font(family);self.render(keep_scroll=True);self.controls[family].focus_set()

    def session_action(self,action):
        self.close();action()

    def session_page(self):
        self.text(self.content,'Observed system state',11,bold=True)
        for key,value in self.app.inventory.get('system',{}).items():
            self.text(self.content,self.app.field_name(key),9,theme.MUTED)
            self.text(self.content,str(value),10)
        for title,action in [('UTC clock (read only)',self.app.clock_form),('Refresh status',self.app.refresh),('Safe shutdown',self.app.shutdown),('Terminal recovery',self.app.recovery)]:
            self.button(self.content,title,lambda a=action:self.session_action(a)).pack(fill='x',pady=6)

    def about_page(self):
        self.text(self.content,'DriveKey · RC20 Warsaw RTC',16,bold=True)
        self.text(self.content,'Private offline signing preview',10,theme.MUTED)
        self.text(self.content,'Signing saves a response. Verify and explicitly submit it in the connected app. A saved response does not prove confirmation.',11)
        self.text(self.content,'Windows / Warsaw hardware clock converts to UTC at startup. Clock editing is disabled. Existing signing formats remain supported. Online execution and Husher privacy remain unverified.',10,theme.MUTED)
        self.text(self.content,'Inter / Nunito · SIL Open Font License\nAll fonts and icons are bundled locally.',9,theme.MUTED)

    def focusable(self,parent=None):
        result=[]
        for child in (parent or self.panel).winfo_children():
            try:
                if child.winfo_ismapped() and str(child.cget('takefocus')) in ('1','true') and str(child.cget('state'))!='disabled':result.append(child)
            except tk.TclError:
                try:
                    if child.winfo_ismapped() and str(child.cget('takefocus')) in ('1','true'):result.append(child)
                except tk.TclError:pass
            if isinstance(child,tk.Entry) and child.winfo_ismapped() and child not in result:result.append(child)
            result.extend(self.focusable(child))
        return result

    def cycle_focus(self,event,direction):
        items=self.focusable()
        if items:
            current=self.window.focus_get();index=items.index(current) if current in items else (-1 if direction>0 else 0)
            items[(index+direction)%len(items)].focus_set()
        return 'break'

    def reveal_focus(self,event):
        if not hasattr(self,'content') or not str(event.widget).startswith(str(self.content)):return
        self.window.update_idletasks()
        y=event.widget.winfo_rooty()-self.content.winfo_rooty();top=self.canvas.canvasy(0)
        height=self.canvas.winfo_height();total=max(1,self.content.winfo_height())
        if y<top:self.canvas.yview_moveto(max(0,y-8)/total)
        elif y+event.widget.winfo_height()>top+height:self.canvas.yview_moveto(max(0,y+event.widget.winfo_height()-height+8)/total)

    def close(self):
        if not self.window:return 'break'
        if self.timer is not None:self.window.after_cancel(self.timer);self.timer=None
        self.root.unbind('<Configure>',self.root_binding)
        self.window.grab_release();self.window.destroy();self.window=None
        self.blurred=None;self.back_image=None
        self.app.settings_modal=None;self.app.sync_background()
        self.root.update_idletasks();self.app.canvas.yview_moveto(self.scroll_position)
        target=self.previous_focus
        if target is None or not target.winfo_exists():target=self.app.settings_button
        target.focus_force()
        return 'break'
