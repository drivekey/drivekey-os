"""RC20 rules editor. Decimal strings, never floating-point amounts, own authority."""
import copy
import datetime as dt
import json
import re
import tkinter as tk
from decimal import Decimal
import drivekey_theme as theme
from drivekey_theme import shared_font

FIELDS = [('perPayment','Maximum per payment'),('rolling','Any-24-hour allowance'),('sevenDay','Seven-day budget'),('thirtyDay','30-day budget'),('approvalAbove','Ask for offline approval above…'),('count','Payment count within any 24 hours')]

def inspect_payment_approval(app):
    profile=app.profile
    def reviewed(reply):
        if not reply.get('ok'):return
        app.mode='rules-approval';app.clear('Review agent payment','Separate offline approver · exact payment only')
        request=reply['approval'];p=request['payment'];c=request['context']
        app.text(app.body,'Last reported online '+c['reportedAt']+'. Imported observation.')
        native=p['asset']=='0x'+'0'*40
        for title,value in [('Network','Robinhood Chain 4663'),('Policy account',c['account']),('Recipient',p['recipient']),('Asset',p['asset']),('Amount',decimal_text(p['amount'],18 if native else 6)+(' ETH' if native else ' USDG')),('Category',p['category']),('Policy revision',p['revision']),('Safety epoch',p['safetyEpoch']),('Payment ID',p['paymentId']),('Expiry UTC',dt.datetime.fromtimestamp(p['expiry'],dt.timezone.utc).isoformat())]:
            app.text(app.body,title,11);app.text(app.body,str(value),12,theme.FG,mono=True)
        def approve():
            app.clear('Sign approved agent payment','Passphrase signing is a separate step');app.passphrase.set('')
            box=app.card('Separate approver vault',icon_name='Lock');app.entry(box,'Vault passphrase',app.passphrase).focus_set()
            def sign():
                if app.profile!=profile or app.mode!='rules-approval':return
                app.call(dict(scope='rules',profile=profile,action='sign-approval',consent=True,fingerprint=reply['fingerprint'],password=app.passphrase.get()),done)
            def done(result):
                app.passphrase.set('');app.clear('Approval signed—awaiting application' if result.get('ok') else 'Signing stopped',result.get('message',result.get('error','Inspect Files.')))
                app.text(app.body,'rules-signed-payment-approval.json. Hard caps, schedule and current policy are checked again at execution.')
                app.button(app.body,'Back to Wallet',lambda:app.show('Wallet')).pack(anchor='w')
            app.button(box,'Sign payment approval',sign,True).pack(anchor='w')
            app.button(box,'Cancel',lambda:app.show('Wallet')).pack(anchor='w')
        app.button(app.body,'Approve exact payment',approve,True).pack(anchor='w')
        app.button(app.body,'Cancel',lambda:app.show('Wallet')).pack(anchor='w')
    app.call(dict(scope='rules',profile=profile,action='inspect-approval'),reviewed)

def base_units(text, decimals):
    if not re.fullmatch(r'(0|[1-9][0-9]*)(\.[0-9]{1,'+str(decimals)+r'})?' if decimals else r'(0|[1-9][0-9]*)',text):
        raise ValueError('Enter an exact nonnegative amount with at most '+str(decimals)+' decimal places.')
    whole, _, fraction = text.partition('.')
    value = int(whole)*10**decimals+int(fraction.ljust(decimals,'0') or '0')
    if value >= 2**128: raise ValueError('Amount is too large.')
    return value

def decimal_text(value, decimals):
    value=int(value)
    if not decimals:return str(value)
    whole,fraction=divmod(value,10**decimals)
    tail=str(fraction).rjust(decimals,'0').rstrip('0')
    return str(whole)+('.'+tail if tail else '')

