#!/usr/bin/env python3
"""Compose a NEW unreleased OS from verified Debian base and source-built app.

Never reads a historical image, runtime tree, wallet, or generated test payload.
The existing candidate launch policy and every readiness gate remain unchanged.
"""
import argparse, importlib.util, json, lzma, os, re, shutil, stat, subprocess, sys, tarfile, tempfile
from pathlib import Path
from urllib.request import build_opener, HTTPRedirectHandler

PROJECT = Path(__file__).resolve().parent.parent
VOLATILE_ROOTS = {'proc','sys','dev','run','tmp','mnt'}
UDEV_RULES = {'60-input-id.rules','60-evdev.rules','60-persistent-input.rules',
    '60-drm.rules','70-mouse.rules','80-libinput-device-groups.rules','90-libinput-fuzz-override.rules'}
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, PROJECT / 'scripts' / filename)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module
helpers = load('interactive', 'build-security-interactive-image.py')
policy = load('policy', 'candidate-launch-policy.py')
sha = helpers.sha
node_verifier = load('node_signature', 'verify-node-release-signature.py')
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Redirect refused')

def fetch(url, dest, maximum):
    with build_opener(NoRedirect()).open(url, timeout=90) as response, dest.open('xb') as out:
        count = 0
        while True:
            block = response.read(min(1048576, maximum + 1 - count))
            if not block: break
            count += len(block)
            if count > maximum: raise ValueError('Download limit')
            out.write(block)

def verified_node_archive(output):
    """Authenticate Node before returning any archive for extraction."""
    capture = output / 'node-release-authentication'
    node_verifier.capture(capture)
    archive = output / node_verifier.ARCHIVE
    fetch('https://nodejs.org/dist/v22.23.3/' + node_verifier.ARCHIVE,
          archive, 100*1024*1024)
    result = node_verifier.verify(capture, archive)
    if result.get('success') is not True or result.get('signatureVerified') is not True:
        raise ValueError('Node signature authentication required')
    if result.get('archiveSha256') != sha(archive):
        raise ValueError('Authenticated Node archive changed')
    result['assemblerChanged'] = True
    result['verificationStage'] = 'before-archive-extraction'
    result['helperSha256'] = sha(PROJECT / 'scripts/verify-node-release-signature.py')
    report = output / 'node-release-verification.json'
    with report.open('x') as stream:
        stream.write(json.dumps(result, indent=2)+'\n')
    sums = output / 'node-SHASUMS256.txt'
    shutil.copyfile(capture / 'SHASUMS256.txt', sums)
    return archive, sums, report, result

def checked_files(root, entries):
    for entry in entries:
        name = entry['path']
        if name.startswith('/') or '..' in name.split('/'): raise ValueError('Unsafe input path')
        path = root / name
        for parent in path.parents:
            if parent == root: break
            if parent.is_symlink(): raise ValueError('Input symlink ancestor')
        info = path.lstat()
        if stat.S_IMODE(info.st_mode) != entry['mode']: raise ValueError('Input mode changed: ' + name)
        if entry['type'] == 'file':
            if not stat.S_ISREG(info.st_mode) or info.st_size != entry['bytes'] or sha(path) != entry['sha256']: raise ValueError('Input changed: ' + name)
        elif entry['type'] == 'directory':
            if not stat.S_ISDIR(info.st_mode): raise ValueError('Input directory changed')
        elif entry['type'] == 'symlink':
            if not stat.S_ISLNK(info.st_mode) or os.readlink(path) != entry['target']: raise ValueError('Input link changed')
        else: raise ValueError('Unexpected input type')
    if {p.relative_to(root).as_posix() for p in root.rglob('*')} != {e['path'] for e in entries}: raise ValueError('Unexpected base input')

def verified_base(base, expected=None):
    base=Path(base).resolve(strict=True)
    report=base/'production-base.json';record=json.loads(report.read_text())
    inventory=base/'rootfs-contents.json'
    if expected is not None and sha(report)!=expected:raise ValueError('Base report changed')
    if record['kind']!='drivekey-new-production-debian-base' or record['fundingReady'] is not False or sha(inventory)!=record['rootfsInventorySha256']:raise ValueError('Base provenance rejected')
    checked_files(base/'rootfs',json.loads(inventory.read_text())['entries'])
    return base

