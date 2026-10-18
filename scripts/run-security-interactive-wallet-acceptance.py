#!/usr/bin/python3
"""External QMP wallet exercise on a byte-verified disposable USB copy.

Usage: runner.py IMAGE OUTPUT_DIRECTORY [--restore-from PRIOR_EVIDENCE_DIRECTORY]
Append JSON objects to OUTPUT_DIRECTORY/commands.jsonl: keys (qcodes), click
(x,y), capture (name), wait (seconds), finish. No shell, NIC or guest injection.
This harness records inputs and durable public/ENCRYPTED outputs; it does not
infer success from a click. Screen review and cryptographic verification are
separate. Only generated disposable wallets may be entered; never real secrets.
"""
import datetime, hashlib, importlib.util, json, os, re, shutil, socket, subprocess, sys, tempfile, time
from pathlib import Path
from zoneinfo import ZoneInfo

spec=importlib.util.spec_from_file_location('smoke',Path(__file__).with_name('run-security-interactive-smoke.py'))
smoke=importlib.util.module_from_spec(spec);spec.loader.exec_module(smoke)
sha,require=smoke.sha,smoke.require

def main():
    require(sys.platform=='linux' and len(sys.argv) in (3,5),'Linux IMAGE OUTPUT_DIRECTORY [--restore-from PRIOR_EVIDENCE_DIRECTORY] required')
    require(len(sys.argv)==3 or sys.argv[3]=='--restore-from','Only disposable restore input supported')
    source=Path(sys.argv[1]).resolve(strict=True);out=Path(sys.argv[2]).resolve()
    require(not out.exists(),'Fresh evidence directory required');out.mkdir(parents=True)
    layout=smoke.single_usb_layout(source);initial=sha(source)
    work=Path(tempfile.mkdtemp(prefix='drivekey-wallet-qmp-',dir='/var/tmp'))
    media=work/'disposable.img';shutil.copyfile(source,media);require(sha(media)==initial,'Copy mismatch')
    restore_inputs=[];transfer_input=None
    if len(sys.argv)==5:
        previous=Path(sys.argv[4]).resolve(strict=True);record=json.loads((previous/'result.json').read_text())
        require(record.get('kind')=='external-qmp-wallet-exercise' and record.get('success') is True and record.get('fundingReady') is False and record.get('sourceSha256')==initial,'Successful same-image disposable evidence required')
        volume=str(media)+'@@'+str(layout['manifest']['exchange']['offsetBytes'])
        subprocess.run(['/usr/bin/mmd','-i',volume,'::/DriveKey'],check=True,capture_output=True,timeout=10)
        for item in record['outputFiles']:
            if item['name'] in ('vault-backup.json','vault-multi-backup.json'):
                path=previous/'wallet-output'/item['name'];require(not path.is_symlink() and sha(path)==item['sha256'],'Disposable backup changed')
                subprocess.run(['/usr/bin/mcopy','-i',volume,str(path),'::/DriveKey/'+item['name']],check=True,capture_output=True,timeout=10);restore_inputs.append(item)
        require(bool(restore_inputs),'No recorded disposable backups')
        fixture=previous/'synthetic-transfer.json'
        if fixture.exists():
            require(not fixture.is_symlink() and fixture.stat().st_size<16384,'Bounded synthetic manifest')
            transfer_input=json.loads(fixture.read_text())
            require(transfer_input.get('kind')=='unfunded-qmp-native-transfer-fixture' and transfer_input.get('sourceImageSha256')==initial and transfer_input.get('network') is False and transfer_input.get('externalRPCRequests')==0 and transfer_input.get('realFunds')==0,'Only recorded synthetic preparation allowed')
            request=previous/'unsigned-request.json'
            require(not request.is_symlink() and request.stat().st_size<=32768 and sha(request)==transfer_input['requestSha256'],'Synthetic request changed')
            require(transfer_input['publicWalletSha256']==next(x['sha256'] for x in record['outputFiles'] if x['name']=='wallet-public.json'),'Synthetic request wallet binding changed')
            subprocess.run(['/usr/bin/mcopy','-i',volume,str(request),'::/DriveKey/unsigned-request.json'],check=True,capture_output=True,timeout=10)
    commands=out/'commands.jsonl';commands.write_text('')
    serial=work/'serial.log';qmp=work/'qmp.sock'
    accel='kvm' if os.access('/dev/kvm',os.R_OK|os.W_OK) else 'tcg'
    args=['/usr/bin/qemu-system-x86_64','-machine','q35,accel='+accel,'-cpu','host' if accel=='kvm' else 'max','-m','3072','-smp','2','-nodefaults','-nic','none','-display','none','-device','VGA','-serial','file:'+str(serial),'-qmp','unix:'+str(qmp)+',server=on,wait=off','-no-reboot','-device','qemu-xhci','-device','usb-tablet','-device','usb-kbd','-device','virtio-rng-pci','-rtc','base='+datetime.datetime.now(ZoneInfo('Europe/Warsaw')).strftime('%Y-%m-%dT%H:%M:%S')+',clock=rt']
    args+=smoke.boot_source_args(media,'usb-storage',True)
    report={'kind':'external-qmp-wallet-exercise','sourceImage':str(source),'sourceSha256':initial,'runnerSha256':sha(__file__),'firmware':'bios','accelerator':accel,'network':False,'hostShare':False,'guestShell':False,'physicalDiskTouched':False,'fundingReady':False,'success':False,'walletAcceptancePassed':False,'inputs':[],'screenshots':[],'work':str(work)}
    report['restoreInputs']=restore_inputs
    report['syntheticTransferInput']=transfer_input
    report['helperSha256']=sha(Path(__file__).with_name('run-security-interactive-smoke.py'))
    shutil.copyfile(__file__,out/'runner-snapshot.py')
    (out/'qemu-argv.json').write_text(json.dumps(args,indent=2))
    before=smoke.host_policy_snapshot();log=(work/'qemu.log').open('wb')
    vm=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=log,stderr=log);sock=stream=None
    def text():
        require(not serial.exists() or serial.stat().st_size<2*1024*1024,'Serial bound')
        return serial.read_text(errors='replace') if serial.exists() else ''
    def marker(value,timeout=300):
        end=time.monotonic()+timeout
        while time.monotonic()<end:
            if value in text():return
            require(vm.poll() is None,'VM exited before '+value);time.sleep(.2)
        raise TimeoutError(value)
    def qcommand(name,arguments=None):
        stream.write((json.dumps({'execute':name,'arguments':arguments or {}})+'\n').encode());stream.flush()
        while True:
            r=json.loads(stream.readline())
            if 'error' in r:raise ValueError(r['error'])
            if 'return' in r:return r['return']
    def keys(names):
        qcommand('send-key',{'keys':[{'type':'qcode','data':n} for n in names],'hold-time':80});time.sleep(.25)
    def view():
        values=re.findall(r'DRIVEKEY_INTERACTIVE_VIEW_STATE (\{[^\r\n]+\})',text())
        return json.loads(values[-1]) if values else {}
    def idle(timeout=180):
        end=time.monotonic()+timeout
        while time.monotonic()<end:
            if view().get('idle') is True:return
            require(vm.poll() is None,'Guest stopped while waiting for idle');time.sleep(.1)
        raise TimeoutError('Guest idle')
    def capture(name):
        from PIL import Image
        require(re.fullmatch('[a-z0-9-]{1,70}',name),'Capture name');time.sleep(2)
        raw=work/(name+'.ppm');qcommand('screendump',{'filename':str(raw)})
        with Image.open(raw) as p:p.save(out/(name+'.png'))
        report['screenshots'].append({'name':name,'sha256':sha(out/(name+'.png'))})
    try:
        marker('DRIVEKEY_STORAGE_PICKER_READY');sock=socket.socket(socket.AF_UNIX);sock.settimeout(15);sock.connect(str(qmp));stream=sock.makefile('rwb');json.loads(stream.readline());qcommand('qmp_capabilities')
        keys(['down']);keys(['ret']);marker('DRIVEKEY_INTERACTIVE_DESKTOP_READY')
        ready=re.findall(r'DRIVEKEY_INTERACTIVE_DESKTOP_READY (\{[^\r\n]+\})',text());require(len(ready)==1,'Desktop identity');report['desktop']=json.loads(ready[0])
        require(report['desktop']['imageId']==source.parent.name and report['desktop']['uid']==1000,'Guest identity')
        idle();keys(['alt','2']);time.sleep(2);idle();capture('wallet-start');(out/'ready.json').write_text(json.dumps(report['desktop']))
        consumed=0;end=time.monotonic()+1800
        while time.monotonic()<end:
            lines=commands.read_text().splitlines()
            require(len(lines)<3000,'Command bound')
            if consumed>=len(lines):
                require(vm.poll() is None,'Guest exited unexpectedly');time.sleep(.2);continue
            item=json.loads(lines[consumed]);consumed+=1;op=item['op']
            # Raw QMP keys can encode the disposable password. Keep them only
            # in the local command file, never in the shareable result.
            report['inputs'].append({'op':'keys','keyCount':len(item['keys'])} if op=='keys' else item)
            if op=='keys':keys(item['keys'])
            elif op=='idle':idle()
            elif op=='wait':require(0<=item['seconds']<=30,'Wait bound');time.sleep(item['seconds'])
            elif op=='capture':capture(item['name'])
            elif op=='click':
                w,h=report['desktop']['width'],report['desktop']['height'];x,y=item['x'],item['y'];require(0<=x<w and 0<=y<h,'Click bounds')
                qcommand('input-send-event',{'events':[{'type':'abs','data':{'axis':'x','value':round(x*32767/(w-1))}},{'type':'abs','data':{'axis':'y','value':round(y*32767/(h-1))}},{'type':'btn','data':{'button':'left','down':True}}]});qcommand('input-send-event',{'events':[{'type':'btn','data':{'button':'left','down':False}}]});time.sleep(.3)
            elif op=='finish':
                keys(['esc']);time.sleep(1);idle();keys(['alt','1']);time.sleep(1);idle()
                until=time.monotonic()+90
                while not view().get('messageboxMapped'):
                    require(time.monotonic()<until,'Shutdown dialog timeout')
                    if view().get('idle'):keys(['ctrl','alt','q'])
                    time.sleep(.2)
                capture('shutdown-confirmation');keys(['ret']);vm.wait(timeout=90)
                matches=re.findall(r'DRIVEKEY_INTERACTIVE_SHUTDOWN (\{[^\r\n]+\})',text());require(len(matches)==1 and json.loads(matches[0]).get('shutdownPassed') is True,'Clean shutdown required');report['success']=True;break
            else:raise ValueError('Unsupported command')
            (out/'progress.json').write_text(json.dumps({'consumed':consumed,'lastOperation':op}))
        require(report['success'],'Exercise timeout')
    except Exception as e:report['error']=str(e)
    finally:
        if vm.poll() is None:
            vm.terminate()
            try:vm.wait(timeout=5)
            except subprocess.TimeoutExpired:vm.kill();vm.wait(timeout=5)
        if stream:
            try:stream.close()
            except OSError:pass
        if sock:sock.close()
        log.close();report['processStopped']=vm.poll() is not None
        report['localInputTraceSha256']=sha(commands)
        report['localInputTraceMayContainDisposableSecret']=True
        report['sourceImageUnchanged']=sha(source)==initial;report['hostPolicyUnchanged']=before['configuration']==smoke.host_policy_snapshot()['configuration']
        offset=layout['manifest']['exchange']['offsetBytes'];length=layout['manifest']['exchange']['lengthBytes'];end=offset+length
        report['protectedBytesUnchanged']=smoke.sha_range(media,0,offset)==layout['protectedPrefixSha256'] and smoke.sha_range(media,end,media.stat().st_size-end)==layout['protectedSuffixSha256']
        report['fatEntries']=smoke.fat_entries(media,offset)
        public=out/'wallet-output';public.mkdir()
        allowed={'vault-encrypted.json','wallet-public.json','vault-backup.json','vault-multi-encrypted.json','wallet-multi-public.json','vault-multi-backup.json','unsigned-request.json','signed-response.json'}
        report['outputFiles']=[]
        for entry in report['fatEntries']:
            name=entry.rsplit('/',1)[-1]
            if name in allowed:
                subprocess.run(['/usr/bin/mcopy','-i',str(media)+'@@'+str(offset),entry,str(public/name)],check=True,capture_output=True,timeout=10)
                require((public/name).stat().st_size<65536,'Wallet output bound');report['outputFiles'].append({'name':name,'sha256':sha(public/name)})
        if serial.exists():shutil.copyfile(serial,out/'serial.log')
        report['success']=report['success'] and all(report[k] for k in ('processStopped','sourceImageUnchanged','hostPolicyUnchanged','protectedBytesUnchanged'))
        (out/'result.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'output':str(out),'success':report['success'],'error':report.get('error')}),flush=True)
    return 0 if report['success'] else 1

if __name__=='__main__':raise SystemExit(main())
