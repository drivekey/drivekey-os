#!/usr/bin/python3
"""Read-only identity inventory of the published beta and its local prerequisites.

Print JSON; exit nonzero on identity failure. This checks correspondence, not
authenticity, source completeness, audited safety, or deterministic rebuilds.
"""
import argparse
import hashlib
import json
from pathlib import Path

IDENTITY = 'interactive-20261016-r1792156250605'
PINS = {
    IDENTITY + '-single-usb.img': 'd49477fb686f56762bca824f235bb0e04ecb2c0cf23b0cd2c79b061cc904fc72',
    IDENTITY + '-interactive.iso': '6bd1c4c2ac42a331e3245efab020a87ffdfb56acb7fc0eca7def1ac07f3ca0a6',
    'image-contents.json': 'fc51fc2ec11d66ce02bcb92018e7a40e71efdf13f0b34d4d4cb383385c5d6a0c',
}


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def inspect(root, records):
    results = []
    for name, expected in sorted(records.items()):
        if not isinstance(name, str) or '\\' in name or Path(name).is_absolute() or '..' in Path(name).parts:
            raise ValueError('Unsafe inventory path')
        path = root / name
        if not path.resolve().is_relative_to(root.resolve()):
            raise ValueError('Inventory link escapes root')
        result = {'path': name, 'expectedSha256': expected}
        if path.is_file() and not path.is_symlink():
            result.update(sha256=digest(path), bytes=path.stat().st_size)
            result['matches'] = result['sha256'] == expected
        else:
            result.update(matches=False, missing=True)
        results.append(result)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--output', type=Path, help='Write a new report; refuses overwrite')
    args = parser.parse_args()
    root = args.project.resolve(strict=True)
    folder = root / 'outputs/security-interactive-images' / IDENTITY
    artifacts = inspect(folder, PINS)
    if not all(r['matches'] for r in artifacts):
        print(json.dumps({'ok': False, 'artifacts': artifacts}, indent=2))
        return 1
    manifest = json.loads((folder / 'image-contents.json').read_text())
    sources = dict(manifest['sourceSha256'])
    sources.update(manifest['imageSources'])
    sources.update(manifest['interactiveImageSources'])
    source_results = inspect(root, sources)
    licenses = [e for e in manifest['entries'] if 'license' in e['path'].lower() or 'copyright' in e['path'].lower()]
    report = {'kind': 'drivekey-published-beta-prerequisite-inventory', 'imageId': IDENTITY,
        'artifacts': artifacts, 'sourceFiles': source_results, 'licenseEntries': licenses,
        'ok': all(r['matches'] for r in source_results), 'fundingReady': False,
        'authenticatesRelease': False, 'provesReproducibleBuild': False,
        'limits': ['Current local source may intentionally differ from the published beta.',
                   'Does not inventory transitive npm, OS package or toolchain source closure.',
                   'Read-only; does not package or upload wallets, fixtures or runtime directories.']}
    if args.output:
        with args.output.open('x', encoding='utf-8') as handle:
            handle.write(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'output': str(args.output), 'ok': report['ok'],
                          'sourceFiles': len(source_results),
                          'differentSources': sum(not r['matches'] for r in source_results),
                          'artifactsMatch': True}))
    else:
        print(json.dumps(report, indent=2))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
