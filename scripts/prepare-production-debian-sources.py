#!/usr/bin/env python3
"""Fetch corresponding Debian source archives through signed Sources indexes.
Does not install packages or execute build scripts. Requires a verified binary
prerequisite report and retained signed Release metadata beside it.
"""
import argparse, hashlib, importlib.util, json, lzma, re, shutil, subprocess
from pathlib import Path
from urllib.request import build_opener
spec=importlib.util.spec_from_file_location('debian',Path(__file__).with_name('prepare-production-debian-prerequisites.py'))
debian=importlib.util.module_from_spec(spec);spec.loader.exec_module(debian)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('binary_report',type=Path);parser.add_argument('output',type=Path)
    parser.add_argument('--download-sources',action='store_true');parser.add_argument('--verified-cache',type=Path);args=parser.parse_args()
    raw=args.binary_report.read_bytes();report=json.loads(raw);out=args.output;out.mkdir()
    indexes={};proofs=[];opener=build_opener(debian.NoRedirect())
    for original in report['indexes']:
        base=original['baseURL']
        if base not in ['https://deb.debian.org/debian/','https://security.debian.org/debian-security/']:raise ValueError('Unexpected archive URL')
        release=args.binary_report.parent/original['release']
        if debian.sha(release)!=original['releaseSha256']:raise ValueError('Release changed')
        checked=out/(original['release']+'.verified')
        result=subprocess.run(['sqv','--keyring','/usr/share/keyrings/debian-archive-keyring.pgp','--cleartext','--output',str(checked),str(release)],capture_output=True,text=True,check=True)
        text=checked.read_text();fields={line.split(': ',1)[0]:line.split(': ',1)[1] for line in text.splitlines() if ': ' in line and not line.startswith(' ')}
        debian.validate_release_fields(fields)
        dist=fields['Codename']
        if dist not in ['trixie','trixie-security','trixie-updates']:raise ValueError('Unexpected source suite')
        section=text.split('\nSHA256:\n',1)[1].split('\nSHA512:',1)[0]
        target='main/source/Sources.xz';pin=[line.split() for line in section.splitlines() if line.strip().endswith(' '+target)]
        if len(pin)!=1 or not 0<int(pin[0][1])<50*1024*1024:raise ValueError('Invalid signed Sources size')
        expected,size,_=pin[0];size=int(size)
        with opener.open(base+'dists/'+dist+'/'+target,timeout=90) as response:data=response.read(size+1)
        if len(data)!=size or hashlib.sha256(data).hexdigest()!=expected:raise ValueError('Sources differs from signed Release')
        decoder=lzma.LZMADecompressor();plain=decoder.decompress(data,max_length=200*1024*1024)
        if not decoder.eof or decoder.unused_data:raise ValueError('Oversized source index')
        path=out/(dist+'-Sources');path.write_bytes(plain)
        for item in debian.paragraphs(path):indexes.setdefault((item['Package'],item['Version']),dict(item,baseURL=base))
        proofs.append({'releaseSha256':original['releaseSha256'],'sourceIndexSha256':expected,'uncompressedSha256':debian.sha(path),'signers':result.stdout.splitlines(),
            'suite':dist,'baseURL':base,'keyringSha256':debian.sha(Path('/usr/share/keyrings/debian-archive-keyring.pgp'))})
    wanted={}
    for package in report['packages']:
        if not package['available']:continue
        source=package['sourcePackage'];match=re.fullmatch(r'([^ ]+) \(([^)]+)\)',source)
        key=(match[1],match[2]) if match else (source,re.sub(r'\+b[0-9]+$','',package['version']))
        wanted.setdefault(key,[]).append(package['package']+'='+package['version'])
    # Signed kernel source is a signing wrapper. Follow its exact unsigned
    # package build dependency to obtain the actual Linux corresponding source.
    binary_records={};edges=[]
    for proof in report['indexes']:
        index=Path(proof['indexPath'])
        if debian.sha(index)!=proof['indexSha256']:raise ValueError('Binary source mapping index changed')
        for item in debian.paragraphs(index):binary_records[(item['Package'],item['Version'])]=item
    for key in list(wanted):
        if not key[0].startswith('linux-signed-'):continue
        wrapper=indexes.get(key)
        if not wrapper:continue
        for name,version in re.findall(r'(linux-image-[^ ,]+-unsigned) \(= ([^)]+)\)',wrapper.get('Build-Depends-Arch','')):
            binary=binary_records.get((name,version))
            if not binary:raise ValueError('Missing exact unsigned kernel metadata')
            source=binary.get('Source',name);match=re.fullmatch(r'([^ ]+) \(([^)]+)\)',source)
            sourcekey=(match[1],match[2]) if match else (source,version)
            wanted.setdefault(sourcekey,[]).append('signed-wrapper:'+key[0]+'='+key[1]+':'+name)
            edges.append({'wrapper':key,'unsignedBinary':[name,version],'source':sourcekey})
    records=[];missing=[]
    for key,required in sorted(wanted.items()):
        item=indexes.get(key)
        if not item:missing.append({'source':key,'requiredBy':required});continue
        directory=item['Directory']
        if not directory.startswith('pool/') or '..' in Path(directory).parts:raise ValueError('Unsafe source directory')
        files=[]
        for line in item['Checksums-Sha256'].splitlines():
            if not line.strip():continue
            expected,size,name=line.split();size=int(size)
            if Path(name).name!=name or '\\' in name or not 0<size<=512*1024*1024:raise ValueError('Unsafe source member/size')
            url=item['baseURL']+directory+'/'+name;record={'filename':name,'bytes':size,'sha256':expected,'url':url,'downloaded':False}
            if args.download_sources:
                destination=out/(expected+'-'+name)
                cached=args.verified_cache/destination.name if args.verified_cache else None
                if cached and cached.is_file() and cached.stat().st_size==size and debian.sha(cached)==expected:
                    shutil.copyfile(cached,destination)
                if not destination.exists():
                    with opener.open(url,timeout=90) as response,destination.open('xb') as f:
                        remaining=size+1
                        while remaining:
                            chunk=response.read(min(1024*1024,remaining))
                            if not chunk:break
                            f.write(chunk);remaining-=len(chunk)
                if destination.stat().st_size!=size or debian.sha(destination)!=expected:raise ValueError('Source archive hash mismatch')
                record.update(downloaded=True,cacheFile=destination.name)
            files.append(record)
        records.append({'sourcePackage':key[0],'version':key[1],'requiredBy':required,'files':files})
    result={'kind':'drivekey-debian-corresponding-source-inputs','verifierSourceSha256':debian.sha(Path(__file__)),
            'sharedVerifierSourceSha256':debian.sha(Path(debian.__file__)),
            'binaryReportSha256':hashlib.sha256(raw).hexdigest(),'authenticatedSourceIndexes':proofs,
            'signedKernelSourceEdges':edges,
            'sources':records,'missingSources':missing,'unavailableBinaryVersions':report['unavailablePackages'],
            'allListedSourcesDownloaded':args.download_sources and not missing,'completeOSBuild':False,'fundingReady':False}
    (out/'corresponding-sources.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'sources':len(records),'files':sum(len(r['files']) for r in records),'missing':len(missing),'downloaded':args.download_sources}))
if __name__=='__main__':main()
