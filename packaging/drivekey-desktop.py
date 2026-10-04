#!/usr/bin/python3
"""DriveKey Desktop. Unprivileged local Tk UI; secrets go only to the guarded worker's stdin."""
import datetime as dt
import json
import os
import pathlib
import queue
import re
import subprocess
import threading
import time
import tkinter as tk
from tkinter import messagebox
from PIL import Image, ImageTk
import drivekey_theme as theme
import drivekey_widgets as widgets
from drivekey_appearance import preset
from drivekey_settings import SettingsModal
from drivekey_rules import RulesEditor, inspect_payment_approval
from drivekey_character_field import CharacterField
from drivekey_widgets import PillButton, Surface, Toggle, SlimScrollbar, rounded, icon
from drivekey_theme import (ui_font, shared_font, set_large_text, set_font_family,
                           set_motion, motion_enabled, BG, PANEL, EDGE, FG, MUTED,
                           ACCENT, ACTIVE, SECTION_COLORS, TINT)

SECTIONS = ('Home', 'Wallet', 'Send', 'Swap', 'Receive', 'Files', 'Settings')
BASE = pathlib.Path('/mnt/drivekey/DriveKey')
WORKER = ['/opt/drivekey/node/bin/node', '/opt/drivekey/drivekey-gui-worker.cjs']
PURPOSES = {
    'vault-encrypted.json': 'PRIVATE / Encrypted native ETH vault. Never upload.',
    'vault-multi-encrypted.json': 'PRIVATE / Encrypted multichain vault. Never upload.',
    'vault-backup.json': 'PRIVATE / Encrypted recovery copy. Keep a separate copy after shutdown.',
    'vault-multi-backup.json': 'PRIVATE / Encrypted multichain recovery copy. Never upload.',
    'wallet-public.json': 'PUBLIC / Native ETH wallet identity for the online website.',
    'wallet-multi-public.json': 'PUBLIC / Multichain addresses for the online website.',
    'unsigned-request.json': 'INCOMING / Exact native ETH transaction prepared online.',
    'unsigned-multi-request.json': 'INCOMING / Supported ERC-20, SOL or SPL transaction.',
    'signed-response.json': 'OUTGOING / Approved ETH signature. Not a broadcast or confirmation.',
    'signed-multi-response.json': 'OUTGOING / Approved multichain signature. Treat as payment authority.',
    'unsigned-trade-request.json': 'INCOMING / Transaction file — inspect to identify.',
    'signed-trade-response.json': 'OUTGOING / Exact reviewed signature. Not submitted.',
    'rules-account-context.json': 'OBSERVATION / Last reported online account and rules.',
    'rules-local-draft.json': 'DRAFT / Local rules; no spending authority changed.',
    'rules-signed-authorization.json': 'SIGNED / Awaiting explicit online application.',
    'rules-application-evidence.json': 'EVIDENCE / Reported application confirmation; finality separate.',
    'rules-payment-approval.json': 'INCOMING / Exact pending payment for the separate approver.',
    'rules-signed-payment-approval.json': 'SIGNED / Exact payment approval; not a payment receipt.',
}


