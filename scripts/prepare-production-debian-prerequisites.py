#!/usr/bin/env python3
"""Authenticate Debian package prerequisites without installing or executing them.

Uses the existing Debian archive keyring as trust anchor, sqv cleartext signature
verification, signed Release SHA256 -> Packages -> .deb. Writes a NEW cache only.
"""
import argparse, hashlib, json, lzma, re, shutil, subprocess, tarfile, threading
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.request import build_opener, HTTPRedirectHandler

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): raise ValueError('Debian redirects are not followed')

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

def paragraphs(path):
    item={};last=None
    with path.open() as f:
        for raw in f:
            line=raw.rstrip('\n')
            if not line:
                if item:yield item
                item={};last=None
            elif line.startswith(' ') and last:item[last]+='\n'+line[1:]
            else:
                last,sep,value=line.partition(':')
                if sep:item[last]=value.lstrip(' ')
                else:last=None
    if item:yield item

def validate_release_fields(fields):
    if fields.get('Origin')!='Debian' or fields.get('Codename') not in {'trixie','trixie-security','trixie-updates'}:raise ValueError('Unexpected Debian release')
    now=datetime.now(timezone.utc)
    if parsedate_to_datetime(fields['Date'])>now:raise ValueError('Future release metadata')
    if fields.get('Valid-Until') and parsedate_to_datetime(fields['Valid-Until'])<now:raise ValueError('Expired release metadata')

def signed_index(release,index,keyring,out):
    authenticated=out/(release.name+'.verified')
    result=subprocess.run(['sqv','--keyring',str(keyring),'--cleartext','--output',str(authenticated),str(release)],capture_output=True,text=True,check=True)
    text=authenticated.read_text()
    fields={line.split(': ',1)[0]:line.split(': ',1)[1] for line in text.splitlines() if ': ' in line and not line.startswith(' ')}
    validate_release_fields(fields)
    section=text.split('\nSHA256:\n',1)[1].split('\nSHA512:',1)[0]
    target='main/binary-amd64/Packages'
    found=[line.split() for line in section.splitlines() if line.strip().endswith(' '+target)]
    if len(found)!=1 or found[0][0]!=sha(index) or int(found[0][1])!=index.stat().st_size:raise ValueError('Packages index differs from signed Release')
    shutil.copyfile(release,out/release.name)
    return {'release':release.name,'releaseSha256':sha(release),'indexSha256':sha(index),'indexBytes':index.stat().st_size,
            'indexPath':str(index),'signedPath':target,'signerFingerprints':result.stdout.splitlines(),'metadata':fields}

def package_inventory(root):
    owners={};versions={}
    db=root/'var/lib/dpkg'
    for item in paragraphs(db/'status'):
        if item.get('Status')=='install ok installed':
            name=item['Package'];versions[name]=item['Version'];versions[name+':'+item['Architecture']]=item['Version']
    for listing in (db/'info').glob('*.list'):
        package=listing.name[:-5]
        if package not in versions:continue
        for name in listing.read_text(errors='replace').splitlines():owners.setdefault(name,[]).append(package)
    return owners,versions

