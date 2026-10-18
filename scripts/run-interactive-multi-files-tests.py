#!/usr/bin/python3
"""Run unchanged storage tests against manifest-verified packaged lifecycle workers.

Host-only, network-isolated namespace; no image edits or host policy changes.
The existing test mocks its high-level environment guard, so success is limited
storage/lifecycle evidence, never guest environment or funded acceptance.
"""
import hashlib, importlib.util, json, os, pathlib, shutil, subprocess, tempfile, time

PROJECT=pathlib.Path(__file__).resolve().parent.parent
IMAGE='interactive-20261016-r1792160000002'
ROOT=pathlib.Path('/opt/drivekey-interactive-images')/IMAGE/'rootfs'
NATIVE=pathlib.Path('/var/tmp/drivekey-wallet-vitest-native-20261016')
def sha(p): return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def policy_state():
    return {p:pathlib.Path(p).read_text() for p in ['/proc/sys/kernel/core_pattern','/proc/swaps']}

def main():
    if os.getuid()!=0: raise RuntimeError('Linux root namespace launcher required')
    image=PROJECT/'outputs/security-interactive-images'/IMAGE
    build=json.loads((image/'image-build.json').read_text())
    manifest=image/'image-contents.json'
    if sha(manifest)!=build['artifacts']['image-contents.json']['sha256']:raise RuntimeError('Image manifest changed')
    if sha(ROOT/'opt/drivekey/candidate-contents.json')!=sha(manifest):raise RuntimeError('Extracted manifest differs')
    spec=importlib.util.spec_from_file_location('policy',ROOT/'opt/drivekey/drivekey-candidate-policy.py')
    policy=importlib.util.module_from_spec(spec);spec.loader.exec_module(policy);verified=policy.validate_contents(ROOT)
    sources=['tests/multi-offline-files.test.ts','offline-signer/sandbox-process.ts','offline-signer/lifecycle-isolation.ts','offline-signer/lifecycle-service.ts','scripts/run-interactive-multi-files-tests.py']
    hashes={p:sha(PROJECT/p) for p in sources}
    out=PROJECT/'outputs'/('funds-multi-files-packaged-runtime-'+str(int(time.time()*1000)))
    out.mkdir()
    before=policy_state()
    record={'kind':'host-namespace-packaged-lifecycle-storage-tests','imageId':IMAGE,'imageManifestSha256':sha(manifest),'sourceHashes':hashes,
        'packagedRuntime':[e for e in verified['entries'] if e['path'].startswith('opt/drivekey/')],
        'hostOnly':True,'existingEnvironmentMockUnchanged':True,'hostPolicyModified':False,'publicNetwork':False,'physicalDiskTouched':False,
        'fundingReady':False,'guestIsolationAccepted':False,'publicSettlement':False,'success':False}
    with tempfile.TemporaryDirectory(prefix='drivekey-files-tests-',dir='/var/tmp') as td:
        temporary=pathlib.Path(td);(temporary/'outputs').mkdir();(temporary/'evidence').mkdir()
        (temporary/'hosts').write_text('127.0.0.1 localhost\n::1 localhost\n')
        (temporary/'nsswitch.conf').write_text('hosts: files\n')
        script='''set -eu
readlink /proc/self/ns/net > /evidence/network-namespace.txt
cat /proc/net/dev > /evidence/network-interfaces.txt
exec /opt/drivekey/node/bin/node /project/node_modules/vitest/vitest.mjs run tests/multi-offline-files.test.ts --no-file-parallelism --maxWorkers=1 --minWorkers=1 --reporter=json --outputFile=/evidence/vitest.json
'''
        script=script.replace('/project',str(PROJECT))
        (temporary/'launch.sh').write_text(script)
        args=['/usr/bin/bwrap','--unshare-net','--unshare-pid','--unshare-ipc','--unshare-uts','--die-with-parent','--new-session',
          '--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--symlink','usr/sbin','/sbin','--symlink','usr/lib','/lib','--symlink','usr/lib64','/lib64',
          '--proc','/proc','--dev','/dev','--tmpfs','/tmp','--dir','/opt',
          '--dir','/etc','--ro-bind',str(temporary/'hosts'),'/etc/hosts','--ro-bind',str(temporary/'nsswitch.conf'),'/etc/nsswitch.conf',
          '--ro-bind',str(ROOT/'opt/drivekey'),'/opt/drivekey','--ro-bind',str(PROJECT),str(PROJECT),'--ro-bind',str(NATIVE),str(NATIVE),
          '--tmpfs',str(PROJECT/'node_modules/.vite-temp'),'--tmpfs',str(PROJECT/'node_modules/.vite'),
          '--bind',str(temporary/'outputs'),str(PROJECT/'outputs'),'--bind',str(temporary/'evidence'),'/evidence',
          '--ro-bind',str(temporary/'launch.sh'),'/launch.sh','--clearenv','--setenv','PATH','/usr/bin:/bin','--setenv','HOME','/tmp',
          '--setenv','NODE_PATH',str(NATIVE/'node_modules'),'--setenv','ESBUILD_BINARY_PATH',str(NATIVE/'node_modules/@esbuild/linux-x64/bin/esbuild'),'--chdir',str(PROJECT),
          '--','/bin/sh','/launch.sh']
        record['namespaceArgv']=args
        try:
            process=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            observed={};deadline=time.monotonic()+180
            while process.poll() is None:
                pending=[process.pid]
                while pending:
                    pid=pending.pop()
                    try:
                        pending.extend(int(v) for v in pathlib.Path(f'/proc/{pid}/task/{pid}/children').read_text().split())
                        argv=pathlib.Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\x00')
                        if argv and pathlib.Path(os.fsdecode(argv[0])).name in ('bwrap','prlimit'):
                            observed[pid]=[os.fsdecode(v) for v in argv if v]
                    except (OSError,ValueError):pass
                if time.monotonic()>deadline:
                    process.kill();process.communicate();raise subprocess.TimeoutExpired(args,180)
                time.sleep(.02)
            stdout,stderr=process.communicate()
            result=subprocess.CompletedProcess(args,process.returncode,stdout,stderr)
            record['observedSandboxProcesses']=[{'pid':pid,'argv':argv} for pid,argv in observed.items()]
            record['productionBwrapObserved']=any('--disable-userns' in argv for argv in observed.values())
            record['productionPrlimitObserved']=any(pathlib.Path(argv[0]).name=='prlimit' for argv in observed.values())
            record['hostNetworkNamespace']=os.readlink('/proc/self/ns/net')
            record['exitCode']=result.returncode
            (out/'stdout.txt').write_bytes(result.stdout[:1000000]);(out/'stderr.txt').write_bytes(result.stderr[:1000000])
            for p in (temporary/'evidence').iterdir():shutil.copyfile(p,out/p.name)
            if (out/'vitest.json').exists():
                tests=json.loads((out/'vitest.json').read_text());record['counts']={k:tests[k] for k in ['numTotalTests','numPassedTests','numFailedTests']}
                record['success']=result.returncode==0 and tests['success'] is True and tests['numPassedTests']==4
        except subprocess.TimeoutExpired:record['error']='Test runner exceeded 180-second bound'
    record['hostPolicyUnchanged']=before==policy_state()
    record['sourceHashesUnchanged']=all(sha(PROJECT/p)==h for p,h in hashes.items())
    record['packagedManifestUnchanged']=sha(ROOT/'opt/drivekey/candidate-contents.json')==sha(manifest)
    policy.validate_contents(ROOT)
    record['packagedRuntimeRevalidated']=True
    record['success']=record['success'] and record['hostPolicyUnchanged'] and record['sourceHashesUnchanged']
    record['limits']=['Existing test mocks assertOfflineEnvironment; no guest isolation acceptance.','Production worker sandbox is unchanged; no real keys/funds or public settlement.','Temporary fixture outputs removed on exit; only sanitized tests and hashes retained.']
    (out/'result.json').write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps({'output':str(out),'success':record['success'],'counts':record.get('counts'),'exitCode':record.get('exitCode')}))
    return 0 if record['success'] else 1
if __name__=='__main__':raise SystemExit(main())