class DriveKeyDesktop:
    def __init__(self, root):
        self.root, self.busy, self.exit_code = root, False, 0
        self.results, self.inventory = queue.Queue(), {}
        self.section, self.profile, self.mode = 'Home', 'eth', 'section'
        self.trade_review = False
        self.settings_tab = 'Display'
        self.font_family = tk.StringVar(value='Inter')
        self.send_source = 'trade'
        self.expected_action = None
        self.can_approve = False
        self.review, self.approved, self.action = None, False, None
        self.buttons, self.images, self.wraps = [], [], []
        self.transition_id=0
        self.reveal_timer=None;self.reveal_frames=0
        self.fields=[]; self.content_width=1020
        self.passphrase, self.confirmation = tk.StringVar(), tk.StringVar()
        self.message = tk.StringVar(value='Reading local storage and isolation status…')
        self.clock, self.profile_label = tk.StringVar(), tk.StringVar(value='Native ETH · Robinhood / 4663')
        self.low_effects, self.reduced_motion, self.large_text = tk.BooleanVar(value=True), tk.BooleanVar(value=False), tk.BooleanVar(value=False)
        self.settings_modal=None
        self.appearance=preset('Default')
        self.location=tk.StringVar(value='Home')
        self.guard_status=tk.StringVar(value='Isolation unverified')
        self.guard_status.trace_add('write',self.update_guard_color)
        root.title('DriveKey Wallet — RC20 UTC private preview · Offline')
        root.configure(bg=BG)
        root.geometry('1120x800'); root.minsize(640, 480)
        root.attributes('-fullscreen', True)
        root.protocol('WM_DELETE_WINDOW', self.shutdown)
        root.option_add('*Font', ui_font(12))
        root.option_add('*highlightColor', FG)
        self.build_shell()
        self.show('Home'); self.tick(); self.root.after(60, self.poll)
        self.refresh(); self.root.after(5000, self.auto_refresh)

    def build_shell(self):
        root=self.root
        header = tk.Frame(root, bg=BG, height=58); header.pack(fill='x');header.pack_propagate(False)
        brand=tk.Frame(header,bg=BG,width=280);brand.pack(side='left',fill='y');brand.pack_propagate(False)
        self.brand_header=brand
        self.logo(brand).pack(side='left',padx=(20,8))
        self.brand_word=self.label(brand,'DriveKey',12,FG,True);self.brand_word.pack(side='left')
        self.desktop_caption=self.label(brand,'RC20 UTC',9,ACCENT);self.desktop_caption.pack(side='left',padx=6)
        tk.Frame(header,bg=EDGE,width=1).pack(side='left',fill='y')
        self.location_label=self.label(header,variable=self.location,size=12,color=FG,bold=True)
        self.location_label.pack(side='left',padx=20)
        guard_label=self.label(header,variable=self.guard_status,size=9,color=MUTED)
        guard_label.pack(side='right',padx=20)
        self.guard_label=guard_label
        self.update_guard_color()
        self.tooltip(guard_label,'Last local guard observation; not continuous monitoring or a security attestation.')
        self.divider(root)
        footer=tk.Frame(root,bg=BG,padx=16,pady=6);footer.pack(side='bottom',fill='x')
        self.divider(footer)
        footer_controls=tk.Frame(footer,bg=BG);footer_controls.pack(fill='x',pady=(5,0))
        self.shortcuts=self.label(footer_controls,'Alt+1–7  sections   ·   Tab  focus   ·   Esc  cancel',9,MUTED);self.shortcuts.pack(side='left')
        self.settings_button=self.button(footer_controls,'Settings',self.open_settings,compact=True,icon_name='Settings')
        self.settings_button.pack(side='right',padx=(16,0))
        root.bind('<Alt-Key-7>',lambda e:self.open_settings())
        self.clock_label=self.label(footer_controls,variable=self.clock,size=9,color=MUTED);self.clock_label.pack(side='right')
        self.status_label=self.label(footer,variable=self.message,size=9,color=MUTED)
        self.status_label.pack(fill='x',pady=(3,0))
        self.status_label.bind('<Configure>',lambda e:self.status_label.configure(wraplength=max(200,e.width)))
        rail=Surface(root,color=BG,border='',radius=0,padding=12);self.rail=rail;rail.configure(width=280);rail.stretch=True;rail.pack(side='left',fill='y')
        tk.Frame(root,bg=EDGE,width=1).pack(side='left',fill='y')
        nav=rail.inner;self.nav={};self.nav_frame=nav;self.nav_columns=1;self.nav_groups=[]
        for i,section in enumerate(SECTIONS[:-1]):
            if section in ('Home','Send','Files'):
                group=self.label(nav,{'Home':'Workspace','Send':'Transactions','Files':'Session'}[section],9,MUTED)
                group.pack(fill='x',padx=10,pady=(20,8));self.nav_groups.append(group)
            b=PillButton(nav,section,lambda s=section:self.show(s),icon_name=section,icon_color=MUTED,width=256,height=32,align='left')
            b.configure(bg=BG,fg=MUTED,outline='');b.pack(pady=(0,4));self.nav[section]=b;self.buttons.append(b);self.tooltip(b,section+'  ·  Alt+'+str(i+1))
            root.bind('<Alt-Key-%d>' % (i+1),lambda e,s=section:self.show(s))
        strip=tk.Frame(nav,bg=BG);strip.pack(side='bottom',fill='x',pady=(20,12));self.profile_strip=strip
        self.divider(strip)
        self.profile_caption=self.label(strip,'Active profile',9,MUTED);self.profile_caption.pack(fill='x',pady=(12,6))
        self.active_profile_text=self.label(strip,variable=self.profile_label,size=10,color=FG)
        self.active_profile_text.pack(fill='x');self.active_profile_text.bind('<Configure>',lambda e:self.active_profile_text.configure(wraplength=max(80,e.width)))
        outer = tk.Frame(root, bg=BG); outer.pack(fill='both', expand=True)
        self.canvas = tk.Canvas(outer, bg=BG, highlightthickness=0, takefocus=False)
        scroll = SlimScrollbar(outer, command=self.canvas.yview)
        scroll.pack(side='right', fill='y'); self.canvas.pack(side='left', fill='both', expand=True)
        self.backdrop=CharacterField(self.canvas);self.fields.append(self.backdrop)
        def scrolled(first,last):
            scroll.set(first,last);self.backdrop.position()
        self.canvas.configure(yscrollcommand=scrolled)
        self.body = tk.Frame(self.canvas, bg=BG, padx=0, pady=8)
        self.window = self.canvas.create_window(0, 0, anchor='nw', window=self.body)
        self.body.bind('<Configure>', self.scroll_bounds)
        self.canvas.bind('<Configure>', self.resize)
        root.bind_all('<Button-4>', lambda e: self.scroll_target().yview_scroll(-3, 'units'))
        root.bind_all('<Button-5>', lambda e: self.scroll_target().yview_scroll(3, 'units'))
        root.bind_all('<MouseWheel>', lambda e: self.scroll_target().yview_scroll(-int(e.delta/120), 'units'))
        root.bind_all('<Next>', lambda e: self.scroll_target().yview_scroll(1, 'pages'))
        root.bind_all('<Prior>', lambda e: self.scroll_target().yview_scroll(-1, 'pages'))
        root.bind_all('<FocusIn>', self.reveal_focus)
        root.bind('<Escape>', lambda e: self.cancel())
        root.bind('<Configure>',self.fit_header)

    def update_guard_color(self,*args):
        if hasattr(self,'guard_label') and self.guard_label.winfo_exists():
            self.guard_label.configure(fg=SECTION_COLORS['Receive'] if self.guard_status.get().startswith('Guard checked') else SECTION_COLORS['Wallet'])

    def scroll_target(self):
        return self.settings_modal.canvas if self.settings_modal else self.canvas

    def open_settings(self):
        if self.settings_modal:
            self.settings_modal.window.lift();return
        if self.busy or self.mode!='section' or self.review or self.approved or self.action or self.passphrase.get() or self.confirmation.get():return
        self.root.update_idletasks()
        self.settings_modal=SettingsModal(self)
        self.sync_background()

    def apply_appearance(self,value):
        # Rebuild presentation only in an ordinary, non-secret view. Worker state is untouched.
        if self.busy or self.mode!='section' or self.review or self.approved or self.action or self.passphrase.get() or self.confirmation.get():return
        theme.set_palette(value);widgets.sync_palette()
        globals().update({key:getattr(theme,key) for key in ('BG','PANEL','EDGE','FG','MUTED','ACCENT','ACTIVE')})
        self.appearance=dict(value)
        position=self.canvas.yview()[0]
        for field in self.fields:field.close()
        self.fields=[]
        if self.reveal_timer is not None:self.root.after_cancel(self.reveal_timer);self.reveal_timer=None
        for child in self.root.winfo_children():
            if not self.settings_modal or child is not self.settings_modal.window:child.destroy()
        self.buttons=[];self.wraps=[];self.images=[]
        self.root.configure(bg=BG);self.build_shell()
        self.render_section(self.section)
        self.root.update_idletasks()
        # A theme rebuild at the same window size does not emit a root resize.
        layout=tk.Event();layout.widget=self.root;layout.width=self.root.winfo_width();layout.height=self.root.winfo_height()
        self.fit_header(layout)
        self.root.update_idletasks();self.canvas.yview_moveto(position)

    def logo(self, parent):
        # Small neutral key mark rendered from the bundled licensed vector asset.
        mark=tk.Canvas(parent,width=22,height=22,bg=parent.cget('bg'),highlightthickness=0,takefocus=False)
        icon(mark,'Key',1,1,FG,20)
        return mark

    def label(self, parent, text='', size=11, color=None, bold=False, variable=None, mono=False):
        return tk.Label(parent, text=text, textvariable=variable, fg=FG if color is None else color, bg=parent.cget('bg'),
                        font=shared_font(self.root,size,bold,mono), anchor='w', justify='left')

    def tooltip(self, widget, caption):
        bubble=[None]
        def hide(event=None):
            if bubble[0] is not None:
                bubble[0].destroy();bubble[0]=None
        def show(event=None):
            hide();popup=tk.Toplevel(self.root);bubble[0]=popup;popup.overrideredirect(True)
            popup.configure(bg=EDGE);popup.geometry('+%d+%d'%(widget.winfo_rootx()+widget.winfo_width()+8,widget.winfo_rooty()))
            tk.Label(popup,text=caption,bg=PANEL,fg=FG,padx=16,pady=8,font=shared_font(self.root,10)).pack(padx=1,pady=1)
        widget.bind('<Enter>',show,add='+');widget.bind('<Leave>',hide,add='+');widget.bind('<Destroy>',hide,add='+');widget.bind('<Button-1>',hide,add='+');widget.bind('<FocusIn>',show,add='+');widget.bind('<FocusOut>',hide,add='+')

    def button(self, parent, text, command, primary=False, compact=False, icon_name=None, accent=None):
        b=PillButton(parent,text,command,primary,compact,icon_name=icon_name,icon_color=accent)
        self.buttons.append(b);return b

    @staticmethod
    def shade(color,base=None,amount=.16):
        base=PANEL if base is None else base
        values=[round(int(base[i:i+2],16)*(1-amount)+int(color[i:i+2],16)*amount) for i in (1,3,5)]
        return '#'+''.join('%02x'%v for v in values)

    def icon_tile(self,parent,name,color,size=20):
        # Asset colors carry meaning; utility glyphs remain small and neutral.
        glyph=18 if name in ('ETH','SOL','USDC','USDG') else 14
        tile=tk.Canvas(parent,width=20,height=20,bg=parent.cget('bg'),highlightthickness=0,takefocus=False)
        icon(tile,name,(20-glyph)/2,(20-glyph)/2,color if name in ('ETH','SOL','USDC','USDG') else MUTED,glyph)
        return tile

    def badge(self,parent,text,color):
        return tk.Label(parent,text=text,fg=color,bg=self.shade(color),font=shared_font(self.root,9,True),padx=8,pady=4)

    def network_label(self,parent,title,asset,color):
        row=tk.Frame(parent,bg=parent.cget('bg'));row.pack(fill='x',pady=(0,8))
        self.icon_tile(row,asset,color,28).pack(side='left',padx=(0,8))
        label=self.label(row,title,11,FG,True);label.pack(side='left',fill='x',expand=True)
        label.bind('<Configure>',lambda e:label.configure(wraplength=max(60,e.width)))
        return row

    def stat_tile(self,parent,title,value,note,name,color):
        shell=Surface(parent,padding=14,radius=4);shell.pack(fill='x',pady=(0,12))
        c=shell.inner;top=tk.Frame(c,bg=PANEL);top.pack(fill='x',pady=(0,6))
        self.icon_tile(top,name,MUTED).pack(side='right',padx=(8,0))
        label=self.label(top,title,10,MUTED);label.pack(side='left',fill='x',expand=True)
        label.bind('<Configure>',lambda e:label.configure(wraplength=max(80,e.width)))
        self.text(c,value,17,color,True).pack_configure(pady=(0,4));self.text(c,note,9).pack_configure(pady=0)

    def text(self, parent, text, size=11, color=None, bold=False, wrap=None, mono=False):
        w=self.label(parent,str(text),size,MUTED if color is None else color,bold,mono=mono); w.pack(fill='x',pady=(0,8))
        w.wrap_cap=wrap;self.wraps.append(w)
        w.bind('<Configure>',lambda e:w.configure(wraplength=min(wrap or 10000,max(80,e.width-4))))
        w.configure(wraplength=min(wrap or 10000,max(180,self.content_width-56)))
        return w

    def divider(self,parent):
        line=tk.Frame(parent,bg=EDGE,height=1);line.pack(fill='x');return line

    def adaptive_columns(self,parent,count,breakpoint=820,weights=None):
        """Reflow existing panels without replacing inputs or approval state."""
        holder=tk.Frame(parent,bg=parent.cget('bg'));holder.pack(fill='x')
        cells=[tk.Frame(holder,bg=parent.cget('bg')) for _ in range(count)]
        previous=[None]
        def reflow(event):
            columns=count if event.width>=breakpoint else 1
            if previous[0]==columns:return
            previous[0]=columns
            for column in range(count):holder.columnconfigure(column,weight=(weights[column] if weights else 1) if column<columns else 0,uniform='panels' if column<columns and not weights else '')
            for index,cell in enumerate(cells):
                cell.grid(row=index//columns,column=index%columns,sticky='nsew',padx=(0,12 if columns>1 and index<count-1 else 0))
        holder.bind('<Configure>',reflow)
        for index,cell in enumerate(cells):cell.grid(row=index,column=0,sticky='ew')
        return cells

    def card(self, title, eyebrow=None, parent=None, icon_name=None, accent=None):
        surface=Surface(parent or self.body,padding=16,radius=4)
        surface.pack(fill='x',pady=(0,12));f=surface.inner
        heading=tk.Frame(f,bg=PANEL);heading.pack(fill='x',pady=(0,12))
        if icon_name:self.icon_tile(heading,icon_name,MUTED).pack(side='left',padx=(0,6))
        label=self.label(heading,title,12,FG,True);label.pack(side='left',fill='x',expand=True)
        label.bind('<Configure>',lambda e:label.configure(wraplength=max(80,e.width)))
        if eyebrow and self.mode!='section':self.text(f,eyebrow,9,MUTED)
        return f

    def clear(self, title, subtitle):
        self.transition_id+=1
        if self.reveal_timer is not None:self.root.after_cancel(self.reveal_timer);self.reveal_timer=None
        for field in self.fields[1:]:field.close()
        self.fields=self.fields[:1]
        for w in self.body.winfo_children():w.destroy()
        self.wraps=[]; self.images=[]; self.buttons=[b for b in self.buttons if b.winfo_exists()]
        heading=tk.Frame(self.body,bg=BG);heading.pack(fill='x',pady=(0,12))
        if self.mode!='section':self.text(heading,title,17,FG,True).pack_configure(pady=(0,6))
        self.text(heading,subtitle,10,MUTED).pack_configure(pady=0)
        self.accent_line=tk.Frame(self.body,bg=EDGE,height=1);self.accent_line.pack(fill='x',pady=(0,12))
        self.canvas.yview_moveto(0)
        self.sync_background()

    def resize(self, event):
        self.content_width=max(240,min(1120,event.width-48))
        self.canvas.itemconfigure(self.window,width=self.content_width)
        self.canvas.coords(self.window,max(16,(event.width-self.content_width)//2),0)
        self.scroll_bounds()

    def scroll_bounds(self,event=None):
        # A positive bbox origin makes Tk pan away the intended content gutter.
        self.canvas.configure(scrollregion=(0,0,self.canvas.winfo_width(),
                              max(self.canvas.winfo_height(),self.body.winfo_height())))

    def sync_background(self):
        if hasattr(self,'settings_button'):
            self.settings_button.configure(state='normal' if not self.busy and self.mode=='section' else 'disabled')
        set_motion(not self.reduced_motion.get() and not self.busy and self.mode=='section')
        if not motion_enabled() and self.reveal_timer is not None:
            self.root.after_cancel(self.reveal_timer);self.reveal_timer=None
            if hasattr(self,'accent_line') and self.accent_line.winfo_exists():self.accent_line.configure(bg=EDGE)
        paused=bool(self.settings_modal) or self.reduced_motion.get() or self.busy or self.mode!='section' or self.section in ('Send','Swap')
        for field in self.fields:field.configure(paused=paused,hidden=self.low_effects.get() or self.appearance['base'] in ('Light','Ice','Rose'))

    def animate_section(self):
        token=self.transition_id
        line=self.accent_line
        color=EDGE
        def step(frame=0):
            self.reveal_timer=None
            if token!=self.transition_id or not line.winfo_exists():return
            if self.busy or self.mode!='section' or not motion_enabled():
                line.configure(bg=color);return
            line.configure(bg=self.shade(color,BG,1-(1-frame/10)**2))
            self.reveal_frames+=1
            if frame<10:self.reveal_timer=self.root.after(16,lambda:step(frame+1))
        step()

    def fit_header(self,event):
        if event.widget!=self.root:return
        wide=event.width>=1000
        self.rail.configure(width=280 if wide else 56)
        self.brand_header.configure(width=280 if wide else 160)
        if not wide:self.desktop_caption.pack_forget();self.shortcuts.pack_forget();self.profile_strip.pack_forget()
        else:
            if not self.desktop_caption.winfo_manager():self.desktop_caption.pack(side='left',padx=6,after=self.brand_word)
            if not self.shortcuts.winfo_manager():self.shortcuts.pack(side='left')
            if not self.profile_strip.winfo_manager():self.profile_strip.pack(side='bottom',fill='x',pady=(20,12))
        for group in self.nav_groups:
            group.configure(fg=MUTED if wide else BG,font=shared_font(self.root,9))
            group.pack_configure(pady=(20,8) if event.height>=650 else (4,4))
        for section,b in self.nav.items():
            b.configure(text=section if wide else '',width=256 if wide else 32,height=28 if event.height<650 else 32)
            b.pack_configure(pady=(0,2 if event.height<650 else 4))

    def reveal_focus(self, event):
        w=event.widget
        if not str(w).startswith(str(self.body)):return
        self.root.update_idletasks()
        y=w.winfo_rooty()-self.body.winfo_rooty()
        top=self.canvas.canvasy(0); height=self.canvas.winfo_height()
        total=max(1,self.body.winfo_height())
        if y<top:self.canvas.yview_moveto(max(0,y-12)/total)
        elif y+w.winfo_height()>top+height:self.canvas.yview_moveto(max(0,y+w.winfo_height()-height+12)/total)

    def show(self, section):
        if section=='Settings':return self.open_settings()
        if self.busy or self.settings_modal:return
        self.render_section(section)

    def render_section(self,section):
        if self.busy:return
        if section not in SECTIONS:raise ValueError('Unknown destination')
        self.section=section; self.mode='section'; self.review=None; self.approved=False; self.can_approve=False
        self.trade_review=False; self.expected_action=None
        self.passphrase.set(''); self.confirmation.set(''); self.action=None
        self.location.set(section)
        for s,b in self.nav.items():b.configure(bg=ACTIVE if s==section else BG,fg=FG if s==section else MUTED,icon_color=FG if s==section else MUTED,indicator=ACCENT if s==section else None)
        subtitles={'Home':'Local wallet · Offline signing', 'Wallet':'Identity, recovery & account setup',
                    'Send':'Review a payment prepared on your connected device.', 'Swap':'Review the exact exchange or spending allowance.',
                    'Receive':'Share your public address. Keep your vault offline.', 'Files':'Exchange files · This session',
                    'Settings':'Display, session and application preferences.'}
        self.clear(section,subtitles[section])
        getattr(self,'page_'+section.lower())()
        self.sync_background()
        self.animate_section()

    def vault(self):return self.inventory.get(self.profile,{'state':'unavailable','wallet':None})
    def inspection(self):return self.inventory.get('inspections',{}).get(self.profile,{'state':'unavailable','message':'Refresh local inventory.'})
    def scoped(self, action, **values):return {'action':action,**({'scope':'multi'} if self.profile=='multi' else {}),**values}
    def file_state(self,name):return self.inventory.get('files',{}).get(name,'unavailable')

    def page_home(self):
        ready=self.vault().get('wallet') is not None
        incoming=sum(self.file_state(name)=='present' for name in PURPOSES if name.startswith('unsigned-'))
        outgoing=sum(self.file_state(name)=='present' for name in PURPOSES if name.startswith('signed-'))
        summaries=self.adaptive_columns(self.body,3)
        self.stat_tile(summaries[0],'Active wallet','Identity available' if ready else 'Setup needed','Passphrase not verified' if ready else self.vault()['state'].capitalize(),'Key',SECTION_COLORS['Wallet'])
        self.stat_tile(summaries[1],'Incoming requests',str(incoming),'Awaiting inspection','Requests',SECTION_COLORS['Send'])
        self.stat_tile(summaries[2],'Saved responses',str(outgoing),'Saved locally · Not submitted','Review & sign',SECTION_COLORS['Receive'])
        panels=self.adaptive_columns(self.body,2,980,weights=[3,2])
        files=[('unsigned-trade-request.json','Transaction file — inspect to identify',self.inspect_trade),
               ('unsigned-multi-request.json','Multichain payment',lambda:self.inspect_profile('multi')),
               ('unsigned-request.json','Robinhood native ETH payment',lambda:self.inspect_profile('eth'))]
        present=[item for item in files if self.file_state(item[0])=='present']
        c=self.card('Incoming requests','NEXT ACTION',panels[0],icon_name='Requests',accent=SECTION_COLORS['Send'])
        if not ready:
            self.text(c,'Set up a wallet before signing. You can inspect existing request files below.')
            self.button(c,'Open wallet setup',lambda:self.show('Wallet'),True,icon_name='Wallet').pack(anchor='w',pady=(0,16))
        if not present:
            self.icon_tile(c,'USB',MUTED).pack(anchor='w',pady=(8,8))
            self.text(c,'Waiting for a request',17,FG,True)
            self.text(c,'Save a request in DriveKey on your connected device. Eject safely, then inspect it here.')
            self.button(c,'View exchange files',lambda:self.show('Files'),compact=True,icon_name='Files',accent=SECTION_COLORS['Files']).pack(anchor='w',pady=(8,0))
        for index,(name,title,action) in enumerate(present):
            if index:self.divider(c)
            self.badge(c,'Awaiting inspection',ACCENT).pack(anchor='w',pady=(8,8))
            self.text(c,title,13,FG,True);self.text(c,name,10,mono=True)
            self.button(c,'Inspect request',action,primary=ready and index==0,compact=True,icon_name='Review & sign').pack(anchor='w',pady=(4,16))
        for name,_,_ in files:
            if self.file_state(name) in ('invalid','unreadable'):self.text(c,name+': '+self.file_state(name)+'. Open Files for details.',11)
        c=self.card('Offline workflow','HOW THE HANDOFF WORKS',panels[1],icon_name='Shield',accent=SECTION_COLORS['Swap'])
        for title,note,name,color in [
                ('01  Prepare online','Choose the network, recipient, amount and fee limit.','Upload',SECTION_COLORS['Send']),
                ('02  Review & sign here','Compare every detail. Approve, then unlock to sign.','Key',SECTION_COLORS['Swap']),
                ('03  Verify & submit online','Import the signed response and explicitly submit.','Check',SECTION_COLORS['Receive'])]:
            row=tk.Frame(c,bg=PANEL);row.pack(fill='x',pady=(6,8))
            self.icon_tile(row,name,color,32).pack(side='left',anchor='n',padx=(0,10))
            words=tk.Frame(row,bg=PANEL);words.pack(side='left',fill='x',expand=True)
            self.text(words,title,11,FG,True);self.text(words,note,10)
        self.divider(c)
        self.text(c,self.inventory.get('system',{}).get('isolation','Isolation observation unavailable.'),10)

    def page_wallet(self):
        rules_card=self.card('Agent rules','Offline authority · Robinhood ETH / USDG',icon_name='Key')
        self.text(rules_card,'Set limits, recipients and expiry for a separately funded policy account. New accounts start with no spending authority.')
        self.button(rules_card,'Open agent rules',lambda:RulesEditor(self),True,icon_name='Review & sign').pack(anchor='w',pady=8)
        self.button(rules_card,'Review pending agent payment',lambda:inspect_payment_approval(self),icon_name='Review & sign').pack(anchor='w',pady=8)
        c=self.card('Wallet profiles',icon_name='Wallet')
        profiles=self.adaptive_columns(c,2,650)
        for parent,value,title in [(profiles[0],'eth','Robinhood native ETH'),(profiles[1],'multi','Ethereum, Solana & tokens')]:
            b=self.button(parent,title,lambda p=value:self.select_profile(p),compact=True,icon_name='ETH' if value=='eth' else 'Wallet',accent=SECTION_COLORS['Wallet'])
            b.configure(bg=ACTIVE if self.profile==value else PANEL,align='left',outline=ACCENT if self.profile==value else EDGE);b.pack(fill='x',pady=(0,6))
        v=self.vault();w=v.get('wallet')
        columns=self.adaptive_columns(self.body,2,980)
        c=self.card('Public identity',self.profile_label.get(),columns[0],icon_name='User',accent=SECTION_COLORS['Files'])
        self.text(c,'Vault: '+v['state']+'. Public identity does not prove a successful unlock.')
        if w:
            for key,title in [('address','Robinhood Chain / 4663'),('evmAddress','Ethereum / Robinhood EVM address'),('solanaAddress','Solana mainnet')]:
                if w.get(key):self.network_label(c,title,'SOL' if key=='solanaAddress' else 'ETH',SECTION_COLORS['Receive'] if key=='solanaAddress' else SECTION_COLORS['Send']);self.text(c,w[key],12,FG,mono=True)
            self.button(c,'Verify passphrase',lambda:self.open_action('check'),True,icon_name='Key').pack(fill='x',pady=8)
            self.button(c,'Export public wallet',lambda:self.call(self.scoped('export-public'),self.operation_result),icon_name='Upload').pack(fill='x',pady=8)
        else:self.text(c,'No readable identity for this profile. Existing vault files will never be overwritten.')
        c=self.card('Backup & recovery','Backup & recovery',columns[1],icon_name='Lock',accent=SECTION_COLORS['Wallet'])
        if v['state']=='missing':
            self.button(c,'Create new vault',lambda:self.open_action('create'),True).pack(fill='x',pady=8)
            self.button(c,'Restore encrypted backup',lambda:self.open_action('restore')).pack(fill='x',pady=8)
        elif w:
            self.button(c,'Create encrypted backup',lambda:self.open_action('backup')).pack(fill='x',pady=8)
            self.button(c,'Verify encrypted backup',lambda:self.open_action('check-backup')).pack(fill='x',pady=8)
        else:self.text(c,'Inspect Files and preserve the existing vault before attempting recovery. An invalid vault cannot be replaced here.')
        self.text(c,'Keep a separate encrypted backup after shutdown. A copy on this USB alone cannot protect against losing it. There is no passphrase reset.')
        if self.profile=='multi':
            c=self.card('Solana account setup','Durable nonce',columns[1],icon_name='SOL',accent=SECTION_COLORS['Receive'])
            self.text(c,'A nonce account holds a SOL deposit and authorizes offline signing. This is account setup, not a payment to a recipient.')
            self.request_action(c,'unsigned-trade-request.json','Inspect nonce setup',lambda:self.inspect_trade('nonce'),primary=False)

    def request_action(self,parent,filename,label,command,primary=True):
        state=self.file_state(filename)
        self.text(parent,filename,10,mono=True)
        if state=='present':self.button(parent,label,command,primary,compact=True,icon_name='Review & sign').pack(anchor='w',pady=8)
        else:self.text(parent,'Request '+state+'. Save the prepared file in DriveKey, then safely eject and return here.')

    def begin_inspection(self,scope,expected=None):
        if self.busy:return
        self.show(self.section)
        self.mode='inspect';self.expected_action=expected;self.trade_review=scope=='trade'
        self.clear('Inspect request','Reading the exact file through the offline signing guard.')
        payload={'action':'inspect'}
        if scope in ('trade','multi'):payload['scope']=scope
        self.call(payload,self.inspected)

    def inspect_trade(self,expected=None):
        if self.busy:return
        if expected is None:expected={'Send':'payment','Swap':'exchange','Wallet':'nonce'}.get(self.section)
        if self.profile!='multi':self.select_profile('multi')
        self.begin_inspection('trade',expected)

    def inspect_profile(self,profile):
        if self.busy:return
        if self.profile!=profile:self.select_profile(profile)
        self.begin_inspection(profile,'payment')

    def page_swap(self):
        c=self.card('Supported pairs',icon_name='Swap')
        routes=self.adaptive_columns(c,2,600)
        for parent,network,source,asset in [(routes[0],'Ethereum','WETH','ETH'),(routes[1],'Solana','SOL','SOL')]:
            row=tk.Frame(parent,bg=PANEL);row.pack(fill='x',pady=4)
            self.icon_tile(row,asset,MUTED).pack(side='left',padx=(0,6))
            self.label(row,source+'  ↔  USDC',11,FG,True).pack(side='left')
            self.icon_tile(row,'USDC',MUTED).pack(side='left',padx=6)
            self.text(parent,network+' · Validated routes only',9)
        c=self.card('Exchange request',icon_name='Review & sign')
        self.text(c,'Check the exact input, minimum output, recipient, route, fees and expiry. A spending allowance requires its own approval.')
        self.request_action(c,'unsigned-trade-request.json','Inspect swap or allowance',self.inspect_trade)
        self.text(c,'The file’s action is established only after inspection. Memecoin routes are not enabled.',10)
        c=self.card('Husher',icon_name='Husher')
        self.badge(c,'Offline review ready · Online execution pending',ACCENT).pack(anchor='w',pady=(0,8))
        self.text(c,'RC19 can review provider-bound ETH → USDC deposits on Ethereum. Compare the payout, refund, fees and deadlines.',10)
        self.text(c,'Standard custodial exchange only. Husher privacy is not verified. Provider terms and settlement must be checked online.',10)


    def select_send_source(self,source):
        if self.busy:return
        self.send_source=source;self.show('Send')

    def page_send(self):
        toolbar=Surface(self.body,padding=8,radius=4);toolbar.pack(fill='x',pady=(0,12))
        choices=self.adaptive_columns(toolbar.inner,3,700)
        for parent,source,title,asset in [
                (choices[0],'trade','Ethereum','ETH'),
                (choices[1],'multi','Solana & tokens','SOL'),
                (choices[2],'eth','Robinhood ETH','ETH')]:
            selected=self.send_source==source
            b=self.button(parent,title,lambda s=source:self.select_send_source(s),compact=True,icon_name=asset)
            b.configure(bg=ACTIVE if selected else PANEL,fg=FG if selected else MUTED,outline=ACCENT if selected else '',align='left')
            b.pack(fill='x')
        c=self.card('Payment request',icon_name='Review & sign')
        notes={'trade':'Ethereum mainnet · ETH, WETH and USDC',
               'multi':'SOL, classic SPL and supported Robinhood ERC-20',
               'eth':'Robinhood Chain 4663 · Native ETH'}
        self.text(c,notes[self.send_source],10,FG)
        self.divider(c)
        self.text(c,'Verify the complete recipient independently. Signing creates a response for the online app; it does not send funds.').pack_configure(pady=(12,12))
        filename={'trade':'unsigned-trade-request.json','multi':'unsigned-multi-request.json','eth':'unsigned-request.json'}[self.send_source]
        command=(lambda:self.inspect_trade('payment')) if self.send_source=='trade' else lambda:self.inspect_profile(self.send_source)
        self.request_action(c,filename,'Inspect payment',command)

    def page_receive(self):
        self.text(self.body,'Public addresses and address-only QR codes. Balances and payment status are unavailable offline.')
        found=False
        for profile,key,title in [('eth','address','Robinhood native ETH'),('multi','evmAddress','Ethereum / Robinhood EVM'),('multi','solanaAddress','Solana mainnet')]:
            address=(self.inventory.get(profile,{}).get('wallet') or {}).get(key)
            if address:
                found=True
                color=SECTION_COLORS['Receive'] if key=='solanaAddress' else SECTION_COLORS['Wallet'] if profile=='eth' else SECTION_COLORS['Send']
                c=self.card(title,'PUBLIC ADDRESS',icon_name='SOL' if key=='solanaAddress' else 'ETH',accent=color)
                self.text(c,address,12,FG,mono=True)
                self.button(c,'Show '+title+' QR',lambda a=address,t=title:self.show_qr(a,t),compact=True,icon_name='Request',accent=color).pack(anchor='w',pady=(8,0))
        if not found:
            c=self.card('Your public addresses','WALLET REQUIRED',icon_name='Receive')
            self.text(c,'Create or restore a wallet to display its public addresses.')
            self.button(c,'Open wallet',lambda:self.show('Wallet'),True).pack(fill='x',pady=8)

    def page_files(self):
        self.text(self.body,str(BASE),11,mono=True)
        groups=[('Incoming requests','unsigned-','Requests','Send'),('Outgoing responses','signed-','Review & sign','Receive'),('Public identities','wallet-','User','Files'),('Private vaults & backups','vault-','Lock','Wallet'),('Agent rules','rules-','Key','Wallet')]
        columns=self.adaptive_columns(self.body,2,960)
        for index,(title,prefix,glyph,section) in enumerate(groups):
            color=SECTION_COLORS[section]
            c=self.card(title,parent=columns[index%2],icon_name=glyph,accent=color)
            row_index=0
            for name,purpose in PURPOSES.items():
                if name.startswith(prefix):
                    row_color=theme.FIELD if row_index%2 else PANEL;row_index+=1
                    row=tk.Frame(c,bg=row_color,pady=8,padx=8);row.pack(fill='x')
                    heading=tk.Frame(row,bg=row_color);heading.pack(fill='x')
                    self.badge(heading,self.file_state(name).upper(),color if self.file_state(name)=='present' else MUTED).pack(side='right',anchor='n',padx=(12,0))
                    filename=tk.Frame(heading,bg=row_color);filename.pack(side='left',fill='x',expand=True)
                    self.text(filename,name,11,FG,True,mono=True);self.text(row,purpose.split(' / ',1)[-1],10)
                    self.divider(c)
        self.text(self.body,'Private vault files never belong in an upload. Shut down fully before copying files to another device.',11)
        self.button(self.body,'Refresh file status',self.refresh,compact=True,icon_name='Refresh').pack(anchor='w',pady=8)

    def page_settings(self):
        self.open_settings()

    def select_settings(self,name):
        if self.settings_modal:self.settings_modal.select(name)

    def reset_preferences(self):
        if self.busy:return
        self.font_family.set('Inter');self.large_text.set(False);self.reduced_motion.set(False);self.low_effects.set(True)
        self.apply_preferences()
        if self.settings_modal:self.settings_modal.change_theme(preset('Default'))

    def select_font(self,family):
        if self.busy:return
        if family not in ('Inter','Nunito'):raise ValueError('Unknown bundled font')
        self.font_family.set(family);self.apply_preferences()

    def apply_preferences(self):
        if self.busy:return
        set_font_family(self.font_family.get())
        set_large_text(self.large_text.get())
        self.root.option_add('*Font',ui_font(12))
        self.sync_background()

    def select_profile(self,profile):
        if self.busy or self.settings_modal:return
        if profile not in ('eth','multi'):raise ValueError('Unknown profile')
        self.profile=profile
        self.profile_label.set('Ethereum, Solana & tokens' if profile=='multi' else 'Robinhood native ETH / 4663')
        self.show(self.section)

    def switch_profile(self):
        self.select_profile('multi' if self.profile=='eth' else 'eth')

    @staticmethod
    def field_name(key):return re.sub(r'(?<=[a-z])(?=[A-Z])',' ',key).replace('UTC','UTC').capitalize()

    def inspected(self, reply):
        self.review=None;self.approved=False;self.can_approve=False
        self.passphrase.set('');self.confirmation.set('');self.action=None
        item=reply.get('inspection')
        if not reply.get('ok') or not item or not item.get('review'):
            self.mode='inspection-error'
            self.clear('Request unavailable','Nothing is approved or ready to sign.')
            self.text(self.body,reply.get('error') or (item or {}).get('message') or 'Inspect the expected file, selected wallet and current UTC, then try again.')
            self.button(self.body,'Back to '+self.section,lambda:self.show(self.section)).pack(fill='x',pady=8)
            return
        self.message.set(item.get('message',''))
        review=item['review']
        kind=('nonce' if review.get('operation')=='Create durable nonce — new ISO required' else review.get('action')) if self.trade_review else 'payment'
        labels={'provider-deposit':'Husher deposit','payment':'Payment','approval':'Spending allowance','swap':'Swap','nonce':'Nonce account setup'}
        destination={'provider-deposit':'Swap','payment':'Send','approval':'Swap','swap':'Swap','nonce':'Wallet'}
        matches=self.expected_action is None or kind==self.expected_action or (self.expected_action=='exchange' and kind in ('swap','approval','provider-deposit'))
        if kind not in labels or not matches:
            self.mode='action-mismatch'
            self.clear('Different action detected','No approval has been retained.')
            self.text(self.body,'This request is '+labels.get(kind,'an unrecognized action')+'. Inspect it in the matching section before approving.',14,FG)
            if kind in destination:
                target=destination[kind]
                self.button(self.body,'Open '+target,lambda:self.show(target),True).pack(fill='x',pady=8)
            self.button(self.body,'Back to '+self.section,lambda:self.show(self.section)).pack(fill='x',pady=8)
            return
        self.mode='review';self.review=review;self.can_approve=item.get('canSign') is True
        self.location.set(self.section+' / Review')
        self.clear('Review '+labels[kind].lower(),'01  Review all details  →  02  Approve  →  03  Sign locally')
        c=self.card(labels[kind],item['state'])
        if kind=='approval':self.text(c,'This grants spending authority to the displayed contract. It is not a payment.',14,FG,True)
        if kind=='nonce':self.text(c,'This creates a nonce account and locks the displayed SOL deposit. It is not a recipient payment.',14,FG,True)
        for key,value in self.review.items():
            self.text(c,self.field_name(key),10,MUTED)
            mono=any(term in key.lower() for term in ('address','recipient','from','contract','hash','fingerprint','nonceaccount','mint','identit','router')) or bool(re.search(r'0x[0-9a-fA-F]{40,}|[1-9A-HJ-NP-Za-km-z]{40,}',str(value)))
            self.text(c,str(value),12,FG,mono=mono)
        self.text(c,'Compare recipient and token identity with an independently known source. Network execution is not established by an offline signature.')
        if self.can_approve:self.button(c,'I approve this exact '+labels[kind].lower(),self.approve,True).pack(fill='x',pady=8)
        self.button(c,'Cancel review',self.cancel).pack(fill='x',pady=8)

    def approve(self):
        if self.busy or not self.review or not self.can_approve:return
        self.approved=True; self.open_action('sign',preserve_review=True)

    def entry(self,parent,title,variable,secret=True):
        self.text(parent,title,11,FG)
        e=tk.Entry(parent,textvariable=variable,show='●' if secret else '',bg=theme.FIELD,fg=FG,insertbackground=FG,
                   relief='flat',highlightthickness=1,highlightbackground=EDGE,highlightcolor=ACCENT,font=shared_font(self.root,14),exportselection=False)
        self.buttons.append(e)
        e.pack(fill='x',ipady=10,pady=(0,16));return e

    def open_action(self, action, preserve_review=False):
        if self.busy:return
        if action=='sign' and (not self.review or not self.approved or not self.can_approve):return
        if not preserve_review:self.review=None;self.approved=False;self.can_approve=False
        self.mode='form';self.action=action;self.passphrase.set('');self.confirmation.set('')
        titles={'create':'Create a new vault','check':'Verify your passphrase','backup':'Create an encrypted backup','check-backup':'Verify your encrypted backup','restore':'Restore to an empty target','sign':'Sign your approved transaction'}
        self.clear(titles[action], '03 / Enter passphrase locally' if action=='sign' else self.profile_label.get())
        c=self.card('Your passphrase stays here','Local secret input')
        self.text(c,'It is hidden, sent through an anonymous pipe to the guarded worker, and cleared from the form after submission. It is not stored or logged.')
        if action=='sign':self.text(c,'You approved fingerprint:',11);self.text(c,self.review['fingerprint'],11,FG,mono=True)
        if action=='restore':self.text(c,'Place the expected encrypted backup in the exchange folder before booting. Both vault and public-wallet target files must be absent. Existing keys are never replaced.')
        e=self.entry(c,'Passphrase',self.passphrase)
        if action=='create':self.entry(c,'Repeat passphrase',self.confirmation)
        self.button(c,'Sign and save' if action=='sign' else titles[action],self.submit_secret,True).pack(fill='x',pady=8)
        self.button(c,'Cancel',self.cancel).pack(fill='x',pady=8)
        self.root.after_idle(e.focus_set)

    def submit_secret(self):
        if self.busy or not self.action:return
        action=self.action
        if action=='sign' and (not self.review or not self.approved or not self.can_approve):return
        payload={'scope':'trade','action':action,'password':self.passphrase.get()} if action=='sign' and self.trade_review else self.scoped(action,password=self.passphrase.get())
        if action=='create':payload.update(confirmation=self.confirmation.get(),consent=True)
        if action=='restore':payload['consent']=True
        if action=='sign':payload.update(fingerprint=self.review['fingerprint'],consent=True)
        if action in ('create','restore') and not messagebox.askyesno('Confirm '+action,'Proceed on the selected profile? Existing vaults will not be overwritten.',parent=self.root):
            payload.clear();self.passphrase.set('');self.confirmation.set('');return
        self.call(payload,self.operation_result)

    def operation_result(self, reply):
        self.passphrase.set('');self.confirmation.set('')
        if not reply.get('ok'):
            if self.action=='sign':
                self.review=None;self.approved=False;self.can_approve=False;self.action=None;self.mode='sign-error'
                self.clear('Signing stopped','Inspect Files before retrying. An uncertain write is never retried automatically.')
                self.text(self.body,reply.get('error','No success was recorded.'))
                self.button(self.body,'Open Files',lambda:self.show('Files'),True).pack(fill='x',pady=8)
            return
        action=self.action;self.review=None;self.approved=False;self.can_approve=False;self.mode='result';self.action=None
        self.clear('Signed response saved — not sent.' if reply.get('hash') else 'Operation complete',reply.get('message',''))
        c=self.card('Return online only after shutdown' if reply.get('hash') else 'Next step','Local result')
        if reply.get('hash'):
            filename='signed-trade-response.json' if self.trade_review else 'signed-multi-response.json' if self.profile=='multi' else 'signed-response.json'
            self.text(c,str(BASE/filename),12,FG,mono=True);self.text(c,'Transaction identifier',11);self.text(c,reply['hash'],12,FG,mono=True)
            self.text(c,'Import this response into the same saved online request. Verify it and explicitly submit. Signing is neither broadcasting nor confirmation.')
        elif action=='create':
            self.text(c,'Verify the new passphrase before shutting down, then create and verify an encrypted backup.')
            self.button(c,'Verify new passphrase',lambda:self.open_action('check'),True).pack(anchor='w',pady=6)
        elif action=='backup':
            self.text(c,str(BASE/('vault-multi-backup.json' if self.profile=='multi' else 'vault-backup.json')),12,FG)
            self.button(c,'Verify this backup',lambda:self.open_action('check-backup'),True).pack(anchor='w',pady=6)
        self.button(c,'Return home',lambda:self.show('Home')).pack(anchor='w',pady=6)
        self.button(c,'Safe shutdown',self.shutdown).pack(anchor='w',pady=6)
        self.refresh(render=False)

    def show_qr(self,address,title):
        if self.busy:return
        self.show(self.section)
        self.mode='qr';self.clear('Public address',title)
        c=self.card('Compare the complete address')
        self.text(c,address,12,FG,mono=True)
        # qrencode is packaged in the ISO. Arguments contain only validated PUBLIC addresses.
        try:
            result=subprocess.run(['/usr/bin/qrencode','-t','PNG','-o','-','-s','5','-m','4',address],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=5,check=True)
            picture=tk.PhotoImage(data=result.stdout);self.images.append(picture)
            tk.Label(c,image=picture,bg=PANEL).pack(anchor='w',pady=12)
        except Exception:self.text(c,'QR unavailable. Use the complete public address above.')
        self.text(c,'Address only. This QR does not request or send a payment.')
        self.button(c,'Back to Receive',lambda:self.show('Receive')).pack(fill='x')

    def clock_form(self):
        if self.busy:return
        self.show(self.section);self.mode='clock'
        self.clear('UTC clock · read only','All request and signing times use UTC. Z means UTC.')
        c=self.card('Clock editing disabled')
        self.label(c,variable=self.clock,size=16).pack(anchor='w',pady=8)
        self.text(c,'Windows / Warsaw hardware-clock edition. At startup, Europe/Warsaw hardware time is converted to UTC once, using seasonal timezone rules. The hardware clock is never written.')
        self.text(c,'Use this edition only when the PC hardware clock keeps Warsaw local time. Clock editing is disabled. A UTC label does not independently verify clock accuracy.')
        self.text(c,'If this differs from an independent UTC clock, stop signing and shut down. Do not use a request timestamp or deadline to set the clock.')
        self.text(c,'The connected companion checks expiry again before submission. Native ETH transaction signatures do not carry an on-chain expiry.')
        self.button(c,'Back',self.cancel).pack(anchor='w',pady=8)

    def call(self,payload,callback,quiet=False):
        if self.busy:return
        self.busy=True;self.passphrase.set('');self.confirmation.set('')
        self.sync_background()
        for b in self.buttons:
            if b.winfo_exists():b.configure(state='disabled')
        if not quiet:self.message.set('Working locally. Keep the USB connected…')
        def work():
            try:
                command=WORKER
                result=subprocess.run(command,input=json.dumps(payload),text=True,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=120,check=False)
                reply=json.loads(result.stdout) if len(result.stdout)<=131072 else {'ok':False,'error':'Worker response exceeded the local limit.'}
                if not isinstance(reply,dict):raise ValueError('Invalid worker result')
            except Exception:reply={'ok':False,'error':'Operation stopped or timed out. Inspect Files before retrying: a write may have completed. No automatic retry was attempted.'}
            finally:payload.clear()
            self.results.put((reply,callback,quiet))
        threading.Thread(target=work,daemon=True).start()

    def poll(self):
        try:
            reply,callback,quiet=self.results.get_nowait();self.busy=False
            for b in self.buttons:
                if b.winfo_exists():b.configure(state='normal')
            if not reply.get('ok'):
                self.message.set(reply.get('error','Operation stopped.'));self.guard_status.set('Isolation unverified')
            elif not quiet:self.message.set(reply.get('message','Local operation finished.'))
            callback(reply)
            self.sync_background()
        except queue.Empty:pass
        self.root.after(60,self.poll)

    def refresh(self,render=True):
        def done(reply):
            if reply.get('dashboard'):
                changed={k:v for k,v in self.inventory.items() if k!='utc'}!={k:v for k,v in reply['dashboard'].items() if k!='utc'};self.inventory=reply['dashboard']
                self.guard_status.set('Guard checked '+str(self.inventory.get('utc',''))[11:16]+' UTC')
                if render and self.mode=='section' and changed:self.show(self.section)
                if self.message.get().startswith('Reading local storage'):self.message.set('Local storage inspected. Network isolation guard passed; vault passphrases are not verified.')
        self.call({'action':'dashboard'},done,quiet=True)

    def auto_refresh(self):
        if not self.busy and self.mode=='section' and not self.settings_modal:self.refresh()
        self.root.after(5000,self.auto_refresh)

    def tick(self):
        self.clock.set(dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d  %H:%M:%S UTC'))
        self.root.after(1000,self.tick)

    def cancel(self):
        if self.settings_modal:self.settings_modal.close();return
        if not self.busy:self.show(self.section);self.message.set('Cancelled. No signing operation requested.')

    def recovery(self):
        if self.busy:return
        if messagebox.askyesno('Terminal recovery','Close the desktop and open the existing terminal recovery interface?',parent=self.root):
            self.passphrase.set('');self.confirmation.set('');self.exit_code=43;self.root.destroy()

    def shutdown(self):
        if self.busy:return
        if messagebox.askyesno('Safe shutdown','Flush the exchange drive and power off? Keep the USB connected until the machine is fully off.',parent=self.root):
            self.passphrase.set('');self.confirmation.set('');self.exit_code=42;self.root.destroy()


if __name__=='__main__':
    root=tk.Tk();app=DriveKeyDesktop(root);root.mainloop();raise SystemExit(app.exit_code)

