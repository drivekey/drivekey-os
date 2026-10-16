#!/usr/bin/env python3
"""Build a NEW extracted Debian runtime base from authenticated package inputs.

Explicitly selects current signed replacements for unavailable historical
versions, resolves complete binary dependencies in a private APT state, and
extracts without maintainer scripts in a read-only-host/networkless namespace.
No old image, host package state, release gate, or wallet is modified.
"""
import argparse,functools,hashlib,importlib.util,json,os,re,shlex,shutil,stat,subprocess
from pathlib import Path
from urllib.request import build_opener
from urllib.parse import unquote
spec=importlib.util.spec_from_file_location('provenance',Path(__file__).with_name('prepare-production-debian-prerequisites.py'))
provenance=importlib.util.module_from_spec(spec);spec.loader.exec_module(provenance)

def newest(versions):
    def compare(a,b):
        if a==b:return 0
        return -1 if subprocess.run(['dpkg','--compare-versions',a,'lt',b]).returncode==0 else 1
    return sorted(versions,key=functools.cmp_to_key(compare))[-1]

def confined(argv,output):
    return ['bwrap','--unshare-all','--die-with-parent','--new-session','--ro-bind','/','/',
            '--bind',str(output),str(output),'--proc','/proc','--dev','/dev',
            '--setenv','TAR_OPTIONS','--no-same-owner','--',*argv]

def solver_environment(state):
    temporary=state/'tmp';temporary.mkdir(mode=0o1777)
    os.chmod(temporary,0o1777)
    config=state/'apt.conf'
    config.write_text('Dir::Etc::main "/dev/null";\nDir::Etc::parts "/nonexistent";\n')
    return {'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','APT_CONFIG':str(config),'TMPDIR':str(temporary)}

