#!/usr/bin/python3
"""Offline curses frontend. Secrets travel only over an anonymous worker pipe."""
import curses
import datetime
import json
import os
import pathlib
import subprocess
import sys
import textwrap
import time
import unicodedata
from drivekey_dashboard import render as render_dashboard, amount as storage_amount
import drivekey_workspace as workspace

ROOT = pathlib.Path('/opt/drivekey')
DATA = '/mnt/drivekey/DriveKey'
MENU = ['Create a vault', 'Review and sign a transaction', 'Check vault / password',
        'Export public wallet file', 'Backup / verify backup', 'Device status and help',
        'Safely shut down', 'Multi-chain experimental tools', 'UTC clock (read only)']
MULTI = False
SOL_ONLY = False
HINTS = [
    ('01 / INITIALIZE', 'Create encrypted keys locally. Existing vaults are never replaced.'),
    ('02 / AUTHORIZE', 'Inspect every field, approve explicitly, then unlock locally. Signing does not send funds.'),
    ('03 / VERIFY', 'Check your passphrase and public address without creating a signature.'),
    ('04 / CONNECT', 'Export public addresses only. The encrypted vault stays off the website.'),
    ('05 / RECOVER', 'Create or verify an encrypted backup. Keep a separate copy away from this USB.'),
    ('06 / DIAGNOSTICS', 'Inspect device information, commands and the security model.'),
    ('07 / POWER DOWN', 'Flush files and unmount storage before switching the PC off.'),
    ('08 / MULTI-CHAIN', 'Separate multi-chain vault tools for Solana and Robinhood. Experimental.'),
    ('09 / TIME', 'Check UTC against an independent clock. Never use a deadline as the current time.')
]
TABS = [('OVERVIEW',list(range(9))), ('VAULT',[0,2,3,4]),
        ('SIGN',[1,7]), ('SYSTEM',[5,8,6])]
ETH_ART = ['       /\\', '      /::\\', '     /::::\\', '    /::::::\\',
           '   /::::|...\\', '   \\::::|.../', '    \\:::|../', '     \\::|./',
           '      \\ |/', '       \\/', '      /  \\', '      \\  /', '       \\/']
SOL_ART = ['    /############/', '   /############/', '',
           '   \\############\\', '    \\############\\', '',
           '    /############/', '   /############/']
LETTERING = {
 'V':['#   #','#   #',' # # ','  #  '], 'A':[' ### ','#   #','#####','#   #'],
 'U':['#   #','#   #','#   #',' ### '], 'L':['#    ','#    ','#    ','#####'],
 'T':['#####','  #  ','  #  ','  #  '], 'S':[' ####','###  ','   ##','#### '],
 'I':['#####','  #  ','  #  ','#####'], 'G':[' ####','#    ','#  ##',' ####'],
 'N':['#   #','##  #','# # #','#  ##'], 'O':[' ### ','#   #','#   #',' ### '],
 'E':['#####','###  ','#    ','#####'], 'M':['#   #','## ##','# # #','#   #'],
 'Y':['#   #',' # # ','  #  ','  #  ']
}


def command_scope(command):
    if command.startswith('sol-'):
        action = command[4:]
        if action not in ('create','upgrade','sign','check','export','backup','check-backup','restore','status'):
            raise ValueError('Unknown Solana command')
        return action, True
    return command, False


def units(value, decimals):
    """Exact display only: never use floating point for asset amounts."""
    number=int(value)
    if number<0 or not 0<=decimals<=36: raise ValueError('Invalid quantity')
    whole,fraction=divmod(number,10**decimals)
    tail=str(fraction).rjust(decimals,'0').rstrip('0') if decimals else ''
    return str(whole)+('.'+tail if tail else '')


