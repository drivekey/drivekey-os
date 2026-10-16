#!/usr/bin/python3
"""Prepare an explicit, hash-checked partial source/notice review archive.

Excludes test/fixture inputs and node_modules. This is NOT a standalone build kit.
Requires the new immutable image manifest and its extracted build root.
"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def source_allowed(name):
    path = Path(name)
    allowed = {'LICENSE', 'package.json', 'pnpm-lock.yaml'}
    prefixes = {'core', 'offline-signer', 'companion', 'contracts', 'scripts', 'packaging', 'public'}
    if path.is_absolute() or '..' in path.parts or '\\' in name or not path.parts:
        raise ValueError('Unsafe source name')
    if 'node_modules' in path.parts:
        return False
    # Path exclusions supplement the pinned source allowlist; they cannot prove
    # that arbitrary source text contains no embedded secret.
    if any(part.startswith('.') for part in path.parts):
        return False
    if any(part.lower() in {'credentials', 'wallets', 'wallet-output', 'wallet-outputs',
                            'keyfiles', 'keypairs', 'secrets', 'id_rsa', 'id_ed25519'} for part in path.parts):
        return False
    if path.suffix.lower() in {'.pem', '.key', '.p12', '.pfx', '.keystore'}:
        return False
    if path.name.lower() in {'wallet.json', 'keypair.json', 'credentials.json', 'secrets.json',
                            'private-key.json', 'seed.txt', 'recovery-phrase.txt'}:
        return False
    if name not in allowed and path.parts[0] not in prefixes:
        return False
    lower = name.lower()
    if any(token in lower for token in ('fixture', 'research', '-tests', '/tests/', 'smoke', 'test-')):
        return False
    return path.name != 'security-candidate-image-init.py'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    project = Path(__file__).resolve().parent.parent
    build = json.loads((args.image / 'image-build.json').read_text())
    raw_manifest = (args.image / 'image-contents.json').read_bytes()
    if sha(raw_manifest) != build['artifacts']['image-contents.json']['sha256']:
        raise ValueError('Image manifest mismatch')
    manifest = json.loads(raw_manifest)
    root = Path(build['work']) / 'rootfs'
    sources = dict(manifest['sourceSha256'])
    sources.update(manifest['imageSources'])
    sources.update(manifest['interactiveImageSources'])
    contents, excluded = {}, []
    for name, expected in sorted(sources.items()):
        path = Path(name)
        if path.is_absolute() or '..' in path.parts or '\\' in name:
            raise ValueError('Unsafe source name')
        if not source_allowed(name):
            excluded.append({'path': name, 'sha256': expected, 'reason': 'dependency, test or fixture input omitted'})
            continue
        local = project / name
        if local.is_symlink() or not local.resolve().is_relative_to(project):
            raise ValueError('Unsafe source link')
        data = local.read_bytes()
        if sha(data) != expected:
            raise ValueError('Source does not match image: ' + name)
        contents['source/' + name] = data
    for entry in manifest['entries']:
        name = entry['path']
        if name.startswith(('opt/drivekey/LICENSES/', 'usr/share/common-licenses/')) and entry['type'] == 'file':
            if Path(name).is_absolute() or '..' in Path(name).parts:
                raise ValueError('Unsafe notice name')
            data = (root / name).read_bytes()
            if sha(data) != entry['sha256']:
                raise ValueError('Notice changed')
            contents['notices/' + name] = data
    record = {'kind': 'drivekey-partial-source-review-handoff', 'imageId': build['imageId'],
        'completeBuildKit': False, 'fundingReady': False,
        'contents': {name: {'bytes': len(data), 'sha256': sha(data)} for name, data in sorted(contents.items())},
        'excludedInputs': excluded,
        'missingPrerequisites': ['Immutable original candidate contains research harnesses and is not included.',
            'Historical Debian base/rootfs/modules, host tools and transitive npm inputs are not included.',
            'Package versions and license notices are local inventory, not authenticated corresponding-source provenance.']}
    contents['HANDOFF.json'] = (json.dumps(record, indent=2) + '\n').encode()
    contents['README.txt'] = b'Partial source review handoff. Read HANDOFF.json. Not a complete build kit or funded release.\n'
    with zipfile.ZipFile(args.destination, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(contents.items()):
            info = zipfile.ZipInfo(name, (2026, 10, 16, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    print(json.dumps({'archive': str(args.destination), 'sha256': sha(args.destination.read_bytes()),
                      'files': len(contents), 'omittedInputs': len(excluded), 'completeBuildKit': False}))


if __name__ == '__main__':
    main()
