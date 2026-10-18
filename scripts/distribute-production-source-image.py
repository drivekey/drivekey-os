#!/usr/bin/python3
"""Package the NEW interactive image as unsigned BIOS/UEFI ISO; no disk writes."""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

_spec = importlib.util.spec_from_file_location('node_binding', Path(__file__).with_name('production-image-node-binding.py'))
node_binding = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(node_binding)


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for chunk in iter(lambda: handle.read(1048576), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    if sys.platform != 'linux' or len(sys.argv) != 2:
        raise ValueError('Linux interactive image directory required')
    source = Path(sys.argv[1]).resolve(strict=True)
    build = json.loads((source / 'image-build.json').read_text())
    if build.get('kind') != 'drivekey-source-built-unreleased-image' or build.get('fundingReady') is not False:
        raise ValueError('Unreleased interactive candidate required')
    if not re.fullmatch(r'DKI_[0-9]{10,20}', build['bootLabel']):
        raise ValueError('Invalid boot label')
    if set(build['artifacts']) != {'vmlinuz', 'initramfs.cpio.gz', 'rootfs.squashfs', 'image-contents.json'}:
        raise ValueError('Unexpected interactive artifact set')
    project = Path(__file__).resolve().parent.parent
    node_evidence = node_binding.validate(source, build)
    if build.get('historicalImageUsed') is not False:
        raise ValueError('Source-built input required')
    for name, expected in build['sources'].items():
        if sha(project / name) != expected:
            raise ValueError('Interactive source changed after image build: ' + name)
    for name, record in build['artifacts'].items():
        if sha(source / name) != record['sha256'] or (source / name).stat().st_size != record['bytes']:
            raise ValueError('Interactive image artifact differs')
    work = source
    spec=importlib.util.spec_from_file_location('source_assembler',Path(__file__).with_name('assemble-production-source-image.py'))
    assembler=importlib.util.module_from_spec(spec);spec.loader.exec_module(assembler)
    if not build.get('imageToolsFromVerifiedBase'):raise ValueError('Verified toolchain base required for new distribution')
    base=assembler.verified_base(Path(build['basePath']),build['baseReportSha256'])
    if work.parent != Path('/opt/drivekey-production-images') or work.name != build['imageId']:
        raise ValueError('Invalid dedicated work directory')
    stage = work / 'iso-root'
    stage.mkdir()
    (stage / 'live').mkdir()
    (stage / 'boot/grub').mkdir(parents=True)
    (stage / 'boot/grub/fonts').mkdir()
    shutil.copyfile(base/'rootfs/usr/share/grub/unicode.pf2', stage / 'boot/grub/fonts/unicode.pf2')
    for name in build['artifacts']:
        shutil.copyfile(source / name, stage / 'live' / name)
    config = '''set timeout=5
set default=0
insmod all_video
insmod gfxterm
loadfont /boot/grub/fonts/unicode.pf2
set gfxmode=1280x800,1024x768,auto
set gfxpayload=keep
terminal_input console
terminal_output gfxterm
menuentry "DriveKey interactive candidate - not released for funds" {
 echo DRIVEKEY_GRUB_INTERACTIVE_BOOT
 linux /live/vmlinuz console=tty0 console=ttyS0,115200 rdinit=/init ro panic=0 drivekey.interactive=1
 initrd /live/initramfs.cpio.gz
}
'''
    (stage / 'boot/grub/grub.cfg').write_text(config)
    iso = source / (build['imageId'] + '-interactive.iso')
    if iso.exists():
        raise ValueError('Interactive distribution already exists')
    result = subprocess.run(assembler.tool_command(base,['/usr/bin/grub-mkrescue', '-o', str(iso), str(stage), '--', '-volid', build['bootLabel']],source), capture_output=True, text=True)
    (source / 'distribution-build.log').write_text(result.stdout + result.stderr)
    result.check_returncode()
    layout = build.get('bootLayout')
    if not isinstance(layout, dict) or layout.get('protectedPrefixBytes') != 268435456 or iso.stat().st_size > layout['protectedPrefixBytes']:
        raise ValueError('ISO exceeds the immutable reserved boot extent')
    catalog = subprocess.run(assembler.tool_command(base,['/usr/bin/xorriso', '-indev', str(iso), '-report_el_torito', 'plain', '-report_system_area', 'plain'],source), capture_output=True, text=True, check=True)
    (source / 'distribution-boot-catalog.txt').write_text(catalog.stdout + catalog.stderr)
    record = {'kind': 'drivekey-unsigned-interactive-candidate-distribution',
              'assemblerSourceSha256': sha(Path(__file__)),
              'nodeBindingHelperSha256': sha(Path(node_binding.__file__)), 'nodeVerification': node_evidence,
              'imageId': build['imageId'], 'isoName': iso.name, 'sha256': sha(iso),
              'bytes': iso.stat().st_size, 'bootLabel': build['bootLabel'],
              'grubConfigSha256': sha(stage / 'boot/grub/grub.cfg'),
              'sourceArtifacts': build['artifacts'], 'sources': build['sources'],
              'bootLayout': layout,
              'signed': False, 'secureBootAuthenticated': False, 'bootTest': False,
              'physicalHardwareValidated': False, 'fundingReady': False, 'productionReady': False}
    (source / 'distribution-build.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps(record))


if __name__ == '__main__':
    main()