def review_lines(v, multi):
    lines=[]
    if multi:
        sol=v['network'].startswith('Solana / genesis ')
        native=sol and v['asset']=='native'
        quantity=units(v['baseUnits'],int(v['decimals']))
        lines+=['TRANSFER AMOUNT: '+quantity+(' SOL' if native else ' token units'),
                'ASSET ID: '+('Native SOL' if native else v['asset'])]
        if sol:
            budget=int(v['maximumFeeLamports'])+int(v['accountRentLamports'])
            lines+=['FEE BUDGET: '+units(v['maximumFeeLamports'],9)+' SOL',
                    'ACCOUNT RENT BUDGET: '+units(v['accountRentLamports'],9)+' SOL']
            debit=budget+(int(v['baseUnits']) if native else 0)
            lines+=['TOTAL DEBIT / REQUEST BUDGET: '+
                    ('' if native else quantity+' token units + ')+units(debit,9)+' SOL',
                    'Solana fee/rent budgets are supplied by the online request, not verified live.']
        else:
            fee=units(v['maximumFeeWei'],18)
            lines+=['MAXIMUM NETWORK FEE: '+fee+' ETH',
                    'MAXIMUM TOTAL DEBIT: '+quantity+' token units + '+fee+' ETH']
        lines+=['Token display amounts depend on supplied decimals. Check base units below.','']
        fields=[(key,key.upper()) for key in v]
    else:
        fields=[('from','FROM'),('recipient','FULL RECIPIENT'),('network','NETWORK'),
                ('amount','AMOUNT'),('maximumFee','MAXIMUM FEE'),('maximumDebit','MAXIMUM TOTAL'),
                ('nonce','NONCE'),('deadlineUTC','EXPIRES UTC'),('requestId','REQUEST ID'),('fingerprint','FINGERPRINT')]
    for key,label in fields: lines += [label+': '+str(v[key])]
    return lines


def worker(payload):
    if MULTI:
        payload['scope'] = 'multi'
    try:
        p = subprocess.run([str(ROOT/'node/bin/node'), str(ROOT/'drivekey-gui-worker.cjs')],
                           input=json.dumps(payload), text=True, stdout=subprocess.PIPE,
                           stderr=subprocess.DEVNULL, timeout=120)
        result = json.loads(p.stdout) if len(p.stdout) <= 32768 else {}
        os.sync()
        return result
    except Exception:
        return {'ok': False, 'error': 'Operation stopped. Check storage and retry. No automatic retry.'}
    finally:
        payload.clear()


class Cancel(Exception):
    pass