def tool_command(base, argv, output):
    allowed={'/usr/bin/mksquashfs','/usr/bin/grub-mkrescue','/usr/bin/xorriso','/usr/sbin/mkfs.vfat','/usr/sbin/sfdisk','/usr/sbin/modprobe'}
    if not argv or argv[0] not in allowed:raise ValueError('Unapproved image build tool')
    if output.parent!=Path('/opt/drivekey-production-images') or not output.is_dir() or output.is_symlink():raise ValueError('Dedicated image output required')
    command=['bwrap','--unshare-all','--die-with-parent','--new-session','--tmpfs','/']
    for entry in sorted((base/'rootfs').iterdir()):
        if entry.name in {'proc','sys','dev','run','tmp','opt'}:continue
        if entry.is_symlink():command+=['--symlink',os.readlink(entry),'/'+entry.name]
        else:command+=['--ro-bind',str(entry),'/'+entry.name]
    return command+['--dir','/opt/drivekey-production-images','--bind',str(output),str(output),
        '--dir','/tmp','--proc','/proc','--dev','/dev','--clearenv',
        '--setenv','PATH','/usr/sbin:/usr/bin:/sbin:/bin','--setenv','LANG','C.UTF-8','--',*argv]
def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base', type=Path); parser.add_argument('payload', type=Path); parser.add_argument('output', type=Path)
    parser.add_argument('--runtime-base', type=Path)
    return parser.parse_args()

def confined_command(source, args, staging):
    code = "import importlib.util,sys; path=sys.argv.pop(1); s=importlib.util.spec_from_file_location('assembly',path); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.assemble()"
    return ['bwrap','--unshare-all','--share-net','--die-with-parent','--new-session',
        '--ro-bind','/','/','--bind',str(staging),'/opt/drivekey-production-images',
        '--proc','/proc','--dev','/dev','--clearenv','--setenv','PATH','/usr/sbin:/usr/bin:/sbin:/bin',
        '--setenv','LANG','C.UTF-8','--','/usr/bin/python3','-I','-B','-c',code,str(source),
        str(args.base),str(args.payload),str(args.output)]+(['--runtime-base',str(args.runtime_base)] if getattr(args,'runtime_base',None) else [])

