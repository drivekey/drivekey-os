#!/usr/bin/python3
"""Audit completed interactive smoke evidence without starting or mounting a VM.

Usage: audit-security-interactive-smoke.py IMAGE_DIRECTORY REPORT_DIRECTORY [...] [--output-name NAME.json]
Writes a new interactive-smoke-evidence-audit.json (or validated NAME.json) beside the exact ISO. A hash
check is not visual, transaction, physical-hardware, or funded-release acceptance.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

BOOT_LAYOUT = {'schemaVersion': 1, 'kind': 'drivekey-interactive-boot-layout',
               'protectedPrefixBytes': 268435456, 'sectorBytes': 512,
               'sameDiskExchangeAllowed': True, 'exchangePartitionNumber': 5,
               'exchangeStartBytes': 268435456, 'exchangeLengthBytes': 804257792,
               'diskImageBytes': 1073741824}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda: handle.read(1048576), b''):
            digest.update(block)
    return digest.hexdigest()


def records(serial, name):
    return [json.loads(value) for value in re.findall(name + r' (\{[^\r\n]+\})', serial)]


def audit_settings(report, states):
    """Bind session-only Settings assertions to ordered public GUI states."""
    checks = report.get('settingsChecks')
    require(isinstance(checks, dict), 'Settings interaction evidence missing')
    for flag in ('passed', 'actualButtonClicked', 'fontChanged', 'largeTextChanged',
                 'reducedMotionChanged', 'lowEffectsChanged', 'defaultsRestored',
                 'escapeClosed', 'returnReopenedFocusedButton', 'doneClosed'):
        require(checks.get(flag) is True, 'Settings interaction did not pass: ' + flag)
    preferences = ('font', 'largeText', 'reducedMotion', 'lowEffects')
    for label in ('baseline', 'changed', 'restored'):
        value = checks.get(label)
        require(isinstance(value, dict) and set(value) == set(preferences)
                and value['font'] in ('Inter', 'Nunito')
                and all(type(value[key]) is bool for key in preferences[1:]),
                'Invalid Settings preferences: ' + label)
    baseline, changed = checks['baseline'], checks['changed']
    require(checks['restored'] == baseline and changed['font'] != baseline['font']
            and all(changed[key] is not baseline[key] for key in preferences[1:]),
            'Settings controls did not change and restore all preferences')
    names = ('opened', 'changed', 'restored', 'closed', 'reopened', 'doneClosed')
    observations = checks.get('observations')
    require(isinstance(observations, dict) and set(observations) == set(names),
            'Settings observation set differs')
    sequence = [checks.get('baselineObservation'), *[observations[name] for name in names]]
    last_sequence = 0
    for index, state in enumerate(sequence):
        require(isinstance(state, dict) and state in states
                and type(state.get('sequence')) is int and state['sequence'] > last_sequence
                and state.get('section') == 'Files' and state.get('messageboxMapped') is False,
                'Settings observation is absent, out of order, or outside the public Files view')
        opened = index in (1, 2, 3, 5)
        expected_preferences = changed if index == 2 else baseline
        require(state.get('settingsOpen') is opened and state.get('idle') is (not opened)
                and state.get('displayPreferences') == expected_preferences,
                'Settings observation state or preferences differ')
        last_sequence = state['sequence']
    click = checks.get('pointerClick')
    require(isinstance(click, dict), 'Settings pointer click evidence missing')
    bounds = click.get('bounds')
    width, height = click.get('desktopWidth'), click.get('desktopHeight')
    require(isinstance(bounds, list) and len(bounds) == 4
            and all(type(value) is int for value in bounds)
            and type(width) is int and type(height) is int and width > 1 and height > 1
            and [width, height] == [report['desktop']['width'], report['desktop']['height']]
            and bounds == sequence[0].get('settingsButtonBounds'),
            'Settings click is not bound to the observed button')
    x, y, button_width, button_height = bounds
    require(x >= 0 and y >= 0 and button_width > 0 and button_height > 0
            and x + button_width <= width and y + button_height <= height,
            'Settings button bounds extend outside the desktop')
    center = click.get('center')
    absolute = click.get('qmpAbsolute')
    require(isinstance(center, list) and len(center) == 2
            and all(type(value) in (int, float) for value in center)
            and x <= center[0] < x + button_width and y <= center[1] < y + button_height
            and isinstance(absolute, list) and len(absolute) == 2
            and all(type(value) is int and 0 <= value <= 32767 for value in absolute)
            and all(abs(actual - pixel * 32767 / (dimension - 1)) <= 1
                    for actual, pixel, dimension in zip(absolute, center, (width, height))),
            'Settings QMP pointer coordinates differ from the observed button')
    chosen_index = 2 if baseline['font'] == 'Inter' else 1
    original_index = 1 if baseline['font'] == 'Inter' else 2
    keys = ([['tab']] * chosen_index + [['ret']] + [['tab']] * (3 - chosen_index)
            + [['spc'], ['tab'], ['spc'], ['tab'], ['spc']]
            + [['spc'], ['shift', 'tab'], ['spc'], ['shift', 'tab'], ['spc']]
            + [['shift', 'tab']] * (3 - original_index)
            + [['ret'], ['esc'], ['ret'], ['ret']])
    expected_inputs = [{'kind': 'pointer-click', 'target': 'Settings', **click}]
    expected_inputs += [{'kind': 'keys', 'qcodes': value} for value in keys]
    require(checks.get('inputs') == expected_inputs, 'Settings input trace differs from bounded display controls')
    return {'interactionStatesVerified': True, 'initialButtonClickBoundsVerified': True,
            'boundedInputTraceVerified': True,
            'baseline': baseline, 'changed': changed, 'restored': checks['restored'],
            'observationSequences': [state['sequence'] for state in sequence],
            'visualReviewPassed': False, 'persistentSettingsWritten': False}


def sha_range(path, offset, length):
    digest = hashlib.sha256()
    with Path(path).open('rb') as handle:
        handle.seek(offset)
        while length:
            block = handle.read(min(length, 1048576))
            require(bool(block), 'Truncated protected extent')
            digest.update(block)
            length -= len(block)
    return digest.hexdigest()


def fat_entries(path, offset=0):
    locator = str(path) + ('@@' + str(offset) if offset else '')
    result = subprocess.run(['/usr/bin/mdir', '-b', '-i', locator, '-/', '::'],
                            check=True, capture_output=True, text=True, timeout=15)
    require(len(result.stdout) <= 8192 and not result.stderr, 'Unexpected FAT inspection output')
    return result.stdout.splitlines()


def media_hashes(path, exchange_start, exchange_end, source_bytes):
    """One read pass over a potentially large sparse disposable image."""
    size = path.stat().st_size
    ranges = {'prefix': (0, exchange_start), 'suffix': (exchange_end, size),
              'sourceSuffix': (exchange_end, source_bytes), 'appendedTail': (source_bytes, size)}
    digests = {name: hashlib.sha256() for name in ('whole', *ranges)}
    tail_zero = True
    position = 0
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(8 * 1024 * 1024), b''):
            digests['whole'].update(block)
            for name, (start, end) in ranges.items():
                left, right = max(position, start), min(position + len(block), end)
                if left < right:
                    segment = block[left - position:right - position]
                    digests[name].update(segment)
                    if name == 'appendedTail' and segment.count(0) != len(segment):
                        tail_zero = False
            position += len(block)
    require(position == size, 'Disposable image changed size while hashing')
    return {**{name: digest.hexdigest() for name, digest in digests.items()}, 'appendedTailAllZero': tail_zero}


def single_usb_source(image, iso, build, distribution):
    path = image / 'single-usb-build.json'
    require(not path.is_symlink() and path.is_file() and path.stat().st_size <= 65536,
            'Bounded regular single-USB manifest required')
    manifest = json.loads(path.read_text())
    require(manifest['kind'] == 'drivekey-single-usb-candidate-distribution'
            and manifest['imageId'] == build['imageId']
            and manifest['bootLayout'] == build['bootLayout'] == distribution['bootLayout'] == BOOT_LAYOUT
            and manifest['sources'] == build['sources'], 'Single-USB manifest identity differs')
    require(manifest['fundingReady'] is False and manifest['productionReady'] is False
            and manifest['originalISOModified'] is False, 'Single-USB release or source claim differs')
    require(Path(manifest['imageName']).name == manifest['imageName']
            and manifest['imageName'].endswith('-single-usb.img'), 'Invalid single-USB image basename')
    source = image / manifest['imageName']
    require(not source.is_symlink() and source.is_file()
            and source.stat().st_size == manifest['bytes'] == BOOT_LAYOUT['diskImageBytes']
            and sha(source) == manifest['sha256'], 'Exact single-USB source image differs')
    require(manifest['sourceISO'] == {'name': iso.name, 'sha256': distribution['sha256'],
                                    'bytes': distribution['bytes']}, 'Single-USB original ISO differs')
    exchange = manifest['exchange']
    offset, length = exchange['offsetBytes'], exchange['lengthBytes']
    end = offset + length
    require(offset == manifest['protectedPrefixBytes'] == BOOT_LAYOUT['exchangeStartBytes']
            and length == BOOT_LAYOUT['exchangeLengthBytes'] and exchange['partitionNumber'] == 5
            and exchange['label'] == 'DRIVEKEY'
            and re.fullmatch(r'[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}', exchange['uuid']), 'Single-USB FAT geometry differs')
    require(sha_range(source, 0, offset) == manifest['protectedPrefixSha256']
            and sha_range(source, end, source.stat().st_size - end) == manifest['protectedSuffixSha256'],
            'Single-USB protected hashes differ')
    payload_offset = manifest['isoPayloadPreservedFromByte']
    require(payload_offset == 32768 and payload_offset < distribution['bytes'] <= offset
            and sha_range(source, payload_offset, distribution['bytes'] - payload_offset)
            == sha_range(iso, payload_offset, distribution['bytes'] - payload_offset), 'Original ISO payload differs')
    subprocess.run(['/usr/sbin/sfdisk', '--verify', str(source)], check=True, capture_output=True, text=True, timeout=15)
    parsed = subprocess.run(['/usr/sbin/sfdisk', '--json', str(source)], check=True, capture_output=True, text=True, timeout=15)
    require(len(parsed.stdout) <= 65536, 'Partition table evidence too large')
    table = json.loads(parsed.stdout)['partitiontable']
    require(table['label'] == 'gpt' and table['unit'] == 'sectors' and table['sectorsize'] == 512, 'Unexpected GPT units')
    partitions = table['partitions']
    require(len(partitions) == 5 and [entry['node'] for entry in partitions] == [str(source) + str(i) for i in range(1, 6)],
            'Unexpected GPT partition set')
    selected = partitions[4]
    require(selected['start'] * 512 == offset and selected['size'] * 512 == length
            and selected['type'].lower() == 'ebd0a0a2-b9e5-4433-87c0-68b6b72699c7', 'GPT data extent/type differs')
    require(all((entry['start'] + entry['size']) * 512 <= offset for entry in partitions[:4]), 'Boot partition overlaps exchange')
    probe = subprocess.run(['/usr/sbin/blkid', '-p', '-o', 'export', '-O', str(offset), '-S', str(length), str(source)],
                           check=True, capture_output=True, text=True, timeout=15)
    require(len(probe.stdout) <= 8192, 'FAT identity output too large')
    metadata = dict(line.split('=', 1) for line in probe.stdout.splitlines() if '=' in line)
    require(metadata.get('TYPE') == 'vfat' and metadata.get('LABEL') == exchange['label']
            and metadata.get('UUID', '').upper() == exchange['uuid'].upper(), 'FAT UUID or label differs')
    require(fat_entries(source, offset) == [] and sha(source) == manifest['sha256'], 'Source FAT not empty or source changed')
    return {'manifest': manifest, 'manifestPath': path, 'manifestSha256': sha(path), 'source': source, 'partitionTable': table}


def audit_run(project, folder, iso, distribution, current_runner_sha, single_layout=None,
              settings_required=False):
    require(folder.is_relative_to(project / 'outputs'), 'Report is outside project outputs')
    result_path = folder / 'result.json'
    report = json.loads(result_path.read_text())
    args = json.loads((folder / 'qemu-argv.json').read_text())
    mode = report.get('firmwareMode', report['bootMode'])
    require(mode in ('bios', 'uefi'), 'Unsupported firmware mode')
    medium = report.get('bootMedium', 'cdrom')
    require(medium in ('cdrom', 'usb-storage'), 'Unsupported boot medium')
    single_usb = report.get('singleUSB', False)
    require(type(single_usb) is bool, 'Invalid single-USB report flag')
    if single_usb:
        require(single_layout is not None and medium == 'usb-storage'
                and report.get('storageDeviceCount') == 1 and report.get('bootSourceReadOnly') is False
                and report.get('sourceImageUnchanged') is True, 'Invalid single-USB isolation evidence')
    require(report['kind'] == 'drivekey-interactive-boot-smoke', 'Unexpected report kind')
    require(report['iso'] == str(iso) and report['isoSha256'] == distribution['sha256'], 'Report ISO differs')
    for key in ('success', 'processStopped', 'hostPolicyUnchanged', 'isoUnchanged',
                'pickerDisplayed', 'explicitUSBSelection', 'actualDesktopDisplayed',
                'shutdownRequestedThroughUI', 'emptyDisposableUSB'):
        require(report.get(key) is True, 'Smoke check did not pass: ' + key)
    policy_before, policy_after = report.get('hostPolicyBefore'), report.get('hostPolicyAfter')
    policy_configuration_checked = False
    if isinstance(policy_before, dict) and 'configuration' in policy_before:
        require(isinstance(policy_after, dict) and isinstance(policy_after.get('configuration'), dict)
                and isinstance(policy_before['configuration'], dict)
                and set(policy_before['configuration']) == {'swaps', 'corePattern', 'modulesDisabled'}
                and policy_before['configuration'] == policy_after['configuration'],
                'Recorded stable host policy changed')
        policy_configuration_checked = True
    for key in ('fundingReady', 'productionReady', 'physicalHardwareTested', 'nic', 'hostShares'):
        require(report.get(key) is False, 'Unexpected readiness or exposure: ' + key)
    for key in ('walletsCreated', 'signaturesProduced', 'transactionsSubmitted', 'qemuExitCode'):
        require(report.get(key) == 0, 'Unexpected operation count or exit: ' + key)
    settle = report.get('captureSettleSeconds')
    if settle is not None:
        require(type(settle) in (int, float) and 1.5 <= settle <= 30, 'Invalid capture settle interval')
    work = Path(report['work'])
    require(work.parent == Path('/var/tmp') and work.name.startswith('drivekey-interactive-smoke-')
            and work.resolve(strict=True) == work, 'Invalid disposable work directory')
    media = work / ('single-boot-exchange.img' if single_usb else 'empty-exchange.img')
    expected_bytes = report['singleUSBImage']['emulatedCapacityBytes'] if single_usb else 64 * 1024 * 1024
    if single_usb:
        require(expected_bytes in (BOOT_LAYOUT['diskImageBytes'], 31037849600), 'Unexpected emulated USB capacity')
    require(not media.is_symlink() and media.is_file() and media.stat().st_size == expected_bytes,
            'Disposable media is not the expected regular image')
    rtc = next((args[index + 1] for index, value in enumerate(args[:-1]) if value == '-rtc'), '')
    require(re.fullmatch(r'base=[0-9]{4}(?:-[0-9]{2}){2}T[0-9]{2}(?::[0-9]{2}){2},clock=rt', rtc), 'Unexpected RTC argument')
    accelerator = report['accelerator']
    require(accelerator in ('tcg', 'kvm'), 'Unsupported accelerator')
    expected = ['/usr/bin/qemu-system-x86_64', '-machine', 'q35,accel=' + accelerator,
                '-cpu', 'host' if accelerator == 'kvm' else 'max', '-m', '3072', '-smp', '2',
                '-nodefaults', '-nic', 'none', '-display', 'none', '-device', 'VGA',
                '-serial', 'file:' + str(work / 'serial.log'),
                '-qmp', 'unix:' + str(work / 'qmp.sock') + ',server=on,wait=off',
                '-no-reboot', '-device', 'qemu-xhci', '-device', 'usb-tablet', '-device', 'usb-kbd',
                '-device', 'virtio-rng-pci', '-rtc', rtc]
    if medium == 'cdrom':
        expected += ['-cdrom', str(iso), '-boot', 'order=d']
    else:
        boot_path = media if single_usb else iso
        expected += ['-drive', 'if=none,id=bootiso,format=raw,readonly=' + ('off' if single_usb else 'on') + ',file=' + str(boot_path).replace(',', ',,'),
                     '-device', 'usb-storage,id=boot-usb,drive=bootiso,removable=on,bootindex=1',
                     '-boot', 'strict=on']
        require(report.get('bootSourceReadOnly') is (not single_usb), 'USB boot writable scope differs')
    if not single_usb:
        expected += ['-drive', 'if=none,id=exchange,format=raw,file=' + str(media),
                     '-device', 'usb-storage,drive=exchange,removable=on']
    if mode == 'uefi':
        expected += ['-drive', 'if=pflash,format=raw,readonly=on,file=/usr/share/OVMF/OVMF_CODE_4M.fd',
                     '-drive', 'if=pflash,format=raw,file=' + str(work / 'fresh-vars.fd')]
        firmware = report['firmware']
        require(sha('/usr/share/OVMF/OVMF_CODE_4M.fd') == firmware['codeSha256']
                and sha('/usr/share/OVMF/OVMF_VARS_4M.fd') == firmware['initialVariablesSha256']
                and firmware['secureBootEnforced'] is False, 'Firmware evidence differs')
    else:
        require(report['firmware'] is None, 'Unexpected BIOS firmware override')
    require(args == expected, 'QEMU arguments differ from isolated smoke configuration')
    require((folder / 'serial.log').stat().st_size <= 2 * 1024 * 1024, 'Serial evidence too large')
    serial = (folder / 'serial.log').read_text(errors='replace')
    require(sha(folder / 'serial.log') == report['serialSha256'] == sha(work / 'serial.log'), 'Serial evidence differs')
    require(not (folder / 'qemu-stderr.log').read_bytes() and not (work / 'qemu-stderr.log').read_bytes(), 'QEMU stderr requires review')
    require('DRIVEKEY_INTERACTIVE_FAILURE' not in serial and 'DRIVEKEY_INTERACTIVE_EARLY_FAILURE' not in serial, 'Guest failure marker found')
    require(('efi: EFI ' in serial) == (mode == 'uefi'), 'Observed firmware mode differs')
    desktop = report['desktop']
    require(records(serial, 'DRIVEKEY_INTERACTIVE_DESKTOP_READY') == [desktop]
            and desktop['uid'] == 1000 and desktop['imageId'] == distribution['imageId']
            and desktop['width'] > 0 and desktop['height'] > 0
            and desktop['fundingReady'] is False and desktop['productionReady'] is False, 'Desktop identity differs')
    states = records(serial, 'DRIVEKEY_INTERACTIVE_VIEW_STATE')
    settings_evidence = audit_settings(report, states) if settings_required else None
    require(settings_required or 'settingsChecks' not in report,
            'Settings evidence requires the exact Settings module in the image source set')
    sections = ('Home', 'Wallet', 'Send', 'Swap', 'Receive', 'Files')
    require(all(any(state.get('section') == section and state.get('idle') is True for state in states)
                for section in sections), 'Missing idle section evidence')
    require(any(state.get('messageboxMapped') is True for state in states), 'Shutdown confirmation was not mapped')
    for marker in ('DRIVEKEY_STORAGE_PICKER_READY', 'DRIVEKEY_INTERACTIVE_EXCHANGE_SELECTED', 'DRIVEKEY_INTERACTIVE_SHUTDOWN_CONFIRMATION'):
        require(serial.count(marker) == 1, 'Missing or duplicated marker: ' + marker)
    shutdown = {'childrenReaped': True, 'exitCode': 0, 'syncExitCode': 0, 'unmountExitCode': 0,
                'exchangeStillMounted': False, 'shutdownPassed': True}
    require(records(serial, 'DRIVEKEY_INTERACTIVE_SHUTDOWN') == [shutdown] and report['shutdown'] == shutdown, 'Shutdown evidence differs')
    names = ['exchange-picker', *[section.lower() for section in sections]]
    if settings_required:
        names += ['settings-open', 'settings-changed', 'settings-restored',
                  'settings-closed', 'settings-reopened']
    names += ['shutdown-confirmation']
    require([shot['name'] for shot in report['screenshots']] == names, 'Unexpected screenshot set')
    for shot in report['screenshots']:
        require(Path(shot['path']).name == shot['path'] and sha(folder / shot['path']) == shot['sha256']
                and shot['publicEmptyWalletOnly'] is True, 'Screenshot hash or scope differs')
    offset = BOOT_LAYOUT['exchangeStartBytes'] if single_usb else 0
    listing = fat_entries(media, offset)
    hashes = media_hashes(media, offset, offset + BOOT_LAYOUT['exchangeLengthBytes'], BOOT_LAYOUT['diskImageBytes']) if single_usb else None
    media_sha = hashes['whole'] if single_usb else sha(media)
    require(listing == ['::/DriveKey/'] and media_sha == report['finalDisposableMediaSha256'],
            'Disposable media contains unexpected files or changed during inspection')
    single_evidence = None
    if single_usb:
        detail, manifest = report['singleUSBImage'], single_layout['manifest']
        require(detail['source'] == str(single_layout['source'])
                and detail['sourceManifest'] == str(single_layout['manifestPath'])
                and detail['manifestSha256'] == single_layout['manifestSha256']
                and detail['sourceSha256'] == manifest['sha256']
                and detail['initialWholeImageSha256'] == report['initialEmptyMediaSha256']
                and re.fullmatch(r'[0-9a-f]{64}', detail['initialWholeImageSha256'])
                and detail['sourceISO'] == manifest['sourceISO'] and detail['disposableCopy'] == str(media)
                and detail['sourceBytes'] == manifest['bytes']
                and detail['bytes'] == detail['emulatedCapacityBytes'] == media.stat().st_size
                and detail['exchange'] == manifest['exchange']
                and detail['partitionTableMutations'] == manifest['partitionTableMutations']
                and detail['initialPartitionTable'] == single_layout['partitionTable']
                and detail['initialFATEntries'] == [] and detail['finalFATEntries'] == listing
                and detail['finalWholeImageSha256'] == media_sha, 'Single-USB copy evidence differs')
        for key in ('partitionLayoutInitializedBeforeBoot', 'allBytesOutsideFATUnchanged',
                    'FATContainsOnlyDriveKeyDirectory', 'readOnlyFATInspectionLeftImageUnchanged'):
            require(detail.get(key) is True, 'Single-USB check failed: ' + key)
        require(detail['largerPhysicalMediaLayoutValidated'] is False, 'Unexpected physical-media acceptance')
        prefix, suffix = hashes['prefix'], hashes['suffix']
        require(detail['protectedPrefixBytes'] == offset
                and prefix == detail['initialProtectedPrefixSha256'] == detail['finalProtectedPrefixSha256'] == manifest['protectedPrefixSha256']
                and suffix == detail['initialProtectedSuffixSha256'] == detail['finalProtectedSuffixSha256']
                and hashes['sourceSuffix'] == detail['sourceProtectedSuffixSha256'] == manifest['protectedSuffixSha256'],
                'Bytes outside writable FAT changed')
        expansion = detail['capacityExpansion']
        added = media.stat().st_size - manifest['bytes']
        require(expansion['applied'] is (added > 0) and expansion['sourceBytes'] == manifest['bytes']
                and expansion['emulatedCapacityBytes'] == media.stat().st_size
                and expansion['appendedBytes'] == added and expansion['initialAppendedTailAllZero'] is True
                and expansion['firstSourceExtentMatchesSourceImage'] is True
                and expansion['partitionResizePerformed'] is False and expansion['GPTRepairPerformed'] is False
                and expansion['physicalDiskTouched'] is False and hashes['appendedTailAllZero'] is True,
                'Disposable capacity expansion scope differs')
        if added:
            require(expansion['initialAppendedTailSha256'] == hashes['appendedTail'], 'Expanded zero tail changed')
        else:
            require(expansion['initialAppendedTailSha256'] is None
                    and detail['initialWholeImageSha256'] == manifest['sha256'], 'Unexpanded initial copy differs')
        single_evidence = {'sourceImage': str(single_layout['source'].relative_to(project)),
                           'sourceImageSha256': manifest['sha256'], 'sourceManifestSha256': single_layout['manifestSha256'],
                           'disposableCopy': str(media), 'initialWholeImageSha256': detail['initialWholeImageSha256'],
                           'finalWholeImageSha256': media_sha, 'protectedPrefixSha256': prefix, 'protectedSuffixSha256': suffix,
                           'exchange': manifest['exchange'], 'allBytesOutsideFATUnchanged': True,
                           'sourceImageUnchanged': True, 'emulatedCapacityBytes': media.stat().st_size,
                           'capacityExpansion': expansion, 'expandedTailVerifiedZero': hashes['appendedTailAllZero'],
                           'largerPhysicalMediaLayoutValidated': False}
    for proc in Path('/proc').iterdir():
        if not proc.name.isdecimal():
            continue
        try:
            command = (proc / 'cmdline').read_bytes().split(b'\0')
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue
        require(not (command and Path(os.fsdecode(command[0])).name == 'qemu-system-x86_64'
                     and any(str(work).encode() in argument for argument in command)), 'Smoke QEMU still running')
    return {'report': str(result_path.relative_to(project)), 'reportSha256': sha(result_path),
            'firmwareMode': mode, 'bootMedium': medium, 'qemuArgvSha256': sha(folder / 'qemu-argv.json'),
            'singleUSB': single_usb, 'singleUSBImage': single_evidence,
            'serialSha256': report['serialSha256'], 'qemuStderrEmpty': True, 'qemuExitCode': 0,
            'matchingQemuProcessAbsentAtAudit': True, 'desktopAndShutdownMarkersMatch': True,
            'recordedStableHostPolicyCompared': policy_configuration_checked,
            'settingsInteractionVerified': settings_evidence,
            'screenshotHashesVerified': len(names), 'visualReviewPassed': False,
            'captureSettleSeconds': settle,
            'recordedRunnerSha256': report['runnerSha256'],
            'currentRunnerHashMatches': report['runnerSha256'] == current_runner_sha,
            'finalDisposableMediaSha256': media_sha, 'mdirReadOnlyEntries': listing,
            'mediaUnchangedByReadOnlyInspection': True, 'walletAndTransactionFilesPresent': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image_directory')
    parser.add_argument('report_directories', nargs='+')
    parser.add_argument('--output-name', default='interactive-smoke-evidence-audit.json')
    arguments = parser.parse_args()
    require(sys.platform == 'linux' and 1 <= len(arguments.report_directories) <= 4,
            'Linux and one to four completed report directories required')
    require(re.fullmatch(r'[a-z0-9][a-z0-9._-]{0,95}\.json', arguments.output_name),
            'Output name must be a simple lowercase JSON basename')
    project = Path(__file__).resolve().parents[1]
    image = Path(arguments.image_directory).resolve(strict=True)
    require(image.is_relative_to(project / 'outputs/security-interactive-images'), 'Unexpected image directory')
    target = image / arguments.output_name
    require(not target.exists(), 'Audit already exists; never overwrite evidence')
    build = json.loads((image / 'image-build.json').read_text())
    distribution = json.loads((image / 'distribution-build.json').read_text())
    require(build['kind'] == 'drivekey-unreleased-interactive-candidate-image'
            and distribution['kind'] == 'drivekey-unsigned-interactive-candidate-distribution'
            and build['imageId'] == distribution['imageId'] == image.name, 'Image identity differs')
    for record in (build, distribution):
        require(record['fundingReady'] is False and record['productionReady'] is False, 'Unexpected release readiness')
    sources = {'scripts/build-security-interactive-image.py', 'scripts/build-security-interactive-distribution.py',
               'scripts/security-interactive-image-init.py', 'scripts/security-interactive-storage.py',
               'scripts/security-interactive-desktop.py'}
    if 'bootLayout' in build:
        require(build['bootLayout'] == distribution['bootLayout'] == BOOT_LAYOUT, 'Immutable boot geometry differs')
        sources.add('scripts/build-security-single-usb.py')
    settings_required = 'scripts/security-interactive-settings.py' in build['sources']
    if settings_required:
        sources.add('scripts/security-interactive-settings.py')
    require(set(build['sources']) == sources and build['sources'] == distribution['sources'], 'Source set differs')
    for name, expected in build['sources'].items():
        require(sha(project / name) == expected, 'Current image source differs: ' + name)
    artifacts = {'vmlinuz', 'initramfs.cpio.gz', 'rootfs.squashfs', 'image-contents.json'}
    require(set(build['artifacts']) == artifacts and build['artifacts'] == distribution['sourceArtifacts'], 'Artifact set differs')
    for name, record in build['artifacts'].items():
        require(sha(image / name) == record['sha256'] and (image / name).stat().st_size == record['bytes'], 'Image artifact differs: ' + name)
    require(Path(distribution['isoName']).name == distribution['isoName'], 'Invalid ISO basename')
    iso = image / distribution['isoName']
    require(not iso.is_symlink() and iso.is_file() and sha(iso) == distribution['sha256']
            and iso.stat().st_size == distribution['bytes'], 'Exact ISO differs')
    runner_sha = sha(project / 'scripts/run-security-interactive-smoke.py')
    folders = [Path(value).resolve(strict=True) for value in arguments.report_directories]
    require(len(set(folders)) == len(folders), 'Duplicate report directory')
    needs_single = any(json.loads((folder / 'result.json').read_text()).get('singleUSB') is True for folder in folders)
    single_layout = single_usb_source(image, iso, build, distribution) if needs_single else None
    runs = [audit_run(project, folder, iso, distribution, runner_sha, single_layout, settings_required)
            for folder in folders]
    audit = {'kind': 'drivekey-interactive-smoke-evidence-audit',
             'auditedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'evidenceConsistent': True,
             'imageId': image.name, 'iso': iso.name, 'isoSha256': distribution['sha256'], 'isoBytes': distribution['bytes'],
             'auditorSha256': sha(__file__), 'currentRunnerSha256': runner_sha,
             'imageBuildSha256': sha(image / 'image-build.json'),
             'distributionBuildSha256': sha(image / 'distribution-build.json'),
             'sourcesVerified': build['sources'], 'artifactsVerified': build['artifacts'], 'runs': runs,
             'singleUSBManifestSha256': single_layout['manifestSha256'] if single_layout else None,
             'scope': 'Read-only consistency audit of completed isolated interactive smoke evidence; no VM started or mounted.',
             'limitations': ['Screenshot hashes and UI state markers do not establish visual acceptance.',
                             'No full transaction, signing, physical hardware or funded-release acceptance is established.',
                             'Historical host-policy and zero-operation counters are runner reports; the audit separately checks current media and process state.',
                             'A differing current runner hash does not reverify its historical source; the recorded run hash remains explicit.',
                             'Source distribution acceptance fields and release gates are not modified.'],
             'visualReviewPassed': False, 'fullTransactionAcceptance': False, 'physicalHardwareValidated': False,
             'secureBootAuthenticated': False, 'fundingReady': False, 'productionReady': False}
    with target.open('x') as handle:
        json.dump(audit, handle, indent=2)
        handle.write('\n')
    print(json.dumps({'audit': str(target), 'sha256': sha(target), 'runs': len(runs), 'evidenceConsistent': True,
                      'visualReviewPassed': False, 'fullTransactionAcceptance': False}))


if __name__ == '__main__':
    main()
