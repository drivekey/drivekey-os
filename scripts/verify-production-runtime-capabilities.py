#!/usr/bin/env python3
"""Check executable closure and fixed public QR/Tk probes in a signed runtime."""
import argparse,hashlib,importlib.util,json,os,re,subprocess
from pathlib import Path

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def command(root,argv):
    result=['bwrap','--unshare-all','--die-with-parent','--new-session','--tmpfs','/']
    for entry in sorted(root.iterdir()):
        if entry.name in {'proc','sys','dev','run','tmp'}:continue
        result+=['--symlink',os.readlink(entry),'/'+entry.name] if entry.is_symlink() else ['--ro-bind',str(entry),'/'+entry.name]
    return result+['--dir','/tmp','--proc','/proc','--dev','/dev','--clearenv','--setenv','PATH','/usr/sbin:/usr/bin:/sbin:/bin','--setenv','LANG','C.UTF-8','--',*argv]

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('base',type=Path);parser.add_argument('payload_lock',type=Path);parser.add_argument('image',type=Path);parser.add_argument('output',type=Path);args=parser.parse_args()
    project=Path(__file__).resolve().parents[1]
    spec=importlib.util.spec_from_file_location('assembler',Path(__file__).with_name('assemble-production-source-image.py'));assembler=importlib.util.module_from_spec(spec);spec.loader.exec_module(assembler)
    base=assembler.verified_base(args.base);root=base/'rootfs'
    lock=json.loads(args.payload_lock.read_text());image=json.loads((args.image/'image-build.json').read_text())
    selected={name:project/name for name in lock['sources'] if name.startswith(('core/','offline-signer/','packaging/','scripts/candidate-')) and name.endswith(('.py','.ts','.mjs','.js')) and 'node_modules' not in name.split('/')}
    expected=dict(lock['sources'])
    for name,digest in image['sources'].items():
        if name.startswith('scripts/security-'):
            selected[name]=args.image/'source-snapshot'/name;expected[name]=digest
    calls={}
    pattern=re.compile(r'''["'](/(?:usr/(?:bin|sbin)|bin|sbin|usr/lib/systemd|usr/lib/xorg)/[A-Za-z0-9_.+-]+)["']''')
    for name,path in selected.items():
        if sha(path)!=expected[name]:raise ValueError('Source changed: '+name)
        for target in pattern.findall(path.read_text()):calls.setdefault(target,[]).append(name)
    checks=[]
    for target,sources in sorted(calls.items()):
        file=root/target.lstrip('/')
        # Resolve guest absolute links relative to the guest tree, never host.
        parts=target.lstrip('/').split('/');resolved=root
        for part in parts:
            resolved=resolved/part
            for unused in range(40):
                if not resolved.is_symlink():break
                link=os.readlink(resolved);resolved=root/link.lstrip('/') if link.startswith('/') else resolved.parent/link
            else:raise ValueError('Link cycle')
        if not resolved.resolve().is_relative_to(root) or not resolved.is_file() or not os.access(resolved,os.X_OK):raise ValueError('Missing runtime executable: '+target)
        checks.append({'executable':target,'sha256':sha(resolved),'sources':sorted(set(sources))})
    fixed='drivekey-public-capability-probe'
    qr=subprocess.run(command(root,['/usr/bin/qrencode','-t','PNG','-o','-','-s','5','-m','4',fixed]),capture_output=True,timeout=10,check=True)
    if len(qr.stdout)>1024*1024 or not qr.stdout.startswith(b'\x89PNG\r\n\x1a\n'):raise ValueError('QR did not produce bounded PNG')
    probe="import io,json,sys,tkinter;from PIL import Image,ImageTk; im=Image.open(io.BytesIO(sys.stdin.buffer.read())); im.verify();print(json.dumps({'format':im.format,'width':im.width,'height':im.height,'tk':tkinter.TkVersion}))"
    png=subprocess.run(command(root,['/usr/bin/python3','-I','-B','-c',probe]),input=qr.stdout,capture_output=True,timeout=10,check=True)
    details=json.loads(png.stdout)
    report={'kind':'drivekey-production-runtime-capabilities','baseReportSha256':sha(base/'production-base.json'),'payloadLockSha256':sha(args.payload_lock),'sourceImageBuildSha256':sha(args.image/'image-build.json'),'verifierSha256':sha(__file__),'literalExecutableCalls':checks,'scope':'Quoted literal executable paths in exact selected production Python/TypeScript/JavaScript sources and interactive wrappers; dynamic command construction is not exhaustively proven.','qrProbe':{'fixedPublicText':fixed,'pngSha256':hashlib.sha256(qr.stdout).hexdigest(),'bytes':len(qr.stdout),**details},'network':False,'runtimeModified':False,'fundingReady':False}
    with args.output.open('x') as f:json.dump(report,f,indent=2);f.write('\n')
    print(json.dumps({'literalExecutables':len(checks),'qr':details,'output':str(args.output)}))
if __name__=='__main__':main()

