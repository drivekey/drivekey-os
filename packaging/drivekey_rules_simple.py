"""Presentation-only guided rules editor; the guarded worker remains authoritative."""
import copy
import datetime as dt
import re
import tkinter as tk
from decimal import Decimal
import drivekey_theme as theme

DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
CATEGORIES = ['General','Software','Cloud services','Office','Travel','Food','Utilities','Education','Other']
TITLES = {'perPayment':'Maximum per payment','rolling':'Daily allowance','sevenDay':'Seven-day budget','thirtyDay':'30-day budget','approvalAbove':'Ask for offline approval above','count':'Payments in any 24 hours','agent':'Agent','approver':'Offline approver','guardian':'Emergency stop wallet','paused':'Spending stopped','expires':'Rules expire','weekdays':'Allowed days','startMinute':'Start UTC','endMinute':'End UTC','categories':'Allowed categories','category':'Category','recipient':'Recipient'}
AMOUNTS = ('perPayment','rolling','sevenDay','thirtyDay','approvalAbove')

def decimal_text(value, decimals):
    whole, fraction = divmod(int(value),10**decimals)
    tail = str(fraction).rjust(decimals,'0').rstrip('0') if decimals else ''
    return str(whole)+('.'+tail if tail else '')

def parse_amount(value, decimals):
    if not re.fullmatch(r'(0|[1-9][0-9]*)(\.[0-9]{1,'+str(decimals)+r'})?' if decimals else r'(0|[1-9][0-9]*)',value):
        raise ValueError('Enter an exact amount with at most '+str(decimals)+' decimal places.')
    whole,_,fraction=value.partition('.')
    units=int(whole)*10**decimals+int(fraction.ljust(decimals,'0') or '0')
    if units>=2**128:raise ValueError('Amount is too large.')
    return str(units)

def derived_limits(daily):
    daily=int(daily)
    if daily*30>=2**128:raise ValueError('Daily allowance is too large to create the longer budgets. Enter a smaller amount.')
    return dict(sevenDay=str(daily*7),thirtyDay=str(daily*30),count=20)

def display_value(key,value,asset=None):
    if value is None:return 'Not set'
    if isinstance(value,dict):return '; '.join(TITLES.get(k,k)+': '+display_value(k,v,k if k in ('eth','usdg') else asset) for k,v in value.items())
    if key in AMOUNTS and asset:return decimal_text(value,18 if asset=='eth' else 6)+' '+asset.upper()
    if key=='expires':return dt.datetime.fromtimestamp(value,dt.timezone.utc).strftime('%d %b %Y, %H:%M UTC')
    if key in ('startMinute','endMinute'):return '%02d:%02d'%divmod(value,60)
    if key=='weekdays':return ', '.join(day for i,day in enumerate(DAYS) if value&(1<<i)) or 'No days'
    if key=='categories':return ', '.join(c for i,c in enumerate(CATEGORIES) if value&(1<<i)) or 'None'
    if key=='category':return CATEGORIES[value] if 0<=value<len(CATEGORIES) else str(value)
    if isinstance(value,bool):return 'Yes' if value else 'No'
    return str(value)

def change_text(change):
    parts=change['field'].split('.');key=parts[-1]
    asset=next((p for p in parts if p in ('eth','usdg')),None)
    prefix=('Recipient '+str(int(parts[1])+1)+' · ') if parts[0]=='recipients' and len(parts)>1 else ''
    if asset:prefix+=asset.upper()+' · '
    label=TITLES.get(key,'Recipient removed' if key.isdigit() else key)
    return prefix+label+': '+display_value(key,change['before'],asset)+' → '+display_value(key,change['after'],asset)