class Terminal:
    def __init__(self, screen):
        self.s = screen
        self.s.keypad(True)
        curses.noecho()
        curses.curs_set(0)
        self.ascii = '--ascii' in sys.argv or not (os.environ.get('LANG','').lower().endswith('utf-8'))
        self.dashboard = None
        self.dashboard_error = ''
        self.base_color = 0
        workspace.init(self)
        try:
            if curses.has_colors():
                curses.start_color()
                if curses.COLORS >= 256:
                    curses.init_pair(1,252,233)
                else:
                    curses.init_pair(1,curses.COLOR_WHITE,curses.COLOR_BLACK)
                self.base_color = curses.color_pair(1)
                self.s.bkgd(' ',self.base_color)
        except curses.error:
            pass

    @property
    def strong(self): return curses.A_BOLD

    @property
    def dim(self): return 0 if getattr(self,'display_mode','normal')=='contrast' else curses.A_DIM

    def workspace_action(self, action, multi=False):
        global MULTI, SOL_ONLY
        if action=='refresh': self.refresh_dashboard(); return
        if action=='inventory': self.inventory(); return
        if action=='shortcuts': self.pages('KEYBOARD / WORKSPACE',workspace.SHORTCUTS); return
        if action=='backup-menu':
            choice=self.menu(['Create encrypted backup','Verify encrypted backup','Restore onto empty target'],'BACKUP / SELECTED PROFILE')
            action=['backup','check-backup','restore'][choice]
        if action=='display':
            selected=self.menu(['Normal / shaded workspace','Compact / no large artwork','High contrast / plain background','ASCII / limited-font fallback'],'DISPLAY / THIS SESSION ONLY')
            self.display_mode=['normal','compact','contrast','compact'][selected]
            self.ascii=selected==3
            return
        if action in ('files','vault-details','system-details'):
            self.refresh_dashboard()
            status=self.dashboard
            if not status: self.pages('DEVICE STATUS UNAVAILABLE',[self.dashboard_error]); return
            if action=='files':
                lines=['Statuses are file presence only; not cryptographic verification.']
                for name,state in status.get('files',{}).items(): lines += [name+': '+state]
                lines+=['Public wallet and signed response: import on the website.',
                        'Encrypted vault and backup: keep private. Never upload to the website.']
            elif action=='system-details':
                lines=[key.upper()+': '+value for key,value in status.get('system',{}).items()]
                lines += ['Inventory UTC: '+status['utc'],'Offline guard checks interfaces and swap; it does not attest PC integrity.']
            else:
                vault=status['multi' if multi else 'eth']
                lines=['Vault state: '+vault['state'],'Parsed public metadata; authenticate with a password check.']
                for key,value in (vault.get('wallet') or {}).items(): lines += [key+': '+str(value)]
            self.pages(action.upper(),lines);return
        if action not in ('create','sign','inspect','check','export','backup','check-backup','restore','clock'):
            raise ValueError('Unsupported workspace action')
        MULTI=multi;SOL_ONLY=False
        try:self.action(action)
        finally:MULTI=SOL_ONLY=False

    def refresh_dashboard(self):
        result=worker({'action':'dashboard'})
        self.dashboard=result.get('dashboard') if result.get('ok') else None
        self.dashboard_error=result.get('error','Inventory unavailable.')

    def next_action(self):
        status=getattr(self,'dashboard',None)
        if not status: return 'Next: F / inspect device status'
        if status.get('requests',{}).get('eth')=='present': return 'Next: 2 / review ETH request'
        if status.get('requests',{}).get('multi')=='present': return 'Next: 8 / review multi-chain request'
        if any(status.get(k,{}).get('state')=='locked' for k in ('eth','multi')): return 'Next: verify password / export public file'
        return 'Next: create a vault or restore a backup'

    def inventory(self):
        self.refresh_dashboard()
        status=self.dashboard
        if not status:
            self.pages('DEVICE STATUS UNAVAILABLE',[self.dashboard_error]); return
        lines=['Inventory checked: '+status['utc'],'Vault metadata is unverified until a password check.']
        for key,label in [('eth','NATIVE ETH / ROBINHOOD'),('multi','MULTI-CHAIN')]:
            item=status[key]
            lines += ['',label+': '+item['state']]
            wallet=item.get('wallet')
            if wallet:
                for field in ('deviceId','address','evmAddress','solanaAddress'):
                    if field in wallet: lines += [field+': '+wallet[field]]
        lines+=['','REQUEST FILES (not yet validated):']
        lines += [key+': '+value for key,value in status['requests'].items()]
        lines+=['','SIGNED RESPONSE FILES (presence only):']
        lines += [key+': '+value for key,value in status['responses'].items()]
        storage=status.get('storage')
        if storage: lines+=['','Mounted exchange: '+storage['source'],'Filesystem: '+storage['filesystem'],
            'Capacity: '+storage_amount(storage['totalBytes']),'Available: '+storage_amount(storage['availableBytes'])]
        lines+=['','Balance unavailable offline.','No compatible balance snapshot is loaded. No prices are estimated.']
        self.pages('DEVICE / VAULT DETAILS',lines)

    def put(self, y, x, value, attr=0):
        if getattr(self,'display_mode','normal')=='contrast': attr &= ~curses.A_DIM
        h,w = self.s.getmaxyx()
        if 0 <= y < h-1 and x < w-1:
            safe=''.join(ch if ch==' ' or unicodedata.category(ch)[0] not in ('C','Z') else '?' for ch in str(value))
            if self.ascii: safe=safe.encode('ascii','replace').decode('ascii')
            try: self.s.addnstr(y,x,safe,max(0,w-x-1),attr|getattr(self,'base_color',0))
            except curses.error: pass

    def rule(self, y, x=2, width=None):
        self.put(y, x, ('-' if self.ascii else '─') * max(0, width or self.s.getmaxyx()[1]-4), curses.A_DIM)

    def paragraph(self, y, x, value, width, limit=3, attr=0):
        lines = textwrap.wrap(str(value), max(1,width), replace_whitespace=False) or ['']
        for i,line in enumerate(lines[:limit]):
            self.put(y+i,x,line,attr)

    def heading(self,y,x,word):
        for row in range(4):
            text='  '.join(LETTERING[c][row] for c in word)
            self.put(y+row,x,text if self.ascii else text.replace('#','█'),curses.A_BOLD)

    def card(self,y,x,width,height,title):
        h,w=self.s.getmaxyx()
        height=min(height,h-5-y)
        if height<3: return
        edge='|' if self.ascii else '│'
        for row in range(y+1,y+height-1): self.put(row,x,edge,self.dim); self.put(row,x+width-1,edge,self.dim)
        self.put(y,x,('+' if self.ascii else '┌')+('-' if self.ascii else '─')*(width-2)+('+' if self.ascii else '┐'),self.dim)
        self.put(y+height-1,x,('+' if self.ascii else '└')+('-' if self.ascii else '─')*(width-2)+('+' if self.ascii else '┘'),self.dim)
        self.put(y,x+2,' '+title+' ',self.strong)

    def chain_panel(self,y,x,width,chain):
        if y+20>self.s.getmaxyx()[0]-5: return
        eth=chain=='ETH'
        self.card(y,x,width,20,'01 / ETH' if eth else '02 / SOL')
        art=ETH_ART if eth else SOL_ART
        for row,line in enumerate(art):
            if not self.ascii:
                line=line.replace('#','▓').replace(':','▒').replace('.','░')
            self.put(y+3+row,x+max(2,(width-19)//2),line,curses.A_BOLD)
        self.put(y+17,x+2,'ROBINHOOD CHAIN' if eth else 'SOLANA',curses.A_BOLD)
        self.put(y+18,x+2,'ETH / ERC-20 via multi tools' if eth else 'SOL / SPL via multi tools',curses.A_DIM)

    def logo(self, y, x, width, height):
        name = 'logo-ascii.txt' if self.ascii else 'logo.txt'
        try: art=(ROOT/name).read_text().splitlines()
        except OSError: art=['[ D ]', 'DRIVEKEY']
        while art and not art[-1].strip(): art.pop()
        # Retain the original artwork at its natural size whenever it fits.
        scale=min(1, width/max(1,max(map(len,art))), height/max(1,len(art)))
        rows=max(1,int(len(art)*scale))
        cols=max(1,int(max(map(len,art))*scale))
        for row in range(rows):
            source=art[min(len(art)-1,int(row/scale))]
            line=''.join(source[int(col/scale)] if int(col/scale)<len(source) else ' ' for col in range(cols))
            self.put(y+row,x,line,curses.A_BOLD)

    def frame(self, title):
        self.s.erase()
        h,w=self.s.getmaxyx()
        self.put(0,2,' DRIVEKEY / OFFLINE WALLET',curses.A_BOLD)
        stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
        self.put(0,max(20,w-len(stamp)-3),stamp,curses.A_DIM)
        self.put(1,2,title,curses.A_BOLD)
        self.rule(2)
        self.rule(h-4)
        self.put(h-2,2,'ESC back / A shell in menu / Keep USB connected until fully off',curses.A_DIM)

    def pages(self, title, lines, confirm=None):
        page=0
        previous_size=None
        while True:
            h,w=self.s.getmaxyx()
            wide=w>=100 and h>=32
            width=min(104,w-12) if wide else max(1,w-6)
            if self.s.getmaxyx()[0]<20 or self.s.getmaxyx()[1]<60:
                self.frame('RESIZE TO CONTINUE')
                self.paragraph(4,2,'Use at least 60 columns and 20 rows. Review restarts after resizing.',max(1,width),4)
                self.s.refresh()
                if self.s.getch() in (27,3): raise Cancel()
                previous_size=None
                continue
            wrapped=[]
            for line in lines:
                line=str(line)
                if wide and ': ' in line and len(line.split(': ',1)[0])<=26:
                    label,value=line.split(': ',1)
                    parts=textwrap.wrap(value,width=width-29,replace_whitespace=False) or ['']
                    wrapped += [label.upper().ljust(27)+'  '+parts[0]]+[' '*29+part for part in parts[1:]]
                else:
                    wrapped += textwrap.wrap(line,width=width,replace_whitespace=False) or ['']
                if wide: wrapped.append('')
            size=max(1,h-(15 if wide else 9))
            if previous_size != (width,size):
                page=0  # Resizing restarts review; never skip unseen transaction text.
                previous_size=(width,size)
            count=max(1,(len(wrapped)+size-1)//size)
            page=min(page,count-1)
            self.frame(title)
            x=(w-width)//2 if wide else 3
            panel_height=min(h-10,max(10,min(len(wrapped),size)+5)) if wide else 0
            panel_y=4 if confirm else max(4,(h-panel_height)//2)
            top=panel_y+3 if wide else 4
            if wide:
                self.card(panel_y,x-2,width+4,panel_height,'REVIEW / READ EVERY FIELD' if confirm else 'LOCAL OPERATION')
            for i,line in enumerate(wrapped[page*size:(page+1)*size]):
                self.put(top+i,x,line,curses.A_BOLD if ': ' in line or i==0 else 0)
            last=(page+1)*size>=len(wrapped)
            self.put(self.s.getmaxyx()[0]-3,2,
                     ('ENTER: '+(confirm or 'return') if last else 'ENTER: next page')+
                     '  /  '+str(page+1)+' of '+str(count),curses.A_BOLD)
            self.s.refresh()
            k=self.s.getch()
            if k in (27,3): raise Cancel()
            if k in (curses.KEY_LEFT,curses.KEY_UP) and page: page-=1
            if k in (10,13,curses.KEY_ENTER):
                if last: return
                page+=1

    def ask(self,title,prompt,hidden=False):
        value=''
        while True:
            self.frame(title)
            h,w=self.s.getmaxyx()
            if h<20 or w<60:
                self.paragraph(4,2,'Resize to at least 60 columns and 20 rows. ESC cancels.',max(1,w-4),4)
                self.s.refresh()
                if self.s.getch() in (27,3): raise Cancel()
                continue
            self.put(4,3,'LOCAL INPUT / '+('SECRET' if hidden else 'CONFIRMATION'),curses.A_DIM)
            self.paragraph(6,3,prompt,w-6,3,curses.A_BOLD)
            self.rule(10,3,w-6)
            self.put(11,4,('[hidden input]' if value else '[type passphrase]') if hidden else '> '+value[-max(1,w-10):],curses.A_BOLD)
            self.rule(12,3,w-6)
            self.paragraph(14,3,'Input is hidden; no characters or length are displayed.' if hidden else 'Nothing is approved until you confirm. ESC cancels.',w-6,2,curses.A_DIM)
            self.put(h-3,2,'ENTER continue   /   ESC cancel',curses.A_BOLD)
            self.s.refresh()
            k=self.s.get_wch()
            if k in ('\x1b','\x03'): raise Cancel()
            if k in ('\n','\r',curses.KEY_ENTER): return value
            if k in ('\b','\x7f',curses.KEY_BACKSPACE): value=value[:-1]
            elif isinstance(k,str) and k.isprintable() and len(value)<256: value+=k

    def result(self,payload):
        operation=payload.get('action','operation')
        self.frame('WORKING LOCALLY'); self.put(5,2,'Please wait. Keep USB connected.'); self.s.refresh()
        r=worker(payload)
        workspace.record(self,operation,bool(r.get('ok')))
        lines=[r.get('message' if r.get('ok') else 'error','Operation stopped.')]
        if r.get('wallet'):
            w = r['wallet']
            lines += (['Robinhood address:', w['evmAddress'], 'Solana address:', w['solanaAddress']]
                      if w.get('version') == 3 else ['Public address:', w['address']])
        if r.get('hash'):
            lines=['Signed response saved - not broadcast. Funds have NOT been sent.',DATA+('/signed-multi-response.json' if MULTI else '/signed-response.json'),
                   'Transaction hash:',r['hash'],'Safely shut down, return to Windows, upload the response',
                   'to the same website and explicitly submit after verification.']
        if r.get('clock'):
            lines+=['Current UTC: '+r['clock']['now'],'Created UTC: '+r['clock']['created'],
                    'Expires UTC: '+r['clock']['expires'],
                    'Windows may treat the hardware clock as local time while Linux treats it as UTC.',
                    'Compare an independent UTC clock. Do not change time to bypass expiry.',
                    'Return to Windows and prepare a fresh request if it has genuinely expired.']
        self.pages('SUCCESS' if r.get('ok') else 'STOPPED / RETRY AVAILABLE',lines)
        return r

    def action(self,action):
        if action == 'clock':
            return self.clock()
        if action == 'upgrade':
            self.pages('EXPLICIT OFFLINE UPGRADE', ['Create new multi-chain files, preserving all original v2 files and the ETH address.',
                'Generate a separate Solana key offline. Verify a new backup before use.',
                'This experimental release is for unfunded acceptance testing.'], 'continue')
            if self.ask('UPGRADE', 'Type UPGRADE to consent:') != 'UPGRADE': raise Cancel()
            p = self.ask('UPGRADE', 'Existing vault passphrase (hidden):', True)
            self.result({'action':'upgrade','password':p,'consent':True}); p=''
            return
        if action=='create':
            self.pages('CREATE VAULT',[DATA+('/vault-multi-encrypted.json' if MULTI else '/vault-encrypted.json'),'Existing vaults are never overwritten.',
                'Use a unique 16-256 character passphrase. There is no password reset.',
                'Recovery needs your encrypted backup AND passphrase. Replugging cannot recover it.'], 'continue')
            p=self.ask('CREATE','New passphrase (hidden):',True)
            q=self.ask('CREATE','Repeat passphrase (hidden):',True)
            self.result({'action':'create','password':p,'confirmation':q,'consent':True})
            p=q=''
        elif action in ('sign','inspect'):
            r=worker({'action':'review'})
            workspace.init(self)
            self.request_status['multi' if MULTI else 'eth']='Last inspection passed at '+datetime.datetime.now(datetime.timezone.utc).strftime('%H:%M:%S UTC') if r.get('ok') else 'Last inspection failed. Inspect for details.'
            if not r.get('ok'):
                # Reread using the same guarded worker to show safe error/clock diagnostics.
                self.result({'action':'review'}); return
            v=r['review']
            if SOL_ONLY and not v.get('network','').startswith('Solana / genesis '):
                self.pages('STOPPED', ['sol-sign only accepts Solana SOL or supported SPL requests. No signature created.'])
                return
            lines=review_lines(v,MULTI)
            if action=='inspect':
                workspace.record(self,'inspect',True)
                self.pages('REQUEST INSPECTION / NO SIGNATURE',lines)
                return
            remaining=int((datetime.datetime.fromisoformat(v['deadlineUTC'].replace('Z','+00:00'))-datetime.datetime.now(datetime.timezone.utc)).total_seconds())
            lines+=['Time remaining at review: '+str(remaining)+' seconds',
                'Compare full recipient with an independently known address.',
                'Signed bytes can be submitted by anyone holding them. Expiry cannot revoke them.']
            self.pages('REVIEW EXACT TRANSACTION',lines,'continue to explicit approval')
            if self.ask('APPROVE','Type SIGN to approve the exact details:')!='SIGN': raise Cancel()
            p=self.ask('UNLOCK LOCALLY','Vault passphrase (hidden):',True)
            self.result({'action':'sign','fingerprint':v['fingerprint'],'password':p,'consent':True}); p=''
        elif action in ('check','backup','check-backup','restore'):
            if action in ('backup','restore'):
                self.pages('BACKUP / RECOVERY',['A copy on this same USB is not protection against losing it.',
                    'After shutdown, keep a separate encrypted copy safely.',
                    'Restore only into an empty configured USB. Existing vaults are not replaced.'],'continue')
            p=self.ask(action.upper(),'Vault / backup passphrase (hidden):',True)
            payload={'action':action,'password':p}
            if action=='restore': payload['consent']=True
            self.result(payload); p=''
        elif action=='export': self.result({'action':'export-public'})
        elif action in ('status','help'):
            if not MULTI: self.inventory()
            self.result({'action':'status'})
            self.pages('HELP / SECURITY',['Commands: drivekey create | sign | check | export | backup',
                'drivekey check-backup | restore (empty target only)',
                'Solana: drivekey sol-create | sol-upgrade | sol-sign | sol-check',
                'drivekey sol-export | sol-backup | sol-check-backup | sol-restore | sol-status',
                'sol-* uses the separate multi-chain vault; sol-sign accepts SOL/SPL only.',
                'Multi files: wallet-multi-public.json / unsigned-multi-request.json / signed-multi-response.json',
                'drivekey clock: show UTC only; clock editing is disabled.',
                'drivekey status | help | shutdown. Old drivekey-offline commands remain.',
                'USB folder: '+DATA,'Request: unsigned-request.json / Response: signed-response.json',
                'Upload wallet-public.json or wallet-multi-public.json; never the encrypted vault.',
                'Offline boot is not verified boot or malware-proof hardware.',
                'Trust this PC, firmware and boot media. USB files remain copyable.',
                'A virtual machine is for unfunded functional tests, not real keys.',
                'Lost passphrase cannot be reset. Keep a separate encrypted backup.',
                'Advanced: press A on the main menu for a diagnostic shell.'])

    def clock(self):
        self.pages('UTC CLOCK / READ ONLY', [
            datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC'),
            'All request and signing times use UTC. Z means UTC.',
            'Clock editing is disabled in the desktop and recovery terminal.',
            'Windows / Warsaw RTC edition: local hardware time converts to UTC at boot.',
            'Seasonal offsets are applied once. The hardware clock is never written.',
            'A UTC label does not verify that the hardware clock is accurate.',
            'Compare an independent UTC clock. Stop signing if it differs.',
            'Shut down if the clock is wrong; do not copy a request deadline.',
            'The connected companion checks expiry again before submission.',
            'Native ETH signatures have no on-chain expiry.'])

    def menu(self,items,title='OFFLINE SIGNER',logo=False):
        if logo:return workspace.home(self,items,Cancel)
        index=0
        tab=0
        while True:
            self.frame(title)
            h,w=self.s.getmaxyx()
            if h<24 or w<60:
                self.paragraph(4,2,'Terminal too small. Use at least 60 columns x 24 rows. ESC returns.',max(1,w-4),4);self.s.refresh()
                if self.s.getch() in (27,3): raise Cancel()
                continue
            side=logo and w>=105 and h>=34
            rich=side and w>=145 and h>=38
            x=41 if side else 3
            right=w-41 if rich else w-3
            menu_width=right-x-2
            indices=TABS[tab][1] if logo else list(range(len(items)))
            index=min(index,len(indices)-1)
            selected=indices[index]
            if logo:
                tx=x
                for ti,(name,_) in enumerate(TABS):
                    label=' '+name+' '
                    self.put(4,tx,label,curses.A_REVERSE|curses.A_BOLD if ti==tab else self.dim)
                    tx+=len(label)+1
            if side:
                self.card(4,2,35,h-9,'DRIVEKEY')
                self.logo(7,4,31,min(24,h-17))
                self.put(h-9,4,'KEYS STAY LOCAL',self.strong)
                self.put(h-8,4,'Boot media must be trusted.',self.dim)
            start=8 if logo else 6
            status=getattr(self,'dashboard',None)
            if logo:
                if rich:
                    render_dashboard(self,status,6,right+1,38,25)
                    self.chain_panel(32,right+1,38,'SOL' if tab==2 else 'ETH')
                else:
                    found=sum(1 for key in ('eth','multi') if status and status.get(key,{}).get('state')=='locked')
                    summary='Vault files: '+str(found)+' / locked' if status else 'Device status unavailable'
                    self.put(6,x,summary+'   [F] Full status',self.dim)
            spacing=2 if h>=36 else 1
            for i,original in enumerate(indices):
                label=(' > ' if i==index else '   ')+str(original+1)+'  '+items[original]
                self.put(start+i*spacing,x,label.ljust(menu_width)[:menu_width],curses.A_REVERSE|curses.A_BOLD if i==index else 0)
            detail_y=start+len(indices)*spacing+1
            if logo:
                heading,detail=HINTS[selected]
                if detail_y<h-6:
                    self.rule(detail_y,x,menu_width)
                    self.put(detail_y+1,x,heading,self.strong)
                    self.paragraph(detail_y+2,x,detail,menu_width,max(0,min(3,h-5-detail_y-2)),self.dim)
                if h>=34:
                    self.put(h-7,x,'Balance unavailable offline.',self.dim)
                    self.put(h-6,x,self.next_action(),self.strong)
            self.put(h-3,2,'UP/DOWN select  ENTER open  1-9 action'+('  TAB section  F status' if logo else ''),self.strong)
            self.s.refresh()
            self.s.timeout(1000)
            try: k=self.s.getch()
            finally: self.s.timeout(-1)
            if k in (27,3): raise Cancel()
            if logo and k in (ord('a'),ord('A')): return -1
            if logo and k in (ord('f'),ord('F')):
                try: self.inventory()
                except Cancel: pass
                continue
            if logo and k in (9,curses.KEY_RIGHT,curses.KEY_LEFT,curses.KEY_BTAB):
                tab=(tab+(-1 if k in (curses.KEY_LEFT,curses.KEY_BTAB) else 1))%len(TABS)
                index=0
            if k==curses.KEY_UP: index=(index-1)%len(indices)
            if k==curses.KEY_DOWN: index=(index+1)%len(indices)
            if ord('1')<=k<=ord(str(len(items))): return k-ord('1')
            if k in (10,13,curses.KEY_ENTER): return selected

    def run(self,initial=None):
        global MULTI, SOL_ONLY
        if initial is None:
            self.frame('STARTING / ANY KEY TO SKIP')
            h,w=self.s.getmaxyx()
            self.logo(4,max(3,(w-32)//2),32,max(1,h-10))
            self.s.refresh()
            self.s.timeout(35)
            try:
                for progress in range(10):
                    self.put(h-5,max(3,(w-32)//2),'Opening offline workspace'+'.'*(progress%4)+'   ',curses.A_DIM)
                    self.s.refresh()
                    if self.s.getch()!=-1: break
            finally:
                self.s.timeout(-1)
                curses.flushinp()
        if initial:
            try:
                if initial=='shutdown':
                    self.pages('SHUTDOWN',['Flush files, unmount and power off?'],'shut down'); return 42
                action, multi = command_scope(initial)
                MULTI = SOL_ONLY = multi
                try: self.action(action)
                finally: MULTI = SOL_ONLY = False
            except Cancel: pass
        while True:
            try:
                self.frame('READING DEVICE STATE')
                self.put(5,3,'Reading vault metadata and mounted storage. No keys are unlocked.')
                self.s.refresh()
                self.refresh_dashboard()
                selected=self.menu(MENU,logo=True)
                if isinstance(selected,tuple):
                    self.workspace_action(*selected)
                    continue
                if selected==8:
                    self.clock()
                    continue
                if selected==7:
                    sub=self.menu(['Create multi-chain vault','Upgrade existing v2 (preserve original)',
                        'Review and sign multi-chain request','Check multi-chain password',
                        'Export multi-chain public file','Create encrypted backup','Verify backup','Restore onto empty target'],'MULTI-CHAIN / EXPERIMENTAL')
                    MULTI=True
                    try: self.action(['create','upgrade','sign','check','export','backup','check-backup','restore'][sub])
                    finally: MULTI=False
                    continue
                if selected==-1:
                    self.pages('ADVANCED',['Exit to a diagnostic shell? Wallet storage will be unmounted.',
                        'Do not enable networking or modify drives. Run drivekey to return.'],'exit to shell'); return 0
                if selected==6:
                    self.pages('SAFE SHUTDOWN',['Flush saved files and fully power off?','Do not remove the USB until the PC is off.'],'shut down');return 42
                if selected==4:
                    sub=self.menu(['Create encrypted backup','Verify encrypted backup','Restore onto empty USB'],'BACKUP')
                    self.action(['backup','check-backup','restore'][sub])
                else:self.action(['create','sign','check','export','backup','status'][selected])
            except Cancel: continue


if __name__=='__main__':
    initial=next((a for a in sys.argv[1:] if a!='--ascii'),None)
    raise SystemExit(curses.wrapper(lambda screen: Terminal(screen).run(initial)))