class AdvancedRulesEditor:
    def __init__(self,app):
        self.app=app;self.profile=app.profile;self.tab='Limits';self.draft=None;self.bindings=[];self.review=None
        app.call({'scope':'rules','profile':self.profile,'action':'context'},self.loaded)

    def loaded(self,reply):
        if not reply.get('ok'):return
        c=reply['context'];now=int(dt.datetime.now(dt.timezone.utc).timestamp())
        zero={k:0 if k=='count' else '0' for k,_ in FIELDS}
        # Existing policies are copied completely. New accounts have no spend authority.
        rules=copy.deepcopy(c['rules']) if c['rules'] else dict(agent='',approver='',guardian='',expires=now+30*86400,weekdays=127,startMinute=0,endMinute=1440,categories=0,paused=True,eth=zero.copy(),usdg=zero.copy(),recipients=[])
        self.draft=reply.get('draft') or dict(kind='drivekey-rules-draft',version=1,context=c,rules=rules,authorizationExpiry=now+86400,labels={})
        self.render()

    def commit(self):
        updates=[]
        for target,key,var,convert in self.bindings:updates.append((target,key,convert(var.get())))
        for target,key,value in updates:target[key]=value
        for recipient,var in self.label_bindings:self.draft['labels'][recipient['recipient']]=var.get()
        addresses={r['recipient'] for r in self.draft['rules']['recipients']}
        self.draft['labels']={k:v for k,v in self.draft['labels'].items() if k in addresses}
        self.review=None

    def switch(self,tab):
        try:self.commit()
        except ValueError as e:self.app.message.set(str(e));return
        self.tab=tab;self.render()

    def field(self,parent,title,target,key,convert=str):
        var=tk.StringVar(value=str(target.get(key,'')));self.app.entry(parent,title,var,False)
        self.bindings.append((target,key,var,convert));return var

    def amount(self,parent,title,target,key,asset):
        decimals=0 if key=='count' else 18 if asset=='eth' else 6
        var=tk.StringVar(value=decimal_text(target[key],decimals));self.app.entry(parent,title,var,False)
        self.bindings.append((target,key,var,lambda x:int(x) if key=='count' and re.fullmatch(r'[0-9]+',x) else (str(base_units(x,decimals)) if key!='count' else (_ for _ in ()).throw(ValueError('Invalid payment count')))))
        if key=='count':return
        # Slider is an explicit coarse edit; initial display never writes back to the exact input.
        maximum=10 if asset=='eth' else 10000
        scale=tk.Scale(parent,from_=0,to=1000,orient='horizontal',showvalue=False,takefocus=True,bg=theme.PANEL,fg=theme.FG,troughcolor=theme.EDGE,highlightbackground=theme.EDGE)
        scale.set(min(1000,int(Decimal(var.get())*1000/maximum)))
        def move(value):
            exact=decimal_text(int(Decimal(value))*maximum*10**decimals//1000,decimals)
            if exact!=var.get():
                self.app.message.set('Slider set an exact amount of '+exact+' '+asset.upper()+'. Review before saving.')
                var.set(exact)
        scale.configure(command=move);scale.pack(fill='x',pady=(0,12));self.app.buttons.append(scale)
        self.app.tooltip(scale,'Arrow keys change the amount. Exact input supports every base unit; displaying the slider never rounds it.')

    def render(self):
        a=self.app;a.mode='rules';a.passphrase.set('');self.bindings=[];self.label_bindings=[]
        a.clear('Agent rules','Draft · Robinhood Chain 4663 · separately funded policy account')
        c=self.draft['context'];r=self.draft['rules']
        a.text(a.body,'Last reported online '+c['reportedAt']+'. Imported observation; not fresh chain verification.',10)
        tabs=tk.Frame(a.body,bg=theme.PANEL);tabs.pack(fill='x',pady=8)
        for tab in ('Limits','Recipients','Schedule','Review'):a.button(tabs,tab,lambda t=tab:self.switch(t),tab==self.tab,compact=True).pack(side='left',padx=3)
        if self.tab=='Limits':
            box=a.card('Who may act','Only the offline owner can authorize changes',icon_name='Key')
            for key in ('agent','approver','guardian'):self.field(box,key.capitalize()+' address',r,key)
            a.text(box,'Owner: '+c['owner'],11,theme.FG,mono=True)
            columns=a.adaptive_columns(a.body,2,980)
            for i,asset in enumerate(('eth','usdg')):
                box=a.card(asset.upper()+' limits','Integer base units are authoritative',columns[i],icon_name='ETH' if asset=='eth' else 'USDG')
                for key,title in FIELDS:self.amount(box,title,r[asset],key,asset)
                a.tooltip(box,'The any-24-hour allowance uses conservative hourly buckets. Some allowance can remain reserved for up to one additional hour. Seven-day and 30-day budgets use fixed Unix-epoch periods.')
                explanation=tk.StringVar()
                def update(*_,asset=asset,explanation=explanation):
                    values={key:var.get() for target,key,var,_ in self.bindings if target is r[asset]}
                    explanation.set('This agent may send up to '+values.get('perPayment','0')+' '+asset.upper()+' per payment and '+values.get('rolling','0')+' within any 24 hours, only to these recipients. Payments above '+values.get('approvalAbove','0')+' require offline approval.')
                for target,key,var,_ in self.bindings:
                    if target is r[asset]:var.trace_add('write',update)
                explanation_label=a.label(box,variable=explanation,size=11,color=theme.MUTED);explanation_label.configure(wraplength=240);explanation_label.pack(fill='x',pady=8)
                explanation_label.bind('<Configure>',lambda e:e.widget.configure(wraplength=max(100,e.width-8)));update()
        elif self.tab=='Recipients':
            a.text(a.body,'Names are local labels, never authorization. Categories are numbers 0–8; the schedule controls allowed categories.')
            for index,recipient in enumerate(r['recipients']):
                box=a.card('Recipient '+str(index+1),icon_name='User')
                self.field(box,'Full address',recipient,'recipient')
                self.field(box,'Category (0–8)',recipient,'category',int)
                # Labels are deliberately outside the signed bundle.
                name=tk.StringVar(value=self.draft['labels'].get(recipient['recipient'],''));a.entry(box,'Local label',name,False);self.label_bindings.append((recipient,name))
                for asset in ('eth','usdg'):
                    a.text(box,asset.upper(),12,theme.FG)
                    for key,title in FIELDS:self.amount(box,title,recipient[asset],key,asset)
                a.button(box,'Remove recipient',lambda i=index:self.remove(i)).pack(anchor='w')
            a.button(a.body,'Add recipient',self.add,True).pack(anchor='w',pady=8)
        elif self.tab=='Schedule':
            box=a.card('Schedule and expiry','All times are UTC',icon_name='History')
            self.mask(box,'Allowed weekdays',r,'weekdays',['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'])
            for key,title in [('startMinute','Start UTC'),('endMinute','End UTC')]:
                var=tk.StringVar(value='%02d:%02d'%divmod(r[key],60));a.entry(box,title+' (HH:MM)',var,False)
                self.bindings.append((r,key,var,self.minute))
            self.mask(box,'Allowed categories',r,'categories',['General','Software','Cloud services','Office','Travel','Food','Utilities','Education','Other'])
            for target,key,title in [(r,'expires','Required rules expiry UTC'),(self.draft,'authorizationExpiry','Authorization expiry UTC')]:
                var=tk.StringVar(value=dt.datetime.fromtimestamp(target[key],dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'));a.entry(box,title,var,False)
                self.bindings.append((target,key,var,lambda x:int(dt.datetime.strptime(x,'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc).timestamp())))
            var=tk.BooleanVar(value=r['paused']);control=tk.Checkbutton(box,text='Keep spending stopped',variable=var,bg=theme.PANEL,fg=theme.FG,selectcolor=theme.PANEL);control.pack(anchor='w');a.buttons.append(control)
            self.bindings.append((r,'paused',var,bool))
            a.text(box,'Resuming always needs a fresh offline owner authorization. New drafts default to a 30-day expiry. Gas is paid from the separate relayer wallet, outside these transfer budgets.')
        else:
            a.text(a.body,'Save the complete draft, then inspect the worker-validated permissions and previous → new changes.')
            a.button(a.body,'Save draft and review',self.save_review,True).pack(anchor='w',pady=8)
        a.button(a.body,'Back to Wallet',lambda:a.show('Wallet')).pack(anchor='w',pady=12)

    @staticmethod
    def minute(value):
        if not re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]|24:00',value):raise ValueError('Enter a UTC time in HH:MM format.')
        h,m=value.split(':');return int(h)*60+int(m)

    def mask(self,parent,title,target,key,labels):
        self.app.text(parent,title,12,theme.FG);values=[]
        for i,label in enumerate(labels):
            var=tk.BooleanVar(value=bool(target[key]&(1<<i)));values.append(var)
            check=tk.Checkbutton(parent,text=label,variable=var,bg=theme.PANEL,fg=theme.FG,selectcolor=theme.PANEL);check.pack(anchor='w');self.app.buttons.append(check)
        class Mask:
            def get(self):return sum(1<<i for i,v in enumerate(values) if v.get())
        self.bindings.append((target,key,Mask(),int))

    def add(self):
        try:self.commit()
        except ValueError as e:self.app.message.set(str(e));return
        if len(self.draft['rules']['recipients'])>=16:return
        zero={k:0 if k=='count' else '0' for k,_ in FIELDS}
        self.draft['rules']['recipients'].append(dict(recipient='',category=0,eth=zero.copy(),usdg=zero.copy()));self.render()
    def remove(self,index):
        try:self.commit()
        except ValueError as e:self.app.message.set(str(e));return
        del self.draft['rules']['recipients'][index];self.render()
    def save_review(self):
        try:self.commit()
        except ValueError as e:self.app.message.set(str(e));return
        self.draft['labels']={k:v for k,v in self.draft['labels'].items() if re.fullmatch(r'0x[0-9a-fA-F]{40}',k)}
        self.app.call(dict(scope='rules',profile=self.profile,action='save',draft=self.draft),lambda reply:self.app.call(dict(scope='rules',profile=self.profile,action='review'),self.reviewed) if reply.get('ok') else None)
    def reviewed(self,reply):
        if not reply.get('ok'):return
        self.review=reply;a=self.app;a.clear('Review complete authority','Draft · not signed or active')
        for line in reply['explanation']:a.text(a.body,line,12,theme.FG)
        for asset,value in reply.get('exposure',{}).items():a.text(a.body,'Maximum exposure: '+value['display']+' '+asset.upper()+'. '+value['label'],11,theme.FG)
        a.text(a.body,'Fixed seven-day and 30-day periods may reset before expiry. Gas is paid separately; the policy account never reimburses it.')
        for change in reply['changes']:a.text(a.body,change['field']+': '+str(change['before'])+' → '+str(change['after']),11,theme.ACCENT if change['expanded'] else theme.MUTED)
        box=a.card('Every resulting permission and bound account','Compare complete addresses')
        d=reply['draft'];c=d['context'];r=d['rules']
        for title,key in [('Policy account','account'),('Registry','registry'),('Offline owner','owner')]:a.text(box,title+': '+c[key],11,theme.FG,mono=True)
        a.text(box,'Robinhood Chain 4663 · contract version 4 · owner epoch '+str(c['ownerEpoch'])+' · expected policy revision '+str(c['revision'])+' · safety epoch '+str(c['safetyEpoch']))
        for key in ('agent','approver','guardian'):a.text(box,key.capitalize()+': '+r[key],11,theme.FG,mono=True)
        a.text(box,'Spending: '+('stopped' if r['paused'] else 'enabled after verified application'))
        days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
        a.text(box,'Allowed days: '+', '.join(day for i,day in enumerate(days) if r['weekdays']&(1<<i)))
        a.text(box,'UTC hours: %02d:%02d–%02d:%02d'%(*divmod(r['startMinute'],60),*divmod(r['endMinute'],60)))
        a.text(box,'Allowed categories: '+', '.join(str(i) for i in range(9) if r['categories']&(1<<i)))
        for title,seconds in [('Rules expire',r['expires']),('Authorization expires',d['authorizationExpiry'])]:a.text(box,title+': '+dt.datetime.fromtimestamp(seconds,dt.timezone.utc).isoformat())
        def limits(parent,policy):
            for asset in ('eth','usdg'):
                for key,title in FIELDS:a.text(parent,asset.upper()+' · '+title+': '+decimal_text(policy[asset][key],0 if key=='count' else 18 if asset=='eth' else 6),11,theme.FG)
        limits(box,r)
        for recipient in r['recipients']:
            a.text(box,'Recipient: '+recipient['recipient'],11,theme.FG,mono=True);a.text(box,'Category '+str(recipient['category']));limits(box,recipient)
        a.text(box,'Names are local labels only. Amounts above either global or recipient approval threshold require the separate approver; hard caps always apply.')
        a.text(box,'Authorization fingerprint: '+reply['fingerprint'],10,theme.FG,mono=True)
        a.button(a.body,'Approve these rules',self.approve,True).pack(anchor='w',pady=8)
        a.button(a.body,'Edit rules',self.render).pack(anchor='w')
    def approve(self):
        if not self.review:return
        a=self.app;a.clear('Sign approved rules','Passphrase signing is a separate step');a.passphrase.set('')
        box=a.card('Offline owner signature',icon_name='Lock');a.entry(box,'Vault passphrase',a.passphrase).focus_set()
        a.button(box,'Sign rules',self.sign,True).pack(anchor='w',pady=8)
        a.button(box,'Cancel',lambda:a.show('Wallet')).pack(anchor='w')
    def sign(self):
        a=self.app
        if not self.review or a.profile!=self.profile or a.mode!='rules':return
        a.call(dict(scope='rules',profile=self.profile,action='sign',fingerprint=self.review['fingerprint'],consent=True,password=a.passphrase.get()),self.signed)
    def signed(self,reply):
        self.review=None;self.app.passphrase.set('')
        self.app.clear('Signed—awaiting application' if reply.get('ok') else 'Signing stopped',reply.get('message',reply.get('error','Inspect Files before retrying.')))
        self.app.text(self.app.body,'rules-signed-authorization.json · Import online, verify and explicitly Apply. No funds have been sent.')
        self.app.button(self.app.body,'Return to Wallet',lambda:self.app.show('Wallet')).pack(anchor='w')

from drivekey_rules_simple import SimpleRulesMixin

class RulesEditor(SimpleRulesMixin, AdvancedRulesEditor):
    """One draft, two presentation modes; unchanged guarded signing interface."""
    pass
