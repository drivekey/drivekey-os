#!/usr/bin/python3
"""Candidate-only, read-only launch checks. This is not secure/authenticated boot."""
import hashlib
import json
import os
from pathlib import Path
import resource
import stat
import sys
import time

KIND = 'drivekey-unfunded-security-candidate'
MANIFEST = 'opt/drivekey/candidate-contents.json'

def strict_json(raw):
    if len(raw) > 16 * 1024 * 1024: raise ValueError('Manifest too large')
    def unique(pairs):
        out = {}
        for key, value in pairs:
            if key in out: raise ValueError('Duplicate manifest key')
            out[key] = value
        return out
    return json.loads(raw.decode('utf-8'), object_pairs_hook=unique)

class Progress:
    """Bounded aggregate diagnostics only; never an approval or cached result."""
    STAGES = ('manifest','entries','inventory','markers','environment','complete')
    def __init__(self, stream=None, clock=time.monotonic):
        self.stream = sys.stderr if stream is None else stream
        self.clock = clock; self.start = clock(); self.last = self.start
        self.count = 0; self.entries = 0; self.bytes = 0; self.stage = 'manifest'
    def emit(self, stage=None, force=False):
        now = self.clock()
        if stage is not None:
            if stage not in self.STAGES: raise ValueError('Invalid diagnostic stage')
            self.stage = stage
        if self.count >= 16 or (not force and now-self.last < 2): return
        record = {'stage':self.stage,'entries':self.entries,'bytes':self.bytes,
                  'elapsedMs':max(0,int((now-self.start)*1000))}
        self.stream.write(json.dumps(record,separators=(',',':'))+'\n'); self.stream.flush()
        self.count += 1; self.last = now
    def hashed(self, count):
        self.bytes += count; self.emit()

def digest(path, progress=None):
    h = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            h.update(chunk)
            if progress is not None: progress.hashed(len(chunk))
    return h.hexdigest()

def validate_contents(root, progress=None):
    """Explicit root argument is for build verification; installed CLI fixes '/'."""
    if progress is not None: progress.emit('manifest',force=True)
    root = Path(root).resolve(strict=True)
    manifest_path = root / MANIFEST
    ms = manifest_path.lstat()
    if not stat.S_ISREG(ms.st_mode) or ms.st_uid != 0 or ms.st_gid != 0 or ms.st_mode & 0o022:
        raise ValueError('Untrusted manifest permissions')
    m = strict_json(manifest_path.read_bytes())
    if m.get('kind') != KIND or m.get('schemaVersion') != 1 or m.get('signed') is not False:
        raise ValueError('Unsupported candidate manifest')
    if m.get('fundingReady') is not False or m.get('productionReady') is not False or m.get('bootValidated') is not False or m.get('guiLaunchAllowed') is not False:
        raise ValueError('Unsupported candidate readiness')
    entries = m.get('entries')
    if not isinstance(entries,list) or not 1 <= len(entries) <= 20000: raise ValueError('Unsupported file count')
    if progress is not None: progress.emit('entries',force=True)
    expected = set()
    for entry in entries:
        name = entry['path']
        if not isinstance(name,str) or name.startswith('/') or '..' in name.split('/') or name in expected or name == MANIFEST:
            raise ValueError('Invalid manifest path')
        expected.add(name)
        p = root / name
        # Never follow an attacker-controlled parent directory into other storage.
        for ancestor in p.parents:
            s = ancestor.lstat()
            if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_gid != 0 or s.st_mode & 0o022:
                raise ValueError('Untrusted parent directory')
            if ancestor == root: break
        s = p.lstat()
        if s.st_uid != 0 or s.st_gid != 0 or stat.S_IMODE(s.st_mode) != entry['mode'] or (not stat.S_ISLNK(s.st_mode) and s.st_mode & 0o022):
            raise ValueError('Candidate permissions differ')
        if entry['type'] == 'file':
            if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or s.st_size != entry['size'] or digest(p,progress) != entry['sha256']:
                raise ValueError('Candidate file identity differs')
        elif entry['type'] == 'symlink':
            if not stat.S_ISLNK(s.st_mode) or os.readlink(p) != entry['target']:
                raise ValueError('Candidate link identity differs')
            resolved = p.resolve(strict=True)
            if not resolved.is_relative_to(root): raise ValueError('Candidate link escapes root')
        else: raise ValueError('Unsupported manifest object')
        if progress is not None:
            progress.entries += 1; progress.emit()
    if progress is not None: progress.emit('inventory',force=True)
    actual=set()
    for prefix in m['protectedPrefixes']:
        base=root/prefix
        for p in ([base] if base.is_symlink() or base.is_file() else base.rglob('*')):
            if not p.is_dir() or p.is_symlink():actual.add(str(p.relative_to(root)))
    actual.discard(MANIFEST)
    if actual != expected: raise ValueError('Unexpected or missing candidate file')
    if progress is not None: progress.emit('markers',force=True)
    if (root/'etc/sysctl.d/99-drivekey-candidate.conf').read_text() != 'kernel.core_pattern=core\n':
        raise ValueError('Candidate crash policy differs')
    if (root/'etc/drivekey-candidate').read_text().strip() != m['candidateId']:
        raise ValueError('Candidate marker differs')
    return m

