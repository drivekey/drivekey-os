#!/usr/bin/python3
"""Boot an exact interactive ISO or one-USB image using disposable media only.

Only QMP keyboard/pointer input and public screenshots are used. No guest shell, shared
folder, NIC, real wallet, generated key, or external transaction is involved.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from zoneinfo import ZoneInfo


def sha(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def open_settings_when_idle(read_view, click, guest_running, timeout=120):
    """Wait through protected refreshes; never click an observed open panel."""
    deadline = time.monotonic() + timeout
    last_clicked_sequence = -1
    while time.monotonic() < deadline:
        current = read_view()
        if current and current.get('settingsOpen') is True:
            return current
        if not guest_running():
            raise RuntimeError('Guest stopped before opening Settings')
        if current and current.get('idle') is True and current.get('settingsOpen') is False:
            sequence = current.get('sequence')
            require(type(sequence) is int, 'Settings retry lacks observed sequence')
            if sequence > last_clicked_sequence:
                click(current)
                last_clicked_sequence = sequence
        time.sleep(1)
    raise TimeoutError('Settings did not open within the bounded pointer retry')


def host_policy_snapshot(proc=Path('/proc')):
    """Separate stable host swap policy from naturally changing memory use."""
    rows = (proc / 'swaps').read_text().splitlines()
    require(bool(rows) and rows[0].split() == ['Filename', 'Type', 'Size', 'Used', 'Priority'],
            'Unexpected host swap status format')
    configured, usage = [], []
    for row in rows[1:]:
        fields = row.split()
        require(len(fields) == 5 and fields[2].isdigit() and fields[3].isdigit(),
                'Unexpected host swap entry')
        configured.append({'device': fields[0], 'type': fields[1],
                           'sizeKiB': int(fields[2]), 'priority': int(fields[4])})
        usage.append({'device': fields[0], 'usedKiB': int(fields[3])})
    return {'configuration': {
        'swaps': configured,
        'corePattern': (proc / 'sys/kernel/core_pattern').read_text(),
        'modulesDisabled': (proc / 'sys/kernel/modules_disabled').read_text()},
        'swapUsageObservation': usage}


def sha_range(path, offset, length):
    value = hashlib.sha256()
    with Path(path).open('rb') as handle:
        handle.seek(offset)
        remaining = length
        while remaining:
            block = handle.read(min(remaining, 1024 * 1024))
            require(bool(block), 'Protected image range is truncated')
            value.update(block)
            remaining -= len(block)
    return value.hexdigest()


def zero_tail_sha(path, offset, length):
    """Verify a newly appended sparse extent contains zeros without writing it."""
    value = hashlib.sha256()
    zeros = bytes(1024 * 1024)
    with Path(path).open('rb') as handle:
        handle.seek(offset)
        remaining = length
        while remaining:
            block = handle.read(min(remaining, len(zeros)))
            require(bool(block) and block == zeros[:len(block)], 'Expanded image tail is not zero')
            value.update(block)
            remaining -= len(block)
    return value.hexdigest()


def fat_entries(media, offset=0):
    image = str(media) + ('@@' + str(offset) if offset else '')
    result = subprocess.run(['/usr/bin/mdir', '-b', '-i', image, '-/', '::'],
                            check=True, capture_output=True, text=True, timeout=15)
    require(len(result.stdout) <= 8192 and not result.stderr, 'Unexpected FAT inspection output')
    return result.stdout.splitlines()


def single_usb_layout(source):
    """Read only a completed image/manifest; never initialize or mount a disk."""
    manifest_path = source.parent / 'single-usb-build.json'
    require(not manifest_path.is_symlink() and manifest_path.is_file()
            and manifest_path.stat().st_size <= 65536, 'Bounded single-USB manifest required')
    manifest = json.loads(manifest_path.read_text())
    require(manifest.get('kind') == 'drivekey-single-usb-candidate-distribution'
            and manifest.get('fundingReady') is False
            and manifest.get('productionReady', False) is False, 'Unreleased single-USB image required')
    require(manifest['imageName'] == source.name and manifest['imageId'] == source.parent.name
            and manifest['bytes'] == source.stat().st_size == 1073741824
            and manifest['sha256'] == sha(source), 'Single-USB source identity differs')
    exchange = manifest['exchange']
    require(manifest['protectedPrefixBytes'] == exchange['offsetBytes'] == 268435456
            and exchange['lengthBytes'] == 804257792 and exchange['partitionNumber'] == 5
            and exchange['label'] == 'DRIVEKEY'
            and re.fullmatch(r'[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}', exchange['uuid']), 'Unexpected fixed exchange layout')
    offset, length = exchange['offsetBytes'], exchange['lengthBytes']
    end = offset + length
    prefix = sha_range(source, 0, offset)
    suffix = sha_range(source, end, source.stat().st_size - end)
    require(prefix == manifest['protectedPrefixSha256']
            and suffix == manifest['protectedSuffixSha256'], 'Initialized protected image ranges differ')
    table_result = subprocess.run(['/usr/sbin/sfdisk', '--json', str(source)],
                                  check=True, capture_output=True, text=True, timeout=15)
    require(len(table_result.stdout) <= 65536, 'Partition table output exceeds bound')
    table = json.loads(table_result.stdout)['partitiontable']
    require(table.get('label') == 'gpt' and table.get('unit') == 'sectors'
            and table.get('sectorsize') == 512, 'Expected initialized 512-byte-sector GPT')
    partitions = table['partitions']
    selected = [entry for entry in partitions if entry['node'] == str(source) + '5']
    require(len(selected) == 1 and selected[0]['start'] * 512 == offset
            and selected[0]['size'] * 512 == length
            and selected[0]['type'].lower() == 'ebd0a0a2-b9e5-4433-87c0-68b6b72699c7', 'Exchange GPT extent/type differs')
    for entry in partitions:
        if entry is selected[0]:
            continue
        require(entry['start'] * 512 + entry['size'] * 512 <= offset,
                'Another GPT partition overlaps the exchange or protected tail')
    probed = subprocess.run(['/usr/sbin/blkid', '-p', '-o', 'export', '-O', str(offset),
                             '-S', str(length), str(source)], check=True, capture_output=True,
                            text=True, timeout=15)
    require(len(probed.stdout) <= 8192, 'Filesystem metadata output exceeds bound')
    metadata = dict(line.split('=', 1) for line in probed.stdout.splitlines() if '=' in line)
    require(metadata.get('TYPE') == 'vfat' and metadata.get('LABEL') == exchange['label']
            and metadata.get('UUID', '').upper() == exchange['uuid'].upper(), 'Exchange FAT identity differs')
    initial_entries = fat_entries(source, offset)
    require(initial_entries == [] and sha(source) == manifest['sha256'],
            'Single-USB exchange is not empty or changed during read-only inspection')
    original = manifest['sourceISO']
    require(Path(original['name']).name == original['name'] and original['name'].endswith('.iso'),
            'Invalid original ISO basename')
    iso = source.parent / original['name']
    require(not iso.is_symlink() and iso.is_file() and iso.stat().st_size == original['bytes']
            and original['bytes'] <= offset and sha(iso) == original['sha256'], 'Original ISO identity differs')
    return {'manifest': manifest, 'manifestSha256': sha(manifest_path), 'iso': iso,
            'initialEntries': initial_entries, 'protectedPrefixSha256': prefix,
            'protectedSuffixSha256': suffix, 'partitionTable': table}


def boot_source_args(source, boot_medium, writable=False):
    if boot_medium == 'cdrom':
        return ['-cdrom', str(source), '-boot', 'order=d']
    if boot_medium == 'usb-storage':
        # The ISO is the raw hybrid disk itself; never copy it onto a host disk.
        # QEMU option values escape commas by doubling them.
        filename = str(source).replace(',', ',,')
        return ['-drive', 'if=none,id=bootiso,format=raw,readonly=' + ('off' if writable else 'on') + ',file=' + filename,
                '-device', 'usb-storage,id=boot-usb,drive=bootiso,removable=on,bootindex=1',
                '-boot', 'strict=on']
    raise ValueError('Unsupported boot medium')


def main():
    modes = ('bios', 'uefi', 'usb-bios', 'usb-uefi', 'single-usb-bios', 'single-usb-uefi')
    if sys.platform != 'linux' or len(sys.argv) not in (3, 4, 5) or sys.argv[2] not in modes:
        raise ValueError('Usage: python3 run-security-interactive-smoke.py ISO_OR_IMG ' + '|'.join(modes)
                         + ' [capture-settle-seconds] [single-usb-guest-capacity-bytes]')
    mode = sys.argv[2]
    single_usb = mode.startswith('single-usb-')
    require(len(sys.argv) != 5 or single_usb, 'Capacity override is only available for a single-USB image')
    settle_seconds = float(sys.argv[3]) if len(sys.argv) >= 4 else 8 if single_usb else 1.5
    guest_capacity = int(sys.argv[4]) if len(sys.argv) == 5 and sys.argv[4].isdecimal() else 1073741824
    if len(sys.argv) == 5:
        require(sys.argv[4].isdecimal() and guest_capacity in (1073741824, 31037849600),
                'Only the image capacity or the explicitly tested 31037849600-byte capacity is allowed')
    if not 1.5 <= settle_seconds <= 30:
        raise ValueError('Capture settling must be between 1.5 and 30 seconds')
    source = Path(sys.argv[1])
    if source.is_symlink() or not source.is_file() or source.suffix != ('.img' if single_usb else '.iso'):
        raise ValueError('Regular local ISO or single-USB image required')
    source = source.resolve(strict=True)
    layout = single_usb_layout(source) if single_usb else None
    iso = layout['iso'] if layout else source
    firmware_mode = mode.removeprefix('single-usb-').removeprefix('usb-')
    boot_medium = 'usb-storage' if single_usb or mode.startswith('usb-') else 'cdrom'
    project = Path(__file__).resolve().parents[1]
    output = project / 'outputs' / f'interactive-boot-{mode}-{time.time_ns() // 1000000}'
    output.mkdir()
    work = Path(tempfile.mkdtemp(prefix='drivekey-interactive-smoke-', dir='/var/tmp'))
    media = work / ('single-boot-exchange.img' if single_usb else 'empty-exchange.img')
    appended_tail_hash = None
    if single_usb:
        shutil.copyfile(source, media)
        require(sha(media) == layout['manifest']['sha256'], 'Disposable image copy differs')
        if guest_capacity > source.stat().st_size:
            with media.open('r+b') as handle:
                handle.truncate(guest_capacity)
            appended_tail_hash = zero_tail_sha(media, source.stat().st_size,
                                                guest_capacity - source.stat().st_size)
            require(sha_range(media, 0, source.stat().st_size) == layout['manifest']['sha256'],
                    'Sparse extension changed the initialized source image bytes')
    else:
        with media.open('xb') as handle:
            handle.truncate(64 * 1024 * 1024)
        subprocess.run(['/usr/sbin/mkfs.vfat', '-F', '32', '-n', 'DKTEST', str(media)], check=True, capture_output=True)
    initial_media_hash = sha(media)
    initial_iso_hash = sha(iso)
    initial_source_hash = sha(source)
    host_before = host_policy_snapshot()
    accelerator = 'kvm' if os.access('/dev/kvm', os.R_OK | os.W_OK) else 'tcg'
    serial = work / 'serial.log'
    qmp_path = work / 'qmp.sock'
    rtc = datetime.datetime.now(ZoneInfo('Europe/Warsaw')).strftime('%Y-%m-%dT%H:%M:%S')
    args = ['/usr/bin/qemu-system-x86_64', '-machine', 'q35,accel=' + accelerator,
            '-cpu', 'host' if accelerator == 'kvm' else 'max', '-m', '3072', '-smp', '2',
            '-nodefaults', '-nic', 'none', '-display', 'none', '-device', 'VGA',
            '-serial', 'file:' + str(serial), '-qmp', 'unix:' + str(qmp_path) + ',server=on,wait=off',
            '-no-reboot', '-device', 'qemu-xhci', '-device', 'usb-tablet', '-device', 'usb-kbd',
            '-device', 'virtio-rng-pci', '-rtc', 'base=' + rtc + ',clock=rt']
    args += boot_source_args(media if single_usb else source, boot_medium, writable=single_usb)
    if not single_usb:
        args += ['-drive', 'if=none,id=exchange,format=raw,file=' + str(media),
                '-device', 'usb-storage,drive=exchange,removable=on']
    firmware = None
    if firmware_mode == 'uefi':
        code = Path('/usr/share/OVMF/OVMF_CODE_4M.fd')
        variables = Path('/usr/share/OVMF/OVMF_VARS_4M.fd')
        shutil.copyfile(variables, work / 'fresh-vars.fd')
        firmware = {'codeSha256': sha(code), 'initialVariablesSha256': sha(variables), 'secureBootEnforced': False}
        args += ['-drive', 'if=pflash,format=raw,readonly=on,file=' + str(code),
                 '-drive', 'if=pflash,format=raw,file=' + str(work / 'fresh-vars.fd')]
    (output / 'qemu-argv.json').write_text(json.dumps(args, indent=2) + '\n')
    report = {'kind': 'drivekey-interactive-boot-smoke', 'bootMode': firmware_mode,
              'testMode': mode, 'firmwareMode': firmware_mode, 'bootMedium': boot_medium,
              'bootSourceReadOnly': not single_usb, 'singleUSB': single_usb,
              'storageDeviceCount': 1 if single_usb else 2,
              'iso': str(iso), 'isoSha256': initial_iso_hash, 'runnerSha256': sha(__file__),
              'accelerator': accelerator, 'work': str(work), 'firmware': firmware,
              'nic': False, 'hostShares': False, 'emptyDisposableUSB': True,
              'walletsCreated': 0, 'signaturesProduced': 0, 'transactionsSubmitted': 0,
              'physicalHardwareTested': False, 'fundingReady': False, 'productionReady': False,
              'visualReviewPerformed': False, 'captureSettleSeconds': settle_seconds,
              'success': False, 'screenshots': []}
    if single_usb:
        report['singleUSBImage'] = {
            'source': str(source), 'sourceSha256': initial_source_hash,
            'sourceManifest': str(source.parent / 'single-usb-build.json'),
            'manifestSha256': layout['manifestSha256'],
            'sourceISO': layout['manifest']['sourceISO'], 'disposableCopy': str(media),
            'initialWholeImageSha256': initial_media_hash,
            'sourceBytes': source.stat().st_size,
            'bytes': media.stat().st_size, 'emulatedCapacityBytes': media.stat().st_size,
            'largerPhysicalMediaLayoutValidated': False,
            'capacityExpansion': {
                'applied': guest_capacity > source.stat().st_size,
                'sourceBytes': source.stat().st_size,
                'emulatedCapacityBytes': media.stat().st_size,
                'appendedBytes': max(0, guest_capacity - source.stat().st_size),
                'initialAppendedTailAllZero': appended_tail_hash is not None if guest_capacity > source.stat().st_size else True,
                'initialAppendedTailSha256': appended_tail_hash,
                'firstSourceExtentMatchesSourceImage': True,
                'partitionResizePerformed': False, 'GPTRepairPerformed': False,
                'physicalDiskTouched': False},
            'exchange': layout['manifest']['exchange'],
            'partitionTableMutations': layout['manifest']['partitionTableMutations'],
            'partitionLayoutInitializedBeforeBoot': True,
            'protectedPrefixBytes': layout['manifest']['protectedPrefixBytes'],
            'initialProtectedPrefixSha256': layout['protectedPrefixSha256'],
            'sourceProtectedSuffixSha256': layout['protectedSuffixSha256'],
            'initialProtectedSuffixSha256': sha_range(
                media, layout['manifest']['exchange']['offsetBytes'] + layout['manifest']['exchange']['lengthBytes'],
                media.stat().st_size - layout['manifest']['exchange']['offsetBytes'] - layout['manifest']['exchange']['lengthBytes']),
            'initialFATEntries': layout['initialEntries'],
            'initialPartitionTable': layout['partitionTable']}
    start = time.monotonic()
    qsocket = stream = None
    qemu_log = (work / 'qemu-stderr.log').open('wb')
    vm = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=qemu_log, stderr=qemu_log)

    def serial_text():
        if not serial.exists():
            return ''
        if serial.stat().st_size > 2 * 1024 * 1024:
            raise ValueError('Serial log exceeds public smoke bound')
        return serial.read_text(errors='replace')

    def wait_for(marker, timeout=300):
        until = time.monotonic() + timeout
        while time.monotonic() < until:
            content = serial_text()
            if marker in content:
                return content
            if vm.poll() is not None:
                raise RuntimeError('Guest stopped before ' + marker + ': ' + content[-2500:])
            time.sleep(.25)
        raise TimeoutError('Guest did not reach ' + marker + ': ' + serial_text()[-2500:])

    def command(name, arguments=None):
        stream.write((json.dumps({'execute': name, 'arguments': arguments or {}}) + '\n').encode())
        stream.flush()
        while True:
            reply = json.loads(stream.readline())
            if 'error' in reply:
                raise RuntimeError(reply['error'])
            if 'return' in reply:
                return reply['return']

    def keys(*names):
        command('send-key', {'keys': [{'type': 'qcode', 'data': name} for name in names], 'hold-time': 80})
        time.sleep(.35)

    def capture(name):
        from PIL import Image
        # Tk's idle event precedes the emulated display scanout. Let the visible
        # frame settle; screenshot review remains a separate acceptance step.
        time.sleep(settle_seconds)
        target = work / (name + '.ppm')
        command('screendump', {'filename': str(target)})
        final = output / (name + '.png')
        with Image.open(target) as pixels:
            pixels.save(final)
        report['screenshots'].append({'name': name, 'path': final.name, 'sha256': sha(final), 'publicEmptyWalletOnly': True})

    def view():
        matches = re.findall(r'DRIVEKEY_INTERACTIVE_VIEW_STATE (\{[^\r\n]+\})', serial_text())
        return json.loads(matches[-1]) if matches else None

    def navigate(number, section):
        until = time.monotonic() + 180
        while time.monotonic() < until:
            state = view()
            if state and state.get('idle') is True:
                if state.get('section', '').lower() == section:
                    capture(section)
                    return
                keys('alt', str(number))
            if vm.poll() is not None:
                raise RuntimeError('Guest stopped during navigation')
            time.sleep(.2)
        raise TimeoutError('Desktop did not reach idle section ' + section)

    def wait_view(predicate, description, timeout=90, after_sequence=0):
        until = time.monotonic() + timeout
        while time.monotonic() < until:
            state = view()
            if state and state.get('sequence', 0) > after_sequence and predicate(state):
                return state
            if vm.poll() is not None:
                raise RuntimeError('Guest stopped while waiting for ' + description)
            time.sleep(.1)
        raise TimeoutError('Desktop did not reach ' + description + ': ' + json.dumps(view()))

    def exercise_settings():
        baseline_state = wait_view(lambda state: state.get('idle') is True
                                  and state.get('settingsOpen') is False, 'idle Settings button')
        baseline = baseline_state['displayPreferences']
        require(set(baseline) == {'font', 'largeText', 'reducedMotion', 'lowEffects'}
                and baseline['font'] in ('Inter', 'Nunito')
                and all(type(baseline[key]) is bool for key in ('largeText', 'reducedMotion', 'lowEffects')),
                'Unexpected session preference schema')
        checks = report['settingsChecks'] = {
            'baselineObservation': baseline_state, 'baseline': dict(baseline),
            'observations': {}, 'inputs': []}
        observations = checks['observations']
        bounds = baseline_state['settingsButtonBounds']
        width, height = report['desktop']['width'], report['desktop']['height']
        require(len(bounds) == 4 and all(type(number) is int for number in bounds), 'Invalid Settings button bounds')
        x, y, w, h = bounds
        require(0 <= x < x + w <= width and 0 <= y < y + h <= height, 'Settings button outside desktop')
        center = [x + w // 2, y + h // 2]
        absolute = [round(center[0] * 32767 / (width - 1)), round(center[1] * 32767 / (height - 1))]
        checks['pointerClick'] = {'bounds': bounds, 'desktopWidth': width, 'desktopHeight': height,
                                  'center': center, 'qmpAbsolute': absolute}
        # Background refresh can become protected between telemetry and a click.
        # Retry only while observed closed and idle; still require actual opening.
        def click_settings(current):
            require(current.get('settingsButtonBounds') == bounds, 'Settings button moved before click')
            command('input-send-event', {'events': [
                {'type': 'abs', 'data': {'axis': 'x', 'value': absolute[0]}},
                {'type': 'abs', 'data': {'axis': 'y', 'value': absolute[1]}},
                {'type': 'btn', 'data': {'down': True, 'button': 'left'}}]})
            command('input-send-event', {'events': [{'type': 'btn', 'data': {'down': False, 'button': 'left'}}]})
            checks['inputs'].append({'kind': 'pointer-click', 'target': 'Settings',
                                    'observedSequence': current['sequence'], **checks['pointerClick']})
        open_settings_when_idle(view, click_settings, lambda: vm.poll() is None)
        opened = observations['opened'] = wait_view(
            lambda state: state.get('settingsOpen') is True, 'open Settings', after_sequence=baseline_state['sequence'])
        require(opened['displayPreferences'] == baseline, 'Opening Settings changed preferences')
        checks['actualButtonClicked'] = True
        capture('settings-open')

        def settings_keys(*names):
            checks['inputs'].append({'kind': 'keys', 'qcodes': list(names)})
            keys(*names)

        # The real modal starts on Done. Traverse its accessible control order.
        changed_font = 'Nunito' if baseline['font'] == 'Inter' else 'Inter'
        chosen_index = 2 if changed_font == 'Nunito' else 1
        for _ in range(chosen_index):
            settings_keys('tab')
        settings_keys('ret')
        wait_view(lambda state: state.get('settingsOpen') and state['displayPreferences']['font'] == changed_font,
                  'changed interface font', after_sequence=opened['sequence'])
        for _ in range(3 - chosen_index):
            settings_keys('tab')
        for index, key in enumerate(('largeText', 'reducedMotion', 'lowEffects')):
            if index:
                settings_keys('tab')
            settings_keys('spc')
            wait_view(lambda state, target=key: state.get('settingsOpen')
                      and state['displayPreferences'][target] is (not baseline[target]),
                      'changed ' + key, after_sequence=opened['sequence'])
        changed = observations['changed'] = wait_view(
            lambda state: state.get('settingsOpen') and state['displayPreferences'] == {
                'font': changed_font, **{key: not baseline[key] for key in ('largeText', 'reducedMotion', 'lowEffects')}},
            'all session display changes', after_sequence=opened['sequence'])
        checks['changed'] = changed['displayPreferences']
        for key, flag in (('font', 'fontChanged'), ('largeText', 'largeTextChanged'),
                          ('reducedMotion', 'reducedMotionChanged'), ('lowEffects', 'lowEffectsChanged')):
            checks[flag] = changed['displayPreferences'][key] != baseline[key]
        capture('settings-changed')

        # Reverse each change with the actual keyboard controls, preserving the
        # image's observed baseline rather than assuming a preference default.
        settings_keys('spc')
        settings_keys('shift', 'tab')
        settings_keys('spc')
        settings_keys('shift', 'tab')
        settings_keys('spc')
        original_index = 1 if baseline['font'] == 'Inter' else 2
        for _ in range(3 - original_index):
            settings_keys('shift', 'tab')
        settings_keys('ret')
        restored = observations['restored'] = wait_view(
            lambda state: state.get('settingsOpen') and state['displayPreferences'] == baseline,
            'restored display preferences', after_sequence=changed['sequence'])
        checks['restored'] = restored['displayPreferences']
        checks['defaultsRestored'] = restored['displayPreferences'] == baseline
        capture('settings-restored')
        settings_keys('esc')
        closed = observations['closed'] = wait_view(
            lambda state: state.get('idle') is True and state.get('settingsOpen') is False,
            'Escape close and focus restoration', after_sequence=restored['sequence'])
        checks['escapeClosed'] = True
        capture('settings-closed')
        wait_view(lambda state: state.get('idle') is True and state.get('settingsOpen') is False,
                  'idle after closed-panel capture')
        # Return has no explicit target: reopening proves focus returned to the
        # actual Settings button, rather than calling application code directly.
        settings_keys('ret')
        reopened = observations['reopened'] = wait_view(
            lambda state: state.get('settingsOpen') is True, 'focused Settings button reopening',
            after_sequence=closed['sequence'])
        checks['returnReopenedFocusedButton'] = True
        capture('settings-reopened')
        settings_keys('ret')
        done = observations['doneClosed'] = wait_view(
            lambda state: state.get('idle') is True and state.get('settingsOpen') is False,
            'Done close', after_sequence=reopened['sequence'])
        require(done['displayPreferences'] == baseline, 'Closing Settings changed preferences')
        checks['doneClosed'] = True
        checks['passed'] = all(checks.get(key) is True for key in (
            'actualButtonClicked', 'fontChanged', 'largeTextChanged', 'reducedMotionChanged',
            'lowEffectsChanged', 'defaultsRestored', 'escapeClosed', 'returnReopenedFocusedButton', 'doneClosed'))
        require(checks['passed'], 'Settings checks incomplete')

    try:
        wait_for('DRIVEKEY_STORAGE_PICKER_READY')
        qsocket = socket.socket(socket.AF_UNIX)
        qsocket.settimeout(15)
        qsocket.connect(str(qmp_path))
        stream = qsocket.makefile('rwb')
        json.loads(stream.readline())
        command('qmp_capabilities')
        capture('exchange-picker')
        keys('down')
        keys('ret')
        wait_for('DRIVEKEY_INTERACTIVE_EXCHANGE_SELECTED', 90)
        content = wait_for('DRIVEKEY_INTERACTIVE_DESKTOP_READY', 300)
        ready = re.findall(r'DRIVEKEY_INTERACTIVE_DESKTOP_READY (\{[^\r\n]+\})', content)
        if len(ready) != 1:
            raise RuntimeError('Invalid desktop identity marker')
        report['desktop'] = json.loads(ready[0])
        if report['desktop'].get('uid') != 1000 or report['desktop'].get('fundingReady') is not False:
            raise RuntimeError('Desktop marker differs from unprivileged candidate policy')
        for number, section in enumerate(('home', 'wallet', 'send', 'swap', 'receive', 'files'), 1):
            navigate(number, section)
        exercise_settings()
        until = time.monotonic() + 120
        while 'DRIVEKEY_INTERACTIVE_SHUTDOWN_CONFIRMATION' not in serial_text():
            if time.monotonic() >= until:
                raise TimeoutError('Desktop did not accept shutdown shortcut')
            state = view()
            if state and state.get('idle') is True:
                keys('ctrl', 'alt', 'q')
            time.sleep(.2)
        until = time.monotonic() + 30
        while not (view() or {}).get('messageboxMapped'):
            if time.monotonic() >= until:
                raise TimeoutError('Shutdown confirmation did not map on the display')
            time.sleep(.1)
        capture('shutdown-confirmation')
        keys('ret')
        try:
            vm.wait(timeout=90)
        except subprocess.TimeoutExpired:
            raise RuntimeError('Visible shutdown did not finish')
        content = serial_text()
        matches = re.findall(r'DRIVEKEY_INTERACTIVE_SHUTDOWN (\{[^\r\n]+\})', content)
        shutdown = json.loads(matches[-1]) if len(matches) == 1 else None
        report.update(success=vm.returncode == 0 and shutdown is not None and shutdown.get('shutdownPassed') is True,
                      pickerDisplayed=True, explicitUSBSelection=True, actualDesktopDisplayed=True,
                      keyboardInputsSent=True, shutdownRequestedThroughUI=True, shutdown=shutdown,
                      qemuExitCode=vm.returncode)
        if not report['success']:
            raise RuntimeError('Guest cleanup or shutdown acceptance marker missing')
    except Exception as error:
        report['error'] = str(error)
    finally:
        if vm.poll() is None:
            vm.terminate()
            try:
                vm.wait(timeout=5)
            except subprocess.TimeoutExpired:
                vm.kill()
                vm.wait(timeout=5)
        if stream is not None:
            stream.close()
        if qsocket is not None:
            qsocket.close()
        qemu_log.close()
        report['qemuExitCode'] = vm.returncode
        report['durationSeconds'] = round(time.monotonic() - start, 3)
        host_after = host_policy_snapshot()
        report['hostPolicyBefore'] = host_before
        report['hostPolicyAfter'] = host_after
        report['hostPolicyUnchanged'] = host_before['configuration'] == host_after['configuration']
        report['isoUnchanged'] = sha(iso) == initial_iso_hash
        report['sourceImageUnchanged'] = sha(source) == initial_source_hash
        report['initialEmptyMediaSha256'] = initial_media_hash
        report['finalDisposableMediaSha256'] = sha(media)
        report['processStopped'] = vm.poll() is not None
        if serial.exists():
            shutil.copyfile(serial, output / 'serial.log')
            report['serialSha256'] = sha(output / 'serial.log')
        shutil.copyfile(work / 'qemu-stderr.log', output / 'qemu-stderr.log')
        if single_usb:
            exchange = layout['manifest']['exchange']
            offset, length = exchange['offsetBytes'], exchange['lengthBytes']
            end = offset + length
            detail = report['singleUSBImage']
            detail['finalWholeImageSha256'] = report['finalDisposableMediaSha256']
            try:
                require(media.stat().st_size == detail['bytes'], 'Disposable image size changed')
                detail['finalProtectedPrefixSha256'] = sha_range(media, 0, offset)
                detail['finalProtectedSuffixSha256'] = sha_range(media, end, media.stat().st_size - end)
                detail['allBytesOutsideFATUnchanged'] = (
                    detail['finalProtectedPrefixSha256'] == detail['initialProtectedPrefixSha256']
                    and detail['finalProtectedSuffixSha256'] == detail['initialProtectedSuffixSha256'])
                detail['finalFATEntries'] = fat_entries(media, offset)
                detail['FATContainsOnlyDriveKeyDirectory'] = detail['finalFATEntries'] == ['::/DriveKey/']
                detail['readOnlyFATInspectionLeftImageUnchanged'] = sha(media) == report['finalDisposableMediaSha256']
                report['success'] = report['success'] and all(detail.get(key) is True for key in (
                    'allBytesOutsideFATUnchanged', 'FATContainsOnlyDriveKeyDirectory',
                    'readOnlyFATInspectionLeftImageUnchanged'))
            except Exception as error:
                detail['inspectionError'] = str(error)
                report['success'] = False
        report['success'] = report['success'] and report['hostPolicyUnchanged'] and report['isoUnchanged'] and report['sourceImageUnchanged'] and report['processStopped']
        (output / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'output': str(output), **report}), flush=True)
    return 0 if report['success'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