class SimpleRulesMixin:
    def __init__(self,app):
        self.simple=getattr(app,'rules_simple',True);self.step=0;self.panels=set();self.empty=set();self.defaults_pending=set();self.dirty=set();self.enabled=set();self.disabled_cache={}
        super().__init__(app)

    def loaded(self,reply):
        if not reply.get('ok'):return
        fresh=not reply['context'].get('rules') and not reply.get('draft')
        if fresh:
            self.defaults_pending={'eth','usdg'}
            self.empty={(asset,key) for asset in ('eth','usdg') for key in ('rolling','perPayment','approvalAbove')}
        r=(reply.get('draft') or {}).get('rules') or reply['context'].get('rules')
        if r:self.enabled={asset for asset in ('eth','usdg') if any(int(v) for v in r[asset].values())}
        super().loaded(reply)

    def field(self,parent,title,target,key,convert=str):
        var=super().field(parent,title,target,key,convert)
        self.compact_entries(parent)
        return var

    def compact_entries(self,parent):
        for widget in parent.winfo_children():
            if isinstance(widget,tk.Entry):widget.configure(font=theme.shared_font(self.app.root,11));widget.pack_configure(ipady=4,pady=(0,8))

    def amount(self,parent,title,target,key,asset):
        decimals=0 if key=='count' else 18 if asset=='eth' else 6
        global_limit=target is self.draft['rules'][asset]
        empty=global_limit and (asset,key) in self.empty
        var=tk.StringVar(value='' if empty else decimal_text(target[key],decimals))
        self.app.entry(parent,title,var,False);self.compact_entries(parent)
        def convert(value):
            if not value and global_limit and (asset,key) in self.empty:return None
            if key=='count':
                if not re.fullmatch(r'[0-9]+',value) or int(value)>4294967295:raise ValueError('Enter a payment count between 0 and 4294967295.')
                return int(value)
            return parse_amount(value,decimals)
        self.bindings.append((target,key,var,convert))
        var.trace_add('write',lambda *_:self.dirty.add((id(target),key)))
        if key=='count':return var
        maximum=10 if asset=='eth' else 10000
        scale=tk.Scale(parent,from_=0,to=1000,orient='horizontal',showvalue=False,takefocus=True,width=7,sliderlength=14,bg=theme.PANEL,fg=theme.FG,troughcolor=theme.EDGE,highlightthickness=1,highlightbackground=theme.EDGE,highlightcolor=theme.ACCENT)
        scale.set(min(1000,int(Decimal(var.get() or '0')*1000/maximum)))
        # Attach after initial rendering; drawing the slider must not write to the input.
        def move(value):
            var.set(decimal_text(int(Decimal(value))*maximum*10**decimals//1000,decimals))
        self.app.root.after_idle(lambda:scale.configure(command=move) if scale.winfo_exists() else None)
        scale.pack(fill='x',pady=(0,8));self.app.buttons.append(scale)
        self.app.tooltip(scale,'Arrow keys adjust the amount. Exact input preserves every decimal place.')
        return var

    def commit(self):
        updates=[];cleared=set();derived=[]
        for target,key,var,convert in self.bindings:
            value=convert(var.get())
            if value is None:continue
            updates.append((target,key,value))
            for asset in ('eth','usdg'):
                if target is self.draft['rules'][asset]:
                    cleared.add((asset,key))
                    if key=='rolling' and asset in self.defaults_pending and int(value)>0:
                        values=derived_limits(value)
                        derived.append((asset,target,{k:v for k,v in values.items() if (id(target),k) not in self.dirty}))
        # Validate everything before touching the draft, including derived overflow.
        for target,key,value in updates:target[key]=value
        for asset,target,values in derived:target.update(values);self.defaults_pending.discard(asset)
        self.empty-=cleared
        for recipient,var in self.label_bindings:
            if var.get() or recipient['recipient'] in self.draft['labels']:self.draft['labels'][recipient['recipient']]=var.get()
        addresses={r['recipient'] for r in self.draft['rules']['recipients']}
        self.draft['labels']={k:v for k,v in self.draft['labels'].items() if k in addresses}
        self.review=None

    def change_mode(self,simple):
        try:self.commit()
        except ValueError as e:self.app.message.set(str(e));return
        self.enabled|={asset for asset in ('eth','usdg') if any(int(v) for v in self.draft['rules'][asset].values())}
        self.simple=simple;self.app.rules_simple=simple;self.render()

    def toggle_panel(self,key):
        try:self.commit()
        except ValueError as e:self.app.message.set(str(e));return
        if key in self.panels:self.panels.remove(key)
        else:self.panels.add(key)
        self.render()

    def disclosure(self,parent,key,title):
        self.app.button(parent,('− ' if key in self.panels else '+ ')+title,lambda:self.toggle_panel(key),compact=True).pack(anchor='w',pady=(2,8))
        return key in self.panels

    def segment(self,parent,choices):
        # Adaptive rows remain reachable at 640 px and with larger text.
        row=self.app.adaptive_columns(parent,len(choices),700)
        for cell,(title,selected,action) in zip(row,choices):
            button=self.app.button(cell,title,action,compact=True)
            button.configure(bg=theme.ACTIVE if selected else theme.FIELD,fg=theme.FG,outline=theme.ACCENT if selected else theme.EDGE)
            button.pack(fill='x',pady=(0,6))

    def toggle_asset(self,asset):
        try:self.commit()
        except ValueError as e:self.app.message.set(str(e));return
        r=self.draft['rules']
        if asset in self.enabled:
            self.disabled_cache[asset]=copy.deepcopy(r[asset]);r[asset]={k:0 if k=='count' else '0' for k in r[asset]};self.enabled.remove(asset)
        else:
            self.enabled.add(asset)
            if asset in self.disabled_cache:r[asset].update(self.disabled_cache.pop(asset))
        self.render()

    def go(self,step):
        try:
            self.commit()
            if step>self.step and self.step==0 and any(asset in self.enabled for asset,key in self.empty):raise ValueError('Enter a daily allowance, maximum payment and approval threshold for each selected asset.')
        except ValueError as e:self.app.message.set(str(e));return
        self.step=step;self.render()

    def render(self):
        if not self.simple:
            super().render();self.mode_control();return
        a=self.app;a.mode='rules';a.passphrase.set('');self.bindings=[];self.label_bindings=[]
        a.clear('Agent wallet','Set the rules here. Apply your signed update online.')
        self.mode_control()
        a.text(a.body,'Last reported online '+self.draft['context']['reportedAt'],10)
        self.segment(a.body,[(title,self.step==i,lambda i=i:self.go(i)) for i,title in enumerate(('1  Spending','2  Recipients & timing','3  Review & sign'))])
        if self.step==0:self.spending()
        elif self.step==1:self.recipients_timing()
        else:
            box=a.card('Ready to review?', 'Check the complete permissions before signing.')
            self.spending_switch(box)
            a.text(box,'Review shows all limits, full addresses and changes. Signing does not activate the rules.')
            a.button(box,'Review these rules',self.save_review,True).pack(anchor='w',pady=8)
        actions=a.adaptive_columns(a.body,2,600)
        a.button(actions[0],'Back to Wallet' if self.step==0 else 'Back',lambda:a.show('Wallet') if self.step==0 else self.go(self.step-1)).pack(anchor='w',pady=8)
        if self.step<2:a.button(actions[1],'Continue',lambda:self.go(self.step+1),True).pack(anchor='e',pady=8)

    def mode_control(self):
        a=self.app;row=tk.Frame(a.body,bg=theme.PANEL)
        children=a.body.winfo_children();row.pack(fill='x',pady=(0,8),before=children[0] if children else None)
        for label,value in [('Simple',True),('Advanced',False)]:
            button=a.button(row,label,lambda v=value:self.change_mode(v),compact=True)
            button.configure(bg=theme.ACTIVE if self.simple==value else theme.FIELD,fg=theme.FG,outline=theme.ACCENT if self.simple==value else theme.EDGE)
            button.pack(side='left',padx=(0,6))

    def spending(self):
        a=self.app;r=self.draft['rules']
        selection=a.adaptive_columns(a.body,2,600)
        for cell,asset in zip(selection,('eth','usdg')):
            selected=asset in self.enabled
            button=a.button(cell,asset.upper()+('  Selected' if selected else '  Off'),lambda asset=asset:self.toggle_asset(asset),icon_name=asset.upper())
            button.configure(bg=theme.ACTIVE if selected else theme.FIELD,fg=theme.FG,outline=theme.ACCENT if selected else theme.EDGE,align='left',height=46)
            button.pack(fill='x',pady=(0,8))
        if not self.enabled:a.text(a.body,'Choose an asset to set its limits. Spending starts stopped.')
        columns=a.adaptive_columns(a.body,max(1,len(self.enabled)),900)
        for parent,asset in zip(columns,[s for s in ('eth','usdg') if s in self.enabled]):
            box=a.card(asset.upper(), 'Only approved recipients can be paid.',parent,icon_name=asset.upper())
            for key in ('rolling','perPayment','approvalAbove'):self.amount(box,TITLES[key],r[asset],key,asset)
            a.text(box,'Choose an approval threshold you are comfortable with. Above it, the separate offline approver must sign.',10)
            if self.disclosure(box,'limits-'+asset,'More limits'):
                for key in ('sevenDay','thirtyDay','count'):self.amount(box,TITLES[key],r[asset],key,asset)
            else:a.text(box,'Additional budgets and payment-count limits are preserved and shown in review.',10)

    def set_rules(self,values):
        try:self.commit()
        except ValueError as e:self.app.message.set(str(e));return
        self.draft['rules'].update(values);self.render()

    def recipients_timing(self):
        a=self.app;r=self.draft['rules'];c=self.draft['context']
        missing=any(not r[k] for k in ('agent','approver','guardian'))
        box=a.card('Wallet roles' if not missing else 'Connect your agent wallets','Separate addresses keep each role limited.',icon_name='Key')
        if missing or self.disclosure(box,'roles','Wallet roles'):
            for key,help_text in [('agent','Makes payments within your rules.'),('approver','Signs payments above your approval threshold, offline.'),('guardian','Can stop spending. Cannot resume it or change rules.')]:
                self.field(box,TITLES[key],r,key);a.text(box,help_text,10)
            a.text(box,'Owner: '+c['owner'],10,theme.FG,mono=True)
        for index,recipient in enumerate(r['recipients']):
            box=a.card('Recipient '+str(index+1),parent=a.body,icon_name='User')
            name=tk.StringVar(value=self.draft['labels'].get(recipient['recipient'],''));a.entry(box,'Local name',name,False);self.compact_entries(box);self.label_bindings.append((recipient,name))
            self.field(box,'Full address',recipient,'recipient')
            a.text(box,'Category: '+display_value('category',recipient['category'])+'. Individual caps stay unchanged when global limits increase.',10)
            if self.disclosure(box,'recipient-'+str(index),'Individual limits and category'):
                self.field(box,'Category (0–8)',recipient,'category',int)
                for asset in ('eth','usdg'):
                    for key in (*AMOUNTS,'count'):self.amount(box,asset.upper()+' · '+TITLES[key],recipient[asset],key,asset)
            a.button(box,'Remove recipient',lambda i=index:self.remove(i),compact=True).pack(anchor='w')
        a.button(a.body,'Add recipient',self.add,True,compact=True).pack(anchor='w',pady=(0,12))
        box=a.card('When can it pay?', 'All times are UTC.',icon_name='History')
        self.segment(box,[('Every day',r['weekdays']==127,lambda:self.set_rules({'weekdays':127})),('Choose days','days' in self.panels,lambda:self.toggle_panel('days'))])
        if r['weekdays']!=127 or 'days' in self.panels:self.mask(box,'Allowed weekdays',r,'weekdays',DAYS)
        self.segment(box,[('All day',r['startMinute']==0 and r['endMinute']==1440,lambda:self.set_rules({'startMinute':0,'endMinute':1440})),('Custom hours','hours' in self.panels,lambda:self.toggle_panel('hours'))])
        if r['startMinute']!=0 or r['endMinute']!=1440 or 'hours' in self.panels:
            for key in ('startMinute','endMinute'):
                var=tk.StringVar(value=display_value(key,r[key]));a.entry(box,TITLES[key],var,False);self.compact_entries(box);self.bindings.append((r,key,var,self.minute))
        a.text(box,'Expires '+display_value('expires',r['expires']),11,theme.FG)
        self.segment(box,[(label,False,lambda days=days:self.set_rules({'expires':int(dt.datetime.now(dt.timezone.utc).timestamp())+days*86400})) for label,days in [('7 days',7),('30 days',30)]]+[('Custom','expiry' in self.panels,lambda:self.toggle_panel('expiry'))])
        if 'expiry' in self.panels:
            for target,key,title in [(r,'expires','Rules expire UTC'),(self.draft,'authorizationExpiry','Signed update expires UTC')]:
                value=dt.datetime.fromtimestamp(target[key],dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ');var=tk.StringVar(value=value);a.entry(box,title,var,False);self.compact_entries(box)
                self.bindings.append((target,key,var,lambda s:int(dt.datetime.strptime(s,'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc).timestamp())))
        a.text(box,'Categories: '+display_value('categories',r['categories']),10)
        if self.disclosure(box,'categories','Additional settings'):self.mask(box,'Allowed categories',r,'categories',CATEGORIES)

    def category(self,parent,recipient):
        self.app.text(parent,'Category',11,theme.FG)
        var=tk.StringVar(value=CATEGORIES[recipient['category']])
        menu=tk.OptionMenu(parent,var,*CATEGORIES)
        menu.configure(bg=theme.PANEL,fg=theme.FG,activebackground=theme.EDGE,activeforeground=theme.FG,highlightthickness=1,highlightbackground=theme.EDGE,takefocus=True,font=theme.shared_font(self.app.root,11))
        menu['menu'].configure(bg=theme.PANEL,fg=theme.FG)
        menu.pack(anchor='w',pady=(0,8));self.app.buttons.append(menu)
        self.bindings.append((recipient,'category',var,CATEGORIES.index))

    def mask(self,parent,title,target,key,labels):
        self.app.text(parent,title,11,theme.FG);values=[]
        for i,label in enumerate(labels):
            var=tk.BooleanVar(value=bool(target[key]&(1<<i)));values.append(var)
            control=tk.Checkbutton(parent,text=label,variable=var,bg=theme.PANEL,fg=theme.FG,activebackground=theme.PANEL,activeforeground=theme.FG,selectcolor=theme.PANEL,takefocus=True,font=theme.shared_font(self.app.root,11))
            control.pack(anchor='w');self.app.buttons.append(control)
        class Mask:
            def get(self):return sum(1<<i for i,v in enumerate(values) if v.get())
        self.bindings.append((target,key,Mask(),int))

    def spending_switch(self,parent):
        from drivekey_widgets import Toggle as ToggleSwitch
        r=self.draft['rules'];var=tk.BooleanVar(value=r['paused'])
        self.app.text(parent,'Keep spending stopped',11,theme.FG)
        control=ToggleSwitch(parent,variable=var);control.pack(anchor='w',pady=8);self.app.buttons.append(control)
        self.bindings.append((r,'paused',var,bool))
        self.app.text(parent,'Turn off only when you want this signed update to enable spending after confirmation.',10)

    def add(self):
        try:self.commit()
        except ValueError as e:self.app.message.set(str(e));return
        r=self.draft['rules']
        if len(r['recipients'])>=16:self.app.message.set('Up to 16 recipients are supported.');return
        r['recipients'].append(dict(recipient='',category=0,eth=copy.deepcopy(r['eth']),usdg=copy.deepcopy(r['usdg'])))
        # Explicit addition of a General recipient enables its category in a new empty policy only.
        if not self.draft['context']['rules'] and r['categories']==0:r['categories']=1
        self.render()

    def save_review(self):
        try:
            self.commit()
            self.enabled|={asset for asset in ('eth','usdg') if any(int(v) for v in self.draft['rules'][asset].values())}
            if any(asset in self.enabled for asset,key in self.empty):raise ValueError('Enter all three spending amounts for each selected asset before review.')
        except ValueError as e:self.app.message.set(str(e));return
        super().save_review()

    def reviewed(self,reply):
        if not reply.get('ok'):return
        self.review=reply;a=self.app;a.clear('Review your rules','Draft · not signed or active')
        for line in reply['explanation']:a.text(a.body,line,11,theme.FG)
        for asset,value in reply.get('exposure',{}).items():a.text(a.body,'Maximum exposure: '+value['display']+' '+asset.upper()+'. '+value['label'],10)
        box=a.card('What changes','Highlighted changes need attention: new authority, role changes or removed restrictions.')
        if not reply['changes']:a.text(box,'No rule changes.')
        for change in reply['changes']:a.text(box,change_text(change),10,theme.ACCENT if change['expanded'] else theme.FG)
        d=reply['draft'];c=d['context'];r=d['rules']
        box=a.card('Complete permissions','All effective limits apply, including individual recipient caps.')
        a.text(box,'Spending '+('stays stopped' if r['paused'] else 'starts after verified application'),12,theme.FG)
        for key in ('weekdays','startMinute','endMinute','categories','expires'):a.text(box,TITLES[key]+': '+display_value(key,r[key]),11,theme.FG)
        a.text(box,'Signed update expires: '+display_value('expires',d['authorizationExpiry']))
        def limits(parent,policy):
            for asset in ('eth','usdg'):
                for key in (*AMOUNTS,'count'):a.text(parent,asset.upper()+' · '+TITLES[key]+': '+display_value(key,policy[asset][key],asset),11,theme.FG)
        limits(box,r)
        for recipient in r['recipients']:
            box=a.card(d['labels'].get(recipient['recipient']) or 'Approved recipient')
            a.text(box,recipient['recipient'],11,theme.FG,mono=True);a.text(box,'Category: '+display_value('category',recipient['category']));limits(box,recipient)
        box=a.card('Wallets and authority','Compare the complete addresses.')
        for title,key in [('Policy account','account'),('Registry','registry'),('Offline owner','owner')]:a.text(box,title+': '+c[key],11,theme.FG,mono=True)
        for key in ('agent','approver','guardian'):a.text(box,TITLES[key]+': '+r[key],11,theme.FG,mono=True)
        a.text(box,'Robinhood Chain 4663. Labels never authorize a recipient. Hard caps always apply; gas is paid separately.')
        a.text(box,'Daily allowance covers any 24 hours and can stay reserved for one extra hour. Seven-day and 30-day budgets use fixed periods, not calendar periods.')
        technical=tk.Frame(a.body,bg=theme.PANEL)
        def details():
            if technical.winfo_manager():technical.pack_forget();return
            technical.pack(fill='x',before=approval)
        a.button(a.body,'Technical details',details,compact=True).pack(anchor='w',pady=8)
        for key in ('contractVersion','ownerEpoch','revision','safetyEpoch','policyHash','accountCodeHash','registryCodeHash'):
            a.text(technical,key+': '+str(c[key]),10,mono=True)
        a.text(technical,'Authorization fingerprint: '+reply['fingerprint'],10,mono=True)
        approval=a.button(a.body,'Approve these rules',self.approve,True);approval.pack(anchor='w',pady=8)
        a.button(a.body,'Edit rules',self.render).pack(anchor='w')