def main():
    args=arguments(); args.base=args.base.resolve(strict=True);args.payload=args.payload.resolve(strict=True)
    if args.runtime_base:args.runtime_base=args.runtime_base.resolve(strict=True)
    args.output=args.output.resolve(); parent=Path('/opt/drivekey-production-images')
    if os.geteuid()!=0 or args.output.parent!=parent or not re.fullmatch(r'interactive-[0-9]{8}-r[1-9][0-9]{9,19}',args.output.name):raise ValueError('Dedicated new output required')
    parent.mkdir(exist_ok=True)
    if args.output.exists() or args.output.is_symlink():raise ValueError('Output already exists')
    staging=Path(tempfile.mkdtemp(prefix='drivekey-production-assembly-',dir='/opt'))
    command=confined_command(Path(__file__).resolve(),args,staging)
    result=subprocess.run(command,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8'})
    # Retain failed staging for diagnosis. Never promote an incomplete tree.
    if result.returncode:raise RuntimeError('Confined assembly failed; retained '+str(staging))
    built=staging/args.output.name
    if not (built/'image-build.json').is_file() or args.output.exists():raise ValueError('Invalid completed output')
    built.rename(args.output);staging.rmdir()

def assemble():
    args=arguments()
    roots=[line.split(' - ',1)[0].split() for line in Path('/proc/self/mountinfo').read_text().splitlines()]
    root_mount=[row for row in roots if row[4]=='/']
    if len(root_mount)!=1 or 'ro' not in root_mount[0][5].split(','):raise ValueError('Assembly requires read-only host namespace')
    if os.geteuid() != 0: raise ValueError('Linux build root required')
    output = args.output.resolve(); identifier = output.name
    if output.parent != Path('/opt/drivekey-production-images') or not re.fullmatch(r'interactive-[0-9]{8}-r[1-9][0-9]{9,19}', identifier): raise ValueError('New dedicated image workspace required')
    output.mkdir(parents=True); root = output / 'rootfs'
    base = args.base.resolve(strict=True); payload = args.payload.resolve(strict=True)
    base_record = json.loads((base / 'production-base.json').read_text())
    inventory = base / 'rootfs-contents.json'
    if base_record['kind'] != 'drivekey-new-production-debian-base' or base_record['fundingReady'] is not False or sha(inventory) != base_record['rootfsInventorySha256']: raise ValueError('Base provenance rejected')
    verified_base(base)
    runtime_base=verified_base(args.runtime_base) if args.runtime_base else base
    shutil.copytree(runtime_base / 'rootfs', root, symlinks=True)
    # Convert absolute guest links without ever resolving them against host files.
    changes = []
    # Only explicitly allowlisted modules enter initramfs. A full installed
    # module tree would let udev discover network and other unapproved drivers.
    module_tree = root / 'usr/lib/modules'
    if module_tree.is_symlink() or not module_tree.resolve().is_relative_to(root): raise ValueError('Invalid module tree')
    if module_tree.exists():shutil.rmtree(module_tree)
    changes.append({'omittedPrefix':'usr/lib/modules','reason':'Only allowlisted initramfs modules; no runtime module discovery'})
    for rules_dir in [root/'usr/lib/udev/rules.d',root/'etc/udev/rules.d']:
        for rule in sorted(rules_dir.glob('*')):
            if rules_dir == root/'usr/lib/udev/rules.d' and rule.name in UDEV_RULES:continue
            if not rule.is_file() and not rule.is_symlink():raise ValueError('Unexpected udev rule object')
            changes.append({'omittedUdevRule':rule.relative_to(root).as_posix()})
            rule.unlink()
    if {p.name for p in (root/'usr/lib/udev/rules.d').iterdir()} != UDEV_RULES:raise ValueError('Missing allowlisted input/DRM rule')
    for path in sorted(root.rglob('*')):
        if path.is_symlink() and os.readlink(path).startswith('/'):
            prior = os.readlink(path); target = os.path.relpath(root / prior.lstrip('/'), path.parent)
            path.unlink(); path.symlink_to(target)
            changes.append({'path':path.relative_to(root).as_posix(),'absoluteLink':prior,'relativeLink':target})
    # Packages are extracted without alternatives/postinst. Explicitly install
    # only the shell required by Xorg helpers; dangling package links are logged.
    shell = root / 'usr/bin/sh'
    if shell.is_symlink(): shell.unlink()
    shell.symlink_to('busybox')
    for path in sorted(root.rglob('*')):
        if path.is_symlink() and not path.exists():
            changes.append({'path':path.relative_to(root).as_posix(),'omittedDanglingLink':os.readlink(path)})
            path.unlink()
    lock = json.loads((payload / 'production-payload.json').read_text())
    if lock['kind'] != 'drivekey-production-payload-lock' or lock['fundingReady'] is not False: raise ValueError('Payload lock rejected')
    actual = {p.relative_to(payload).as_posix() for p in payload.rglob('*') if p.is_file()}
    if actual != set(lock['artifacts']) | {'production-payload.json'}: raise ValueError('Unexpected payload')
    for name, entry in lock['artifacts'].items():
        if not name.startswith('opt/drivekey/') or '..' in name.split('/'): raise ValueError('Unexpected artifact path')
        path = payload / name
        if path.is_symlink() or sha(path) != entry['sha256'] or path.stat().st_size != entry['bytes']: raise ValueError('Payload changed')
        target = root / name; target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(path, target)
    source_names = ['security-candidate-original-gui.py', 'security-interactive-image-init.py', 'security-interactive-storage.py', 'security-interactive-desktop.py', 'security-interactive-settings.py']
    sources = {'scripts/' + name:sha(PROJECT / 'scripts' / name) for name in source_names}
    for name in source_names: shutil.copyfile(PROJECT / 'scripts' / name, root / 'opt/drivekey' / name)
    for name in ['assemble-production-source-image.py','build-security-interactive-image.py','candidate-launch-policy.py','verify-node-release-signature.py']:
        sources['scripts/' + name] = sha(PROJECT / 'scripts' / name)
    archive, sums, node_report, node_auth = verified_node_archive(output)
    version = node_auth['version']; archive_name = archive.name
    node_records = {}
    with tarfile.open(archive) as tar:
        for suffix, dest in [('bin/node','node/bin/node'),('LICENSE','LICENSES/Node.txt')]:
            name = archive_name.removesuffix('.tar.xz') + '/' + suffix
            members = [m for m in tar if m.name == name]
            if len(members) != 1 or not members[0].isfile() or members[0].size > 150*1024*1024: raise ValueError('Invalid Node member')
            target = root / 'opt/drivekey' / dest; target.parent.mkdir(parents=True,exist_ok=True)
            with tar.extractfile(members[0]) as src, target.open('wb') as dst: shutil.copyfileobj(src,dst)
            target.chmod(0o755 if suffix == 'bin/node' else 0o644); node_records[dest] = sha(target)
    def write(name, value):
        path = root / name
        if path.is_symlink(): path.unlink()
        path.parent.mkdir(parents=True,exist_ok=True); path.write_text(value)
    for name in ['candidate','unfunded-image','interactive-image']: write('etc/drivekey-' + name, identifier + '\n')
    write('etc/drivekey-live','Unreleased source-built candidate; no funds\n'); write('etc/drivekey-rtc-zone','Europe/Warsaw\n')
    write('etc/drivekey-boot-layout.json',json.dumps(helpers.BOOT_LAYOUT)+'\n')
    write('etc/passwd','root:x:0:0:root:/nonexistent:/usr/bin/busybox\ncandidate:x:1000:1000:candidate:/run/user/1000:/usr/bin/busybox\nnobody:x:65534:65534:nobody:/nonexistent:/usr/bin/busybox\n')
    write('etc/group','root:x:0:\ncandidate:x:1000:\nnogroup:x:65534:\n')
    write('etc/nsswitch.conf','passwd: files\ngroup: files\nhosts: files\n'); write('etc/hosts','127.0.0.1 localhost\n'); write('etc/resolv.conf','')
    write('etc/fstab','# No swap, automount, persistence or host share.\n'); write('etc/udev/udev.conf','udev_log=err\n')
    write('etc/sysctl.d/99-drivekey-candidate.conf','kernel.core_pattern=core\n')
    write('etc/security/limits.d/99-drivekey-candidate.conf','* hard core 0\n* soft core 0\n')
    for name in ['proc','sys','dev','run','tmp','mnt/drivekey','var/cache/fontconfig']:(root / name).mkdir(parents=True,exist_ok=True)
    entries = []
    for path in sorted(root.rglob('*')):
        info = path.lstat(); name = path.relative_to(root).as_posix()
        if stat.S_ISDIR(info.st_mode): path.chmod(0o755); continue
        if name.split('/')[0] in VOLATILE_ROOTS:raise ValueError('Unexpected immutable file under volatile mount')
        if not path.is_symlink(): path.chmod(stat.S_IMODE(info.st_mode) & 0o755)
        os.chown(path,0,0,follow_symlinks=False)
        entry = {'path':name,'uid':0,'gid':0,'mode':stat.S_IMODE(path.lstat().st_mode)}
        if path.is_symlink(): entry.update(type='symlink',target=os.readlink(path))
        elif path.is_file(): entry.update(type='file',size=path.stat().st_size,sha256=sha(path))
        else: raise ValueError('Unexpected special payload')
        entries.append(entry)
    manifest = {'schemaVersion':1,'kind':policy.KIND,'candidateId':identifier,'imageId':identifier,
        'signed':False,'fundingReady':False,'productionReady':False,'bootValidated':False,'guiLaunchAllowed':False,
        'protectedPrefixes':[p.name for p in sorted(root.iterdir()) if p.name not in VOLATILE_ROOTS],'entries':entries}
    (root / policy.MANIFEST).write_text(json.dumps(manifest,indent=2)+'\n'); policy.validate_contents(root)
    init = output / 'initramfs'; init.mkdir()
    def copy_init(name):
        dest = init / name; dest.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(root / name,dest); dest.chmod(0o755)
    for name in ['usr/bin/busybox','usr/lib/x86_64-linux-gnu/libresolv.so.2','usr/lib/x86_64-linux-gnu/libc.so.6','usr/lib64/ld-linux-x86-64.so.2','usr/sbin/losetup']:copy_init(name)
    command = ['bwrap','--unshare-all','--ro-bind',str(root),'/','--proc','/proc','--dev','/dev','--','/usr/lib64/ld-linux-x86-64.so.2','--list','/usr/sbin/losetup']
    loader = subprocess.run(command,check=True,capture_output=True,text=True).stdout
    for name in re.findall(r'(?:=>\s*)?(/[^\s()]+)',loader):
        name=name.lstrip('/')
        if name.startswith(('lib/','lib64/')):name='usr/'+name
        copy_init(name)
    for name,target in [('lib','usr/lib'),('lib64','usr/lib64'),('bin','usr/bin')]: (init / name).symlink_to(target)
    for name in ['sh','mount','mkdir','sleep','switch_root','insmod','echo','cat','grep','blkid','wc','poweroff','readlink','awk']:(init/'usr/bin'/name).symlink_to('busybox')
    kernels = list((base/'rootfs/usr/lib/modules').iterdir())
    if len(kernels) != 1: raise ValueError('Ambiguous kernel')
    kernel = kernels[0].name; modules = []
    for module in helpers.MODULES:
        deps = subprocess.run(tool_command(base,['/usr/sbin/modprobe','--show-depends','-d','/','-S',kernel,module],output),check=True,capture_output=True,text=True).stdout
        for line in deps.splitlines():
            if not line.startswith('insmod '):continue
            path = base/'rootfs'/line.split()[1].lstrip('/')
            if not path.is_relative_to(base/'rootfs') or '/drivers/net/' in str(path) or '/kernel/net/' in str(path):raise ValueError('Invalid boot module')
            name = 'modules/' + path.name.removesuffix('.xz')
            if name in modules:continue
            dest=init/name;dest.parent.mkdir(exist_ok=True);dest.write_bytes(lzma.decompress(path.read_bytes()) if path.suffix=='.xz' else path.read_bytes());modules.append(name)
    label='DKI_' + identifier.rsplit('r',1)[1]
    (init/'init').write_text(helpers.init_script(modules,label,identifier));(init/'init').chmod(0o755)
    (output/'initramfs.cpio.gz').write_bytes(helpers.archive_init(init))
    shutil.copyfile(base/'rootfs/boot'/('vmlinuz-'+kernel),output/'vmlinuz')
    subprocess.run(tool_command(base,['/usr/bin/mksquashfs',str(root),str(output/'rootfs.squashfs'),'-noappend','-comp','xz','-processors','2','-no-progress','-mkfs-time','1792108800','-all-time','1792108800'],output),check=True)
    shutil.copyfile(root/policy.MANIFEST,output/'image-contents.json')
    for name,digest in sources.items():
        if sha(PROJECT/name)!=digest:raise ValueError('Source changed during build')
    result={'kind':'drivekey-source-built-unreleased-image','imageId':identifier,'bootLabel':label,'bootLayout':helpers.BOOT_LAYOUT,'kernel':kernel,'sources':sources,
      'runtimeBasePath':str(runtime_base),'runtimeBaseReportSha256':sha(runtime_base/'production-base.json'),'basePath':str(base),'imageToolsFromVerifiedBase':True,'baseReportSha256':sha(base/'production-base.json'),'payloadLockSha256':sha(payload/'production-payload.json'),
      'node':{'version':version,'archiveSha256':sha(archive),'checksumFileSha256':sha(sums),'files':node_records,'pgpVerified':True,
        'verificationReport':node_report.name,'verificationReportSha256':sha(node_report),'signerFingerprint':node_auth['primaryFingerprint'],
        'firstUseTrust':node_auth['firstUseTrust']},
      'rootChanges':changes,'artifacts':{name:{'sha256':sha(output/name),'bytes':(output/name).stat().st_size} for name in ['vmlinuz','initramfs.cpio.gz','rootfs.squashfs','image-contents.json']},
      'fundingReady':False,'signed':False,'bootTest':False,'historicalImageUsed':False,'productionReady':False}
    (output/'image-build.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result['artifacts']))
if __name__=='__main__':main()
