#!/usr/bin/env python3
"""Compare locked build inputs with SRI-pinned npm registry tarballs.

Read-only source verification. Downloads only registry.npmjs.org over HTTPS into
a NEW cache directory. Does not execute packages or install lifecycle scripts.
Lock/SRI correspondence is not maintainer release authentication or an audit.
"""
import argparse, base64, hashlib, io, json, re, tarfile
from pathlib import Path
from urllib.request import build_opener, HTTPRedirectHandler

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Registry redirects are forbidden before follow')

def digest(data): return hashlib.sha256(data).hexdigest()

def parse_integrities(text):
    # Narrow parser for pnpm lock v9 packages mapping; fail on missing records.
    result, current, active = {}, None, False
    for line in text.splitlines():
        if line == 'packages:': active = True; continue
        if active and line and not line.startswith(' '): break
        if not active: continue
        found = re.fullmatch(r"  (?:'([^']+)'|([^ :]+)):", line)
        if found: current = found[1] or found[2]
        found = re.fullmatch(r'    resolution: \{integrity: (sha512-[A-Za-z0-9+/=]+)\}', line)
        if found and current:
            if current in result: raise ValueError('Duplicate lock package')
            result[current] = found[1]
    return result

def verify_tarball(data, integrity, files):
    expected = 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode()
    if expected != integrity: raise ValueError('Registry tarball integrity mismatch')
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        members = {}
        for member in archive:
            if member.name in members: raise ValueError('Duplicate tar member')
            if member.name.startswith('/') or '..' in Path(member.name).parts: raise ValueError('Unsafe tar member')
            members[member.name] = member
        for name, sha in files.items():
            member = members.get('package/' + name)
            if not member or not member.isfile() or member.size > 64*1024*1024: raise ValueError('Missing/unsafe package source: '+name)
            if digest(archive.extractfile(member).read()) != sha: raise ValueError('Installed input differs from registry: '+name)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('lock',type=Path);parser.add_argument('cache',type=Path);parser.add_argument('report',type=Path)
    args=parser.parse_args(); root=Path(__file__).resolve().parent.parent
    raw=args.lock.read_bytes(); lock=json.loads(raw)
    locks={}
    for name in ['pnpm-lock.yaml','packaging/production-proof-dependencies/pnpm-lock.yaml']:
        data=(root/name).read_bytes()
        if digest(data)!=lock['sources'][name]: raise ValueError('Lockfile changed')
        locks[name]=parse_integrities(data.decode())
    packages={}
    for name, expected in lock['sources'].items():
        if 'node_modules/' not in name: continue
        if name.startswith('/') or '..' in Path(name).parts or '\\' in name: raise ValueError('Unsafe source path')
        source=root/name
        if not source.resolve().is_relative_to(root): raise ValueError('Escaping dependency')
        if digest(source.read_bytes())!=expected: raise ValueError('Local input changed')
        prefix,tail=name.rsplit('node_modules/',1)
        parts=tail.split('/'); count=2 if parts[0].startswith('@') else 1
        package='/'.join(parts[:count]); rel='/'.join(parts[count:])
        if not re.fullmatch(r'(?:@[a-z0-9._-]+/)?[a-z0-9._-]+',package): raise ValueError('Unsafe package name')
        meta=json.loads((root/(prefix+'node_modules/'+package)/'package.json').read_text())
        version=meta['version']
        if meta['name']!=package or not re.fullmatch(r'[0-9A-Za-z.+-]+',version): raise ValueError('Package metadata mismatch')
        key=package+'@'+version
        lockname='packaging/production-proof-dependencies/pnpm-lock.yaml' if name.startswith('packaging/production-proof-dependencies/') else 'pnpm-lock.yaml'
        integrity=locks[lockname].get(key)
        if not integrity: raise ValueError('No integrity pin: '+key)
        item=packages.setdefault(key,{'name':package,'version':version,'integrity':integrity,'files':{}})
        if item['integrity']!=integrity: raise ValueError('Conflicting package integrity')
        if rel in item['files'] and item['files'][rel]!=expected: raise ValueError('Conflicting source copy')
        item['files'][rel]=expected
    args.cache.mkdir() # Never silently reuse a cache or overwrite prior evidence.
    records=[]
    for key,item in sorted(packages.items()):
        url='https://registry.npmjs.org/'+item['name']+'/-/'+item['name'].split('/')[-1]+'-'+item['version']+'.tgz'
        with build_opener(NoRedirect()).open(url,timeout=60) as response:
            if not response.url.startswith('https://registry.npmjs.org/'): raise ValueError('Unexpected registry redirect')
            data=response.read(64*1024*1024+1)
        if len(data)>64*1024*1024: raise ValueError('Oversized package archive')
        verify_tarball(data,item['integrity'],item['files'])
        filename=hashlib.sha256(key.encode()).hexdigest()+'.tgz'
        (args.cache/filename).write_bytes(data)
        records.append({'package':key,'url':url,'integrity':item['integrity'],'sha256':digest(data),
                        'cacheFile':filename,'verifiedInputs':item['files']})
    report={'kind':'drivekey-production-npm-registry-correspondence','payloadLockSha256':digest(raw),
            'passed':True,'packages':records,'packageCount':len(records),'verifiedInputCount':sum(len(i['files']) for i in packages.values()),
            'method':'HTTPS npm registry tarballs checked against frozen pnpm SHA512 integrity and every consumed source byte',
            'maintainerReleaseAuthenticated':False,'securityAudit':False,'fundingReady':False}
    with args.report.open('x') as f: json.dump(report,f,indent=2);f.write('\n')
    print(json.dumps({k:v for k,v in report.items() if k!='packages'}))
if __name__=='__main__': main()
