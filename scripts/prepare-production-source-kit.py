#!/usr/bin/env python3
"""Package only locked production application sources and explicit build helpers.
Dependencies are restored from lockfiles, not copied from installed node_modules.
This is an application-payload source kit, not a bootable OS build kit.
"""
import argparse, hashlib, json, zipfile
from pathlib import Path

def sha(data): return hashlib.sha256(data).hexdigest()

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('lock',type=Path);p.add_argument('destination',type=Path)
    args=p.parse_args();root=Path(__file__).resolve().parent.parent
    lockraw=args.lock.read_bytes();lock=json.loads(lockraw)
    contents={'production-payload.lock.json':lockraw}
    for name,expected in lock['sources'].items():
        if 'node_modules' in Path(name).parts:continue
        if Path(name).is_absolute() or '..' in Path(name).parts or '\\' in name:raise ValueError('Unsafe input')
        src=root/name
        if src.is_symlink() or not src.resolve().is_relative_to(root):raise ValueError('Escaping input')
        data=src.read_bytes()
        if sha(data)!=expected:raise ValueError('Changed source: '+name)
        contents[name]=data
    for name in ['scripts/verify-production-npm-closure.py','scripts/test-production-npm-closure.py',
                 'scripts/test-production-payload-bootstrap.mjs','scripts/prepare-production-source-kit.py',
                 'docs/production-payload-bootstrap-2026-10-16.md']:
        contents[name]=(root/name).read_bytes()
    contents['SOURCE-KIT.json']=(json.dumps({'kind':'drivekey-production-application-source-kit',
        'payloadLockSha256':sha(lockraw),'files':{name:{'bytes':len(data),'sha256':sha(data)} for name,data in sorted(contents.items())},
        'completeOSBuildKit':False,'fundingReady':False,
        'excluded':['installed node_modules','private wallets','fixture generators','research harnesses','existing image blobs']},indent=2)+'\n').encode()
    with zipfile.ZipFile(args.destination,'x',compression=zipfile.ZIP_DEFLATED) as archive:
        for name,data in sorted(contents.items()):
            item=zipfile.ZipInfo(name,(2026,10,16,0,0,0));item.compress_type=zipfile.ZIP_DEFLATED;item.external_attr=0o100644<<16
            archive.writestr(item,data)
    print(json.dumps({'archive':str(args.destination),'bytes':args.destination.stat().st_size,'sha256':sha(args.destination.read_bytes()),'members':len(contents)}))
if __name__=='__main__':main()