def fresh_metadata(baseurl,distribution,prefix,destination):
    release=destination/(prefix+'_InRelease');index=destination/(prefix+'_main_binary-amd64_Packages')
    opener=build_opener(NoRedirect())
    with opener.open(baseurl+'dists/'+distribution+'/InRelease',timeout=60) as response:
        raw=response.read(2*1024*1024+1)
    if len(raw)>2*1024*1024:raise ValueError('Oversized release')
    release.write_bytes(raw)
    # Authenticate before using release-controlled package sizes/hashes.
    checked=destination/(prefix+'_cleartext')
    subprocess.run(['sqv','--keyring','/usr/share/keyrings/debian-archive-keyring.pgp','--cleartext','--output',str(checked),str(release)],check=True,capture_output=True)
    text=checked.read_text();section=text.split('\nSHA256:\n',1)[1].split('\nSHA512:',1)[0]
    target='main/binary-amd64/Packages.xz'
    matches=[line.split() for line in section.splitlines() if line.strip().endswith(' '+target)]
    if len(matches)!=1:raise ValueError('Missing signed compressed index')
    expected,size,_=matches[0];size=int(size)
    if size>50*1024*1024:raise ValueError('Index too large')
    with opener.open(baseurl+'dists/'+distribution+'/'+target,timeout=90) as response:data=response.read(size+1)
    if len(data)!=size or hashlib.sha256(data).hexdigest()!=expected:raise ValueError('Compressed index differs from signed Release')
    decoder=lzma.LZMADecompressor();raw=decoder.decompress(data,max_length=200*1024*1024)
    if not decoder.eof or decoder.unused_data:raise ValueError('Oversized or concatenated index')
    index.write_bytes(raw);return release,index

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('image_root',type=Path);p.add_argument('output',type=Path)
    p.add_argument('--verified-cache',type=Path,help='Reuse .deb bytes only after comparing against fresh signed package metadata')
    args=p.parse_args();out=args.output;out.mkdir();keyring=Path('/usr/share/keyrings/debian-archive-keyring.pgp')
    indexes=[];records={};metadata=out/'metadata';metadata.mkdir()
    for prefix,url,dist in [('deb.debian.org_debian_dists_trixie','https://deb.debian.org/debian/','trixie'),('security.debian.org_debian-security_dists_trixie-security','https://security.debian.org/debian-security/','trixie-security'),('deb.debian.org_debian_dists_trixie-updates','https://deb.debian.org/debian/','trixie-updates')]:
        release,index=fresh_metadata(url,dist,prefix,metadata)
        proof=signed_index(release,index,keyring,out);proof['baseURL']=url;indexes.append(proof)
        for item in paragraphs(index):
            if item.get('Architecture') not in {'amd64','all'}:continue
            records.setdefault((item['Package'],item['Version']),dict(item,baseURL=url,indexSha256=proof['indexSha256']))
    base=Path('/opt/drivekey-candidate-image-base-20261012/rootfs')
    inventories={str(root):package_inventory(root) for root in [Path('/'),base]}
    manifest_path=args.image_root/'opt/drivekey/candidate-contents.json';manifest=json.loads(manifest_path.read_text())
    packages={};gaps=[];sources=0
    def register(source,expected,output_path=None):
        nonlocal sources
        path=Path(source);root=base if path.is_relative_to(base) else Path('/')
        name='/'+str(path.relative_to(root));owners,versions=inventories[str(root)]
        canonical=path.resolve()
        if not canonical.is_relative_to(root):raise ValueError('Runtime source link escapes its provenance root')
        canonical_name='/'+str(canonical.relative_to(root))
        candidates=owners.get(name,[])
        if not candidates and path.exists():
            actual=path.resolve();candidate_name='/'+str(actual.relative_to(root)) if actual.is_relative_to(root) else ''
            candidates=owners.get(candidate_name,[])
        if len(candidates)!=1:
            gaps.append({'source':source,'sha256':expected,'reason':'no unique dpkg owner','imagePath':output_path});return
        package=candidates[0];version=versions[package];key=(package.split(':')[0],version)
        item=packages.setdefault(key,{'package':key[0],'version':version,'files':[]})
        item['files'].append({'source':source,'packagePath':canonical_name.lstrip('/'),'originalPackagePath':name.lstrip('/'),'sha256':expected,'imagePath':output_path});sources+=1
    for entry in manifest['entries']:
        source=entry.get('origin',{}).get('source')
        if entry.get('type')=='file' and isinstance(source,str) and (source.startswith(str(base)+'/') or source.startswith(('/usr/','/bin/','/sbin/','/lib/','/lib64/'))):
            actual=args.image_root/entry['path']
            if not actual.resolve().is_relative_to(args.image_root.resolve()) or actual.is_symlink() or sha(actual)!=entry['sha256']:
                raise ValueError('Image file differs from manifest')
            register(source,entry['sha256'],entry['path'])
    # Kernel is outside the squashfs manifest; also capture installed assembler tools.
    kernel=base/'boot/vmlinuz-6.12.107+deb13-amd64';register(str(kernel),sha(kernel))
    for name in ['mksquashfs','unsquashfs','xorriso','grub-mkrescue','grub-mkstandalone','mkfs.vfat','mcopy','sfdisk','modprobe','python3','sqv','dpkg-deb']:
        exe=shutil.which(name)
        if exe:register(str(Path(exe).resolve()),sha(Path(exe).resolve()))
        else:gaps.append({'tool':name,'reason':'not installed'})
    results=[]
    for key,item in sorted(packages.items()):
        record=records.get(key)
        if not record:
            alternatives=[{'version':version,'filename':entry['Filename'],'sha256':entry['SHA256'],'bytes':int(entry['Size']),
                           'baseURL':entry['baseURL'],'indexSha256':entry['indexSha256']} for (name,version),entry in records.items() if name==key[0]]
            results.append(dict(item,available=False,reason='exact version absent from authenticated indexes',currentSignedAlternatives=alternatives));continue
        filename=record['Filename']
        if not filename.startswith('pool/') or '..' in Path(filename).parts:raise ValueError('Unsafe Debian filename')
        if not 0<int(record['Size'])<=512*1024*1024:raise ValueError('Debian package size outside resource bound')
        dest=out/(hashlib.sha256((key[0]+'='+key[1]).encode()).hexdigest()+'.deb')
        cached=args.verified_cache/dest.name if args.verified_cache else None
        if cached and cached.is_file() and cached.stat().st_size==int(record['Size']) and sha(cached)==record['SHA256']:
            shutil.copyfile(cached,dest)
        else:
            with build_opener(NoRedirect()).open(record['baseURL']+filename,timeout=90) as response,dest.open('xb') as f:
                remaining=int(record['Size'])+1
                while remaining:
                    block=response.read(min(1024*1024,remaining))
                    if not block:break
                    f.write(block);remaining-=len(block)
        if dest.stat().st_size!=int(record['Size']) or sha(dest)!=record['SHA256']:raise ValueError('Debian archive hash mismatch')
        wanted={file['packagePath'] for file in item['files']};actual={}
        process=subprocess.Popen(['dpkg-deb','--fsys-tarfile',str(dest)],stdout=subprocess.PIPE)
        timer=threading.Timer(120,process.kill);timer.start()
        try:
            unpacked=0
            with tarfile.open(fileobj=process.stdout,mode='r|') as archive:
                for member in archive:
                    unpacked+=member.size
                    if member.size>128*1024*1024 or unpacked>2*1024*1024*1024:raise ValueError('Archive exceeds resource budget')
                    name=member.name.removeprefix('./')
                    if name in wanted and member.isfile():
                        digest=hashlib.sha256()
                        with archive.extractfile(member) as f:
                            for block in iter(lambda:f.read(1024*1024),b''):digest.update(block)
                        actual[name]=digest.hexdigest()
            if process.wait(timeout=5)!=0:raise ValueError('dpkg-deb failed')
        finally:
            timer.cancel();process.stdout.close()
            if process.poll() is None:process.kill();process.wait(timeout=5)
        files=[dict(file,archiveSha256=actual.get(file['packagePath']),matchesArchive=actual.get(file['packagePath'])==file['sha256']) for file in item['files']]
        results.append(dict(item,files=files,available=True,archiveFile=dest.name,archiveSha256=record['SHA256'],archiveBytes=int(record['Size']),
            filename=filename,baseURL=record['baseURL'],indexSha256=record['indexSha256'],sourcePackage=record.get('Source',record['Package']),
            depends=record.get('Depends',''),preDepends=record.get('Pre-Depends','')))
    report={'kind':'drivekey-authenticated-debian-prerequisites','verifierSourceSha256':sha(Path(__file__)),
            'sqvSha256':sha(Path(shutil.which('sqv'))),'dpkgDebSha256':sha(Path(shutil.which('dpkg-deb'))),
            'manifestSha256':sha(manifest_path),'keyringPath':str(keyring),'keyringSha256':sha(keyring),
            'trustAnchor':'Existing Debian archive keyring supplied by installed OS; not a new agent identity',
            'indexes':indexes,'packages':results,'ownershipGaps':gaps,'matchedFiles':sum(f['matchesArchive'] for p in results if p['available'] for f in p['files']),
            'unmatchedFiles':sum(not f['matchesArchive'] for p in results if p['available'] for f in p['files']),
            'unavailablePackages':sum(not p['available'] for p in results),'completeOSBuild':False,'fundingReady':False}
    (out/'debian-prerequisites.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ['matchedFiles','unmatchedFiles','unavailablePackages','completeOSBuild']}))
if __name__=='__main__':main()