def select_requested_packages(report, selection, authenticated_names=None):
    if selection is None:return report['packages']
    if set(selection)!={'schemaVersion','kind','packages'} or selection['schemaVersion']!=1 or selection['kind']!='drivekey-production-runtime-package-roots':raise ValueError('Invalid runtime root selection')
    names=selection['packages']
    if not isinstance(names,list) or not 1<=len(names)<=128 or any(not isinstance(n,str) or not re.fullmatch(r'[a-z0-9][a-z0-9+.-]+',n) for n in names) or len(set(names))!=len(names):raise ValueError('Invalid package roots')
    available={p['package']:p for p in report['packages']}
    if not set(names)<=set(available if authenticated_names is None else authenticated_names):raise ValueError('Package roots must exist in authenticated input graph')
    return [available.get(name,{'package':name,'version':None}) for name in names]
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('report',type=Path);parser.add_argument('output',type=Path)
    parser.add_argument('--archive-cache',type=Path);parser.add_argument('--package-roots',type=Path);args=parser.parse_args()
    report=json.loads(args.report.read_text());out=args.output.resolve()
    host_status_before=provenance.sha(Path('/var/lib/dpkg/status'))
    # The only writable namespace bind must be a new dedicated /opt workspace.
    if out.parent!=Path('/opt') or not re.fullmatch(r'drivekey-production-base-[A-Za-z0-9-]+',out.name):raise ValueError('Use a new /opt/drivekey-production-base-N workspace')
    out.mkdir();state=out/'apt';state.mkdir();lists=state/'lists';lists.mkdir();(lists/'partial').mkdir()
    cache=out/'archives';cache.mkdir();(cache/'partial').mkdir();(state/'status').write_text('')
    signed_records={};download_records=[];source_lines=[];index_proofs=[]
    for prior in report['indexes']:
        suite=prior['metadata']['Codename'];base=prior['baseURL']
        if base not in ['https://deb.debian.org/debian/','https://security.debian.org/debian-security/']:raise ValueError('Unexpected repository')
        source_index=Path(prior['indexPath']);release=args.report.parent/prior['release']
        if provenance.sha(source_index)!=prior['indexSha256'] or provenance.sha(release)!=prior['releaseSha256']:raise ValueError('Prior index changed')
        index=lists/source_index.name;shutil.copyfile(source_index,index);shutil.copyfile(release,lists/release.name)
        proof=provenance.signed_index(lists/release.name,index,Path('/usr/share/keyrings/debian-archive-keyring.pgp'),state)
        proof['baseURL']=base
        shutil.copyfile(release,out/release.name)
        index_proofs.append(proof)
        for item in provenance.paragraphs(index):
            record=dict(item,baseURL=base);signed_records[(item['Package'],item['Version'])]=record;download_records.append(record)
        source_lines.append('deb [arch=amd64 signed-by=/usr/share/keyrings/debian-archive-keyring.pgp] '+base+' '+suite+' main')
    (state/'sources.list').write_text('\n'.join(source_lines)+'\n')
    requested=[];replacements=[]
    selection=json.loads(args.package_roots.read_text()) if args.package_roots else None
    for package in select_requested_packages(report,selection,{pkg for pkg,version in signed_records}):
        name=package['package'];old=package['version']
        versions=[version for pkg,version in signed_records if pkg==name]
        if not versions:raise ValueError('No signed candidate for '+name)
        version=newest(versions)
        requested.append(name+'='+version)
        if old is not None and version!=old:replacements.append({'package':name,'historicalVersion':old,'newCandidateVersion':version})
    apt=['apt-get','--yes','--print-uris','--no-install-recommends',
         '-o','Dir::State='+str(state),'-o','Dir::State::status='+str(state/'status'),'-o','Dir::State::lists='+str(lists),
         '-o','Dir::Cache='+str(out/'cache'),'-o','Dir::Cache::archives='+str(cache),
         '-o','Dir::Etc::sourcelist='+str(state/'sources.list'),'-o','Dir::Etc::sourceparts=-',
         '-o','Dir::Etc::preferences=-','-o','Dir::Etc::preferencesparts=-',
         '-o','APT::Architecture=amd64','-o','APT::Get::AllowUnauthenticated=false','install',*requested]
    solver_env=solver_environment(state)
    solver_command=confined(apt,out)
    solver=subprocess.run(solver_command,env=solver_env,capture_output=True,text=True,timeout=120)
    (out/'apt-solver.json').write_text(json.dumps({'command':solver_command,'environment':solver_env,'exitCode':solver.returncode,'stdout':solver.stdout,'stderr':solver.stderr},indent=2)+'\n')
    if solver.returncode:raise ValueError('Private APT dependency resolution failed: '+solver.stderr+'\n'+solver.stdout[-3000:])
    downloads=[]
    for line in solver.stdout.splitlines():
        if not line.startswith("'"):continue
        fields=shlex.split(line)
        if len(fields) not in (3,4):raise ValueError('Unexpected APT URI format')
        url,name,size=fields[:3];size=int(size)
        if not 0<size<=512*1024*1024 or Path(name).name!=name:raise ValueError('Unexpected APT download record')
        matches=[item for item in download_records if item['baseURL']+item['Filename']==unquote(url) and int(item['Size'])==size]
        if not matches:raise ValueError('APT URI not present in authenticated metadata')
        record=matches[0];digest=record['SHA256']
        if not re.fullmatch('[0-9a-f]{64}',digest):raise ValueError('Missing signed SHA256')
        # APT may print a legacy advisory MD5 field. It never becomes our trust
        # check: every archive below must match the signed metadata SHA256.
        if len(fields)==4 and fields[3] not in ['SHA256:'+digest,'MD5Sum:'+record.get('MD5sum','')]:raise ValueError('Unexpected APT advisory digest')
        dest=cache/(digest+'.deb')
        cached=None
        if args.archive_cache:
            legacy=hashlib.sha256((record['Package']+'='+record['Version']).encode()).hexdigest()+'.deb'
            cached=args.archive_cache/(digest+'.deb')
            if not cached.exists():cached=args.archive_cache/legacy
        if cached and cached.is_file() and cached.stat().st_size==size and provenance.sha(cached)==digest:shutil.copyfile(cached,dest)
        else:
            with build_opener(provenance.NoRedirect()).open(url,timeout=90) as response,dest.open('xb') as f:
                remaining=size+1
                while remaining:
                    block=response.read(min(1024*1024,remaining))
                    if not block:break
                    f.write(block);remaining-=len(block)
        if dest.stat().st_size!=size or provenance.sha(dest)!=digest:raise ValueError('Package changed')
        downloads.append({'package':record['Package'],'version':record['Version'],'sha256':digest,'bytes':size,'archive':dest.name,'url':url,
                          'available':True,'sourcePackage':record.get('Source',record['Package'])})
    if not downloads:raise ValueError('APT returned no complete dependency set')
    root=out/'rootfs';root.mkdir()
    for item in downloads:
        extract=['/usr/bin/bash','-o','pipefail','-c',
                 '/usr/bin/dpkg-deb --fsys-tarfile "$1" | /usr/bin/tar --extract --no-same-owner --file=- --directory="$2"',
                 'extract-package',str(cache/item['archive']),str(root)]
        result=subprocess.run(confined(extract,root),timeout=120,capture_output=True,text=True)
        if result.returncode:raise ValueError('Confined package extraction failed: '+item['package']+': '+result.stderr)
    # No package postinst runs. Generate the explicit required hardware database
    # with the extracted, signed systemd helper inside its own root namespace.
    hwdb_command=['bwrap','--unshare-all','--die-with-parent','--new-session','--bind',str(root),'/',
                  '--proc','/proc','--dev','/dev','--','/usr/bin/systemd-hwdb','--usr','update']
    generated=subprocess.run(hwdb_command,capture_output=True,text=True,check=True,timeout=120)
    hwdb=root/'usr/lib/udev/hwdb.bin'
    if not hwdb.is_file():raise ValueError('No generated hwdb')
    module_results=[]
    for modules in sorted((root/'usr/lib/modules').glob('*')):
        if not modules.is_dir():continue
        command=['bwrap','--unshare-all','--die-with-parent','--new-session','--bind',str(root),'/',
                 '--proc','/proc','--dev','/dev','--','/usr/sbin/depmod','-a',modules.name]
        completed=subprocess.run(command,capture_output=True,text=True,check=True,timeout=120)
        module_results.append({'kernel':modules.name,'command':command,'modulesDepSha256':provenance.sha(modules/'modules.dep'),'stderr':completed.stderr})
    host_status_after=provenance.sha(Path('/var/lib/dpkg/status'))
    if host_status_after!=host_status_before:raise ValueError('Host package status changed during bootstrap')
    entries=[]
    for file in sorted(root.rglob('*')):
        info=file.lstat();entry={'path':file.relative_to(root).as_posix(),'mode':stat.S_IMODE(info.st_mode)}
        if stat.S_ISLNK(info.st_mode):entry.update(type='symlink',target=os.readlink(file))
        elif stat.S_ISDIR(info.st_mode):entry.update(type='directory')
        elif stat.S_ISREG(info.st_mode):entry.update(type='file',sha256=provenance.sha(file),bytes=info.st_size)
        else:raise ValueError('Unexpected base special file')
        entries.append(entry)
    inventory=out/'rootfs-contents.json';inventory.write_text(json.dumps({'entries':entries},indent=2)+'\n')
    result={'kind':'drivekey-new-production-debian-base','sourceReportSha256':provenance.sha(args.report),
            'bootstrapSourceSha256':provenance.sha(Path(__file__)),'sharedVerifierSourceSha256':provenance.sha(Path(provenance.__file__)),
            'packageRootSelection':selection,'packageRootSelectionSha256':provenance.sha(args.package_roots) if args.package_roots else None,'requestedPackages':requested,'explicitReplacements':replacements,'packages':downloads,'signedIndexes':index_proofs,
            'indexes':index_proofs,'unavailablePackages':0,
            'aptSolverCommand':solver_command,'aptSolverEnvironment':solver_env,'packageMaintainerScriptsExecuted':False,'hostPackageStateModified':False,
            'hostPackageStatusSha256':host_status_after,'rootfsInventorySha256':provenance.sha(inventory),
            'hostToolHashes':{name:provenance.sha(Path(shutil.which(name))) for name in ['python3','apt-get','dpkg','dpkg-deb','bwrap','bash','tar']},
            'generatedModuleMetadata':module_results,
            'archiveOwnership':'Normalized to builder root; no package uid/gid accounts or postinst configuration applied',
            'hwdb':{'command':hwdb_command,'sha256':provenance.sha(hwdb),'bytes':hwdb.stat().st_size,'stderr':generated.stderr},
            'root':str(root),'completeBootableOS':False,'fundingReady':False,'publishedImageModified':False}
    (out/'production-base.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'packages':len(downloads),'replacements':len(replacements),'root':str(root),'hwdbSha256':provenance.sha(hwdb)}))
if __name__=='__main__':main()
