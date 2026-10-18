#!/usr/bin/python3
"""Candidate-only launch around the existing GUI and async transport.
No legacy dispatcher, media parsing, key handling or successful-reply substitution.
"""
import datetime as dt
import importlib.util
import json
import os
import resource
import subprocess
import sys
import tkinter as tk

ENTRY=['/usr/bin/python3','-I','-B','/opt/drivekey/drivekey-candidate-broker.py']

def checked_desktop():
    if sys.platform!='linux' or os.getuid()!=1000 or resource.getrlimit(resource.RLIMIT_CORE)!=(0,0):raise ValueError('Candidate GUI requires the guarded unprivileged session')
    p=subprocess.run([*ENTRY,'--diagnose'],capture_output=True,text=True,check=True,timeout=30)
    result=json.loads(p.stdout)
    if result.get('launchPassed') is not True or result.get('inputRead') is not False or result.get('fundingReady') is not False:raise ValueError('Candidate launch rejected')
    sys.path.insert(0,'/opt/drivekey') # Fixed, root-owned and checked by the launch baseline.
    spec=importlib.util.spec_from_file_location('drivekey_existing_desktop','/opt/drivekey/drivekey-desktop.py')
    desktop=importlib.util.module_from_spec(spec);spec.loader.exec_module(desktop)
    desktop.WORKER=ENTRY.copy()
    return desktop

def desktop_class(desktop):
    class CandidateDesktop(desktop.DriveKeyDesktop):
        def __init__(self,root):
            super().__init__(root)
            root.title('DriveKey — Unfunded confined-worker candidate')
            self.desktop_caption.configure(text='UNFUNDED CANDIDATE')
            self.settings_button.configure(state='disabled')
            self.guard_status.set('Guard checked '+dt.datetime.now(dt.timezone.utc).strftime('%H:%M')+' UTC')
        def page_home(self):
            c=self.card('Unfunded testing only','CONFINED-WORKER CANDIDATE')
            self.text(c,'Use fresh synthetic keys only. Imported context and public identities do not authenticate chain state. Signed exports are not transaction receipts. No funds, existing wallets or automatic submissions.')
            super().page_home()
        def page_wallet(self):
            c=self.card('Unfunded testing only','EXISTING EXACT REVIEW SCREENS')
            self.text(c,'Physical approval, authenticated hardware and independent chain trust remain unverified. Create and recover synthetic wallets only.')
            super().page_wallet()
        def open_settings(self):
            self.message.set('Settings are unavailable in this unfunded candidate.')
        def recovery(self):
            self.message.set('Terminal recovery is unavailable in this candidate. Use the unfunded backup rehearsal.')
        def call(self,payload,callback,quiet=False):
            if self.busy:
                if isinstance(payload,dict):payload.clear()
                return False
            if not isinstance(payload,dict) or payload.get('scope') not in (None,'savings-setup','savings-action','savings-transaction','multi','trade','weth-conversion','rules'):
                if isinstance(payload,dict):payload.clear()
                self.passphrase.set('');self.confirmation.set('')
                self.review=None;self.approved=False;self.can_approve=False;self.action=None
                self.savings_setup.clear();self.savings_action.clear()
                reply={'ok':False,'error':'Candidate GUI scope unavailable. Nothing was sent to the worker.'}
                self.message.set(reply['error'])
                # Reuse the generation-bound error callback; never invoke the
                # broker or leave the requesting screen awaiting a reply.
                self.guard_callback(callback)(reply)
                return False
            return super().call(payload,callback,quiet)
    return CandidateDesktop

def create():
    desktop=checked_desktop();root=tk.Tk();app=desktop_class(desktop)(root)
    return desktop,root,app

if __name__=='__main__':
    if sys.argv[1:]:raise SystemExit(1)
    desktop,root,app=create();root.mainloop();raise SystemExit(app.exit_code)
