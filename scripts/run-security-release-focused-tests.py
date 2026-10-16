#!/usr/bin/python3
"""Record focused tests with exact source and image-build hashes; no wallets."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

project = Path(__file__).resolve().parent.parent
image = Path(sys.argv[1]).resolve(strict=True)
build_raw = (image / 'image-build.json').read_bytes()
build = json.loads(build_raw)
root = Path(build['work']) / 'rootfs'
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
for name, expected in build['sources'].items():
    if sha(project / name) != expected:
        raise ValueError('Source changed after build: ' + name)
reports = []
for suffix, count in [('settings', 7), ('packaging', 5), ('init', 18), ('initramfs', 11), ('storage', 33)]:
    script = 'scripts/test-security-interactive-' + suffix + '.py'
    command = ['/usr/bin/python3', '-B', script, '-v']
    if suffix == 'settings':
        command += ['--runtime-dir', str(root / 'opt/drivekey')]
        command = ['/usr/bin/xvfb-run', '-a', '/usr/bin/env',
            'PYTHONPATH=' + ':'.join(str(root / p) for p in ['usr/lib/python3.13', 'usr/lib/python3.13/lib-dynload', 'usr/lib/python3/dist-packages']),
            'LD_LIBRARY_PATH=' + str(root / 'usr/lib/x86_64-linux-gnu'),
            'TCL_LIBRARY=' + str(root / 'usr/share/tcltk/tcl8.6'),
            'TK_LIBRARY=' + str(root / 'usr/share/tcltk/tk8.6')] + command
    result = subprocess.run(command, cwd=project, capture_output=True, text=True, timeout=180)
    match = re.search(r'Ran (\d+) tests? in ', result.stderr)
    reports.append({'script': script, 'sha256': sha(project / script), 'command': command,
        'exitCode': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr,
        'passed': result.returncode == 0 and match is not None and int(match[1]) == count,
        'expectedTests': count})
report = {'kind': 'drivekey-focused-release-tests', 'imageId': build['imageId'],
    'imageBuildSha256': hashlib.sha256(build_raw).hexdigest(), 'sources': build['sources'],
    'runs': reports, 'passed': all(r['passed'] for r in reports), 'fundingReady': False}
destination = image / 'focused-release-tests.json'
with destination.open('x') as handle:
    handle.write(json.dumps(report, indent=2) + '\n')
print(json.dumps({'report': str(destination), 'passed': report['passed'], 'tests': sum(r['expectedTests'] for r in reports)}))
raise SystemExit(0 if report['passed'] else 1)
