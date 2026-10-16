#!/usr/bin/python3
"""Assemble a NEW 1-GiB regular-file boot+exchange image. Never writes a device.

Preserves the original ISO, its files, and its existing partition extents. The
new copy updates GPT/PMBR metadata and appends an empty FAT32 partition at the
exact geometry authorized by the immutable guest manifest.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import struct
import subprocess
import sys
import uuid
import zlib

SECTOR = 512
LAYOUT = {'schemaVersion': 1, 'kind': 'drivekey-interactive-boot-layout',
          'protectedPrefixBytes': 268435456, 'sectorBytes': SECTOR,
          'sameDiskExchangeAllowed': True, 'exchangePartitionNumber': 5,
          'exchangeStartBytes': 268435456, 'exchangeLengthBytes': 804257792,
          'diskImageBytes': 1073741824}
BASIC_DATA = uuid.UUID('ebd0a0a2-b9e5-4433-87c0-68b6b72699c7').bytes_le


def sha(path, offset=0, length=None):
    digest = hashlib.sha256()
    with Path(path).open('rb') as handle:
        handle.seek(offset)
        while length is None or length > 0:
            data = handle.read(1048576 if length is None else min(1048576, length))
            if not data:
                if length not in (None, 0):
                    raise ValueError('Short image extent')
                break
            digest.update(data)
            if length is not None:
                length -= len(data)
    return digest.hexdigest()


def read_gpt(path):
    with path.open('rb') as handle:
        mbr = bytearray(handle.read(SECTOR))
        header = bytearray(handle.read(SECTOR))
        if mbr[510:] != b'\x55\xaa' or header[:8] != b'EFI PART':
            raise ValueError('Expected hybrid GPT ISO')
        header_size = struct.unpack_from('<I', header, 12)[0]
        if header_size != 92:
            raise ValueError('Unexpected GPT header size')
        saved_crc = struct.unpack_from('<I', header, 16)[0]
        struct.pack_into('<I', header, 16, 0)
        if zlib.crc32(header[:header_size]) & 0xffffffff != saved_crc:
            raise ValueError('Invalid source GPT header CRC')
        entry_lba, count, entry_size, entries_crc = struct.unpack_from('<QIII', header, 72)
        if entry_lba != 20 or count != 176 or entry_size != 128:
            raise ValueError('Unexpected retained hybrid GPT layout')
        handle.seek(entry_lba * SECTOR)
        entries = bytearray(handle.read(count * entry_size))
        if zlib.crc32(entries) & 0xffffffff != entries_crc:
            raise ValueError('Invalid source GPT table CRC')
    partitions = []
    for number in range(count):
        entry = entries[number * entry_size:(number + 1) * entry_size]
        if not any(entry[:16]):
            if any(entry):
                raise ValueError('Partially initialized unused GPT entry')
            continue
        start, end, flags = struct.unpack_from('<QQQ', entry, 32)
        if start > end or (end + 1) * SECTOR > LAYOUT['protectedPrefixBytes']:
            raise ValueError('Source partition exceeds protected boot extent')
        partitions.append({'number': number + 1, 'startLBA': start, 'endLBA': end,
                           'flags': flags, 'name': entry[56:128].decode('utf-16le').rstrip('\0')})
    if [p['number'] for p in partitions] != [1, 2, 3, 4]:
        raise ValueError('Expected the four retained ISO partitions')
    if [(p['number'], p['name']) for p in partitions if p['name'].startswith('Gap')] != [(1, 'Gap0'), (4, 'Gap1')]:
        raise ValueError('Unexpected padding partition identities')
    if mbr[450] != 0xee or any(mbr[462:510]) or struct.unpack_from('<I', mbr, 454)[0] != 1:
        raise ValueError('Expected one protective MBR entry')
    return mbr, header, entries, partitions


def seal_header(header):
    struct.pack_into('<I', header, 16, 0)
    struct.pack_into('<I', header, 16, zlib.crc32(header[:92]) & 0xffffffff)
    return header


def main():
    if sys.platform != 'linux' or len(sys.argv) != 2:
        raise ValueError('Linux and a completed interactive image directory required')
    output = Path(sys.argv[1]).resolve(strict=True)
    build = json.loads((output / 'image-build.json').read_text())
    distribution = json.loads((output / 'distribution-build.json').read_text())
    if build.get('kind') != 'drivekey-unreleased-interactive-candidate-image' or distribution.get('kind') != 'drivekey-unsigned-interactive-candidate-distribution':
        raise ValueError('Unreleased interactive distribution required')
    if build.get('bootLayout') != LAYOUT or distribution.get('bootLayout') != LAYOUT:
        raise ValueError('Immutable single-USB geometry differs')
    if not re.fullmatch(r'interactive-[0-9]{8}-r[1-9][0-9]{9,19}', build['imageId']) or output.name != build['imageId']:
        raise ValueError('Invalid image identity')
    iso_name = build['imageId'] + '-interactive.iso'
    if distribution.get('isoName') != iso_name:
        raise ValueError('Unexpected source ISO name')
    iso = output / iso_name
    if not stat.S_ISREG(iso.lstat().st_mode) or iso.stat().st_size != distribution['bytes'] or sha(iso) != distribution['sha256']:
        raise ValueError('Source ISO identity differs')
    if iso.stat().st_size > LAYOUT['protectedPrefixBytes']:
        raise ValueError('Source ISO exceeds reserved prefix')
    project = Path(__file__).resolve().parent.parent
    expected_sources = {'scripts/build-security-interactive-image.py', 'scripts/build-security-interactive-distribution.py',
                        'scripts/build-security-single-usb.py', 'scripts/security-interactive-image-init.py',
                        'scripts/security-interactive-storage.py', 'scripts/security-interactive-desktop.py',
                        'scripts/security-interactive-settings.py'}
    if set(build['sources']) != expected_sources:
        raise ValueError('Unexpected source set')
    for name, expected in build['sources'].items():
        if sha(project / name) != expected:
            raise ValueError('Source changed since immutable image build: ' + name)
    work = Path(build['work']).resolve(strict=True)
    if work.parent != Path('/opt/drivekey-interactive-images') or work.name != build['imageId']:
        raise ValueError('Invalid dedicated work directory')
    stage = work / 'single-usb'
    stage.mkdir()
    image_path = output / (build['imageId'] + '-single-usb.img')
    if image_path.exists() or image_path.is_symlink() or (output / 'single-usb-build.json').exists():
        raise ValueError('Single-USB output already exists')
    mbr, header, entries, original_partitions = read_gpt(iso)
    fat = stage / 'empty-exchange.fat'
    serial = uuid.uuid4().hex[:8].upper()
    label = 'DRIVEKEY'
    result = subprocess.run(['/usr/sbin/mkfs.vfat', '-C', '-F', '32', '-n', label, '-i', serial,
                             str(fat), str(LAYOUT['exchangeLengthBytes'] // 1024)],
                            capture_output=True, text=True)
    (output / 'single-usb-format.log').write_text(result.stdout + result.stderr)
    result.check_returncode()
    if not stat.S_ISREG(fat.lstat().st_mode) or fat.stat().st_size != LAYOUT['exchangeLengthBytes']:
        raise ValueError('Unexpected regular FAT image size')
    with fat.open('rb') as handle:
        boot_sector = handle.read(SECTOR)
    if boot_sector[510:] != b'\x55\xaa' or boot_sector[82:90] != b'FAT32   ' or struct.unpack_from('<I', boot_sector, 67)[0] != int(serial, 16):
        raise ValueError('FAT32 filesystem identity differs')
    start = LAYOUT['exchangeStartBytes'] // SECTOR
    end = (LAYOUT['exchangeStartBytes'] + LAYOUT['exchangeLengthBytes']) // SECTOR - 1
    if any(not (p['endLBA'] < start or p['startLBA'] > end) for p in original_partitions):
        raise ValueError('Exchange overlaps retained boot partitions')
    # Windows must not offer the ISO's filesystem-less padding as data drives.
    for number in (1, 4):
        offset = (number - 1) * 128 + 48
        flags = struct.unpack_from('<Q', entries, offset)[0]
        struct.pack_into('<Q', entries, offset, flags | (1 << 63))
    entry = bytearray(128)
    entry[:16] = BASIC_DATA
    entry[16:32] = uuid.uuid4().bytes_le
    struct.pack_into('<QQQ', entry, 32, start, end, 0)
    encoded_name = 'DriveKey exchange'.encode('utf-16le')
    entry[56:56 + len(encoded_name)] = encoded_name
    entries[4 * 128:5 * 128] = entry
    last_lba = LAYOUT['diskImageBytes'] // SECTOR - 1
    backup_table_lba = last_lba - len(entries) // SECTOR
    if end >= backup_table_lba:
        raise ValueError('Exchange overlaps backup GPT')
    struct.pack_into('<I', mbr, 458, last_lba)
    struct.pack_into('<Q', header, 32, last_lba)
    struct.pack_into('<Q', header, 48, backup_table_lba - 1)
    struct.pack_into('<I', header, 88, zlib.crc32(entries) & 0xffffffff)
    seal_header(header)
    backup = bytearray(header)
    struct.pack_into('<Q', backup, 24, last_lba)
    struct.pack_into('<Q', backup, 32, 1)
    struct.pack_into('<Q', backup, 72, backup_table_lba)
    seal_header(backup)
    with image_path.open('xb') as target, iso.open('rb') as source:
        shutil.copyfileobj(source, target, 1048576)
        target.truncate(LAYOUT['diskImageBytes'])
        target.seek(0)
        target.write(mbr)
        target.write(header)
        target.seek(20 * SECTOR)
        target.write(entries)
        target.seek(LAYOUT['exchangeStartBytes'])
        with fat.open('rb') as source:
            shutil.copyfileobj(source, target, 1048576)
        target.seek(backup_table_lba * SECTOR)
        target.write(entries)
        target.write(backup)
        target.flush()
        os.fsync(target.fileno())
    # Retained file payload starts after the first 64 sectors. Verify it byte
    # for byte; only PMBR/GPT system-area metadata may differ from the ISO.
    immutable_offset = 64 * SECTOR
    if sha(image_path, immutable_offset, iso.stat().st_size - immutable_offset) != sha(iso, immutable_offset, iso.stat().st_size - immutable_offset):
        raise ValueError('Original ISO payload changed')
    if sha(iso) != distribution['sha256']:
        raise ValueError('Original ISO was modified')
    verification = subprocess.run(['/usr/sbin/sfdisk', '--verify', str(image_path)], capture_output=True, text=True)
    (output / 'single-usb-partition-verification.log').write_text(verification.stdout + verification.stderr)
    verification.check_returncode()
    parsed = json.loads(subprocess.check_output(['/usr/sbin/sfdisk', '--json', str(image_path)], text=True))['partitiontable']
    if parsed.get('label') != 'gpt' or parsed.get('unit') != 'sectors' or parsed.get('sectorsize') != SECTOR:
        raise ValueError('Independent partition parser rejected geometry')
    expected_extents = [(p['startLBA'], p['endLBA'] - p['startLBA'] + 1) for p in original_partitions] + [(start, end - start + 1)]
    if [(p['start'], p['size']) for p in parsed['partitions']] != expected_extents:
        raise ValueError('Readback partition extents differ')
    if parsed['partitions'][4]['type'].lower() != str(uuid.UUID(bytes_le=BASIC_DATA)):
        raise ValueError('Readback exchange partition type differs')
    if sha(image_path, LAYOUT['exchangeStartBytes'], LAYOUT['exchangeLengthBytes']) != sha(fat):
        raise ValueError('Readback FAT filesystem differs')
    suffix_start = LAYOUT['exchangeStartBytes'] + LAYOUT['exchangeLengthBytes']
    record = {'kind': 'drivekey-single-usb-candidate-distribution', 'imageId': build['imageId'],
              'imageName': image_path.name, 'sha256': sha(image_path), 'bytes': image_path.stat().st_size,
              'sourceISO': {'name': iso.name, 'sha256': distribution['sha256'], 'bytes': iso.stat().st_size},
              'exchange': {'offsetBytes': LAYOUT['exchangeStartBytes'], 'lengthBytes': LAYOUT['exchangeLengthBytes'],
                           'partitionNumber': 5, 'uuid': serial[:4] + '-' + serial[4:], 'label': label},
              'protectedPrefixBytes': LAYOUT['protectedPrefixBytes'],
              'protectedPrefixSha256': sha(image_path, 0, LAYOUT['protectedPrefixBytes']),
              'protectedSuffixSha256': sha(image_path, suffix_start, LAYOUT['diskImageBytes'] - suffix_start),
              'partitionTableMutations': ['Protective MBR length updated to 1 GiB', 'Primary GPT CRC, usable end, and backup location updated',
                                          'Gap0 and Gap1 retain extents with no-drive-letter bit set', 'Basic-data partition 5 added outside protected prefix',
                                          'Matching backup GPT added in protected final 1 MiB; obsolete ISO-internal backup retained as inert bytes'],
              'originalPartitions': original_partitions, 'bootLayout': LAYOUT, 'sources': build['sources'],
              'isoPayloadPreservedFromByte': immutable_offset, 'originalISOModified': False,
              'partitionTableVerified': True, 'exchangeFilesystemVerified': True,
              'signed': False, 'secureBootAuthenticated': False, 'bootTest': False,
              'fundingReady': False, 'productionReady': False}
    (output / 'single-usb-build.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps(record))


if __name__ == '__main__':
    main()