def environment_errors(root=Path('/')):
    """Read actual policy state; never modifies host swap, sysctl or networking."""
    errors = []
    try:
        pattern = (root/'proc/sys/kernel/core_pattern').read_text().strip()
        if not pattern or len(pattern)>256 or '\x00' in pattern or pattern.startswith('|'): errors.append('piped-or-invalid-core-pattern')
    except OSError: errors.append('core-pattern-unavailable')
    try:
        if len((root/'proc/swaps').read_text().strip().splitlines()) != 1: errors.append('active-or-invalid-swap')
    except OSError: errors.append('swap-state-unavailable')
    try:
        for entry in (root/'sys/class/net').iterdir():
            if entry.name != 'lo': errors.append('non-loopback-network-interface')
    except OSError: errors.append('network-state-unavailable')
    try:
        rows=[line.split(' - ',1)[0].split() for line in (root/'proc/self/mountinfo').read_text().splitlines()]
        selected=[row for row in rows if len(row)>=6 and row[4]=='/']
        if len(selected)!=1 or 'ro' not in selected[0][5].split(','):errors.append('root-not-read-only')
    except OSError:errors.append('root-mount-state-unavailable')
    if not (root/'etc/drivekey-live').is_file(): errors.append('offline-image-marker-missing')
    return sorted(set(errors))

def main():
    if sys.platform != 'linux' or sys.argv[1:] not in (['--check'],['--gui']): raise ValueError('Unsupported invocation')
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    progress = Progress()
    m = validate_contents(Path('/'),progress)
    progress.emit('environment',force=True)
    errors = environment_errors()
    if errors:
        print(json.dumps({'kind':'drivekey-candidate-launch-check','ok':False,'reasons':errors,'fundingReady':False}))
        return 1
    if sys.argv[1] == '--gui':
        # The staged original modules are review artifacts. No claim that their
        # Tk/X/Pillow runtime or native rendering has passed candidate acceptance.
        raise ValueError('Candidate GUI runtime and visual acceptance are incomplete')
    progress.emit('complete',force=True)
    print(json.dumps({'kind':'drivekey-candidate-launch-check','ok':True,'candidateId':m['candidateId'],
                     'signed':False,'bootValidated':False,'fundingReady':False}))
    return 0

if __name__ == '__main__':
    try: raise SystemExit(main())
    except (OSError,ValueError,KeyError,TypeError):
        print(json.dumps({'kind':'drivekey-candidate-launch-check','ok':False,'reason':'Candidate integrity or launch policy rejected','fundingReady':False}))
        raise SystemExit(1)
