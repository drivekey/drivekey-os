#!/usr/bin/python3
"""Observe a bounded, disposable boot without a guaranteed serial console.

This diagnostic may select only its empty disposable exchange and request UI
shutdown after screenshot review. It creates no wallets, sends no transactions,
and never modifies the immutable source image.
"""
import datetime
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
from zoneinfo import ZoneInfo


def main():
    if sys.platform != 'linux' or len(sys.argv) not in (4, 5):
        raise ValueError('Usage: run-security-console-regression.py SOURCE.img cirrus-fbdev|ramfb|vga-kms none|file [seconds]')
    graphics, serial_mode = sys.argv[2:4]
    if graphics not in ('cirrus-fbdev', 'ramfb', 'vga-kms') or serial_mode not in ('none', 'file'):
        raise ValueError('Unsupported fixed diagnostic hardware profile')
    seconds = int(sys.argv[4]) if len(sys.argv) == 5 else 120
    if not 30 <= seconds <= 300:
        raise ValueError('Diagnostic observation must be between 30 and 300 seconds')
    helper = Path(__file__).with_name('run-security-interactive-smoke.py')
    spec = importlib.util.spec_from_file_location('drivekey_smoke_helpers', helper)
    common = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(common)
    source = Path(sys.argv[1])
    common.require(not source.is_symlink() and source.is_file() and source.suffix == '.img',
                   'Regular completed source image required')
    source = source.resolve(strict=True)
    layout = common.single_usb_layout(source)
    project = Path(__file__).resolve().parents[1]
    output = project / 'outputs' / f'console-regression-{graphics}-{serial_mode}-{time.time_ns() // 1000000}'
    output.mkdir()
    work = Path(tempfile.mkdtemp(prefix='drivekey-console-regression-', dir='/var/tmp'))
    media = work / 'disposable-single-usb.img'
    shutil.copyfile(source, media)
    source_hash = common.sha(source)
    common.require(common.sha(media) == source_hash, 'Disposable image copy differs')
    variables = Path('/usr/share/OVMF/OVMF_VARS_4M.fd')
    code = Path('/usr/share/OVMF/OVMF_CODE_4M.fd')
    shutil.copyfile(variables, work / 'fresh-vars.fd')
    qmp = work / 'qmp.sock'
    serial = work / 'serial.log'
    accelerator = 'kvm' if os.access('/dev/kvm', os.R_OK | os.W_OK) else 'tcg'
    args = ['/usr/bin/qemu-system-x86_64', '-machine', 'q35,accel=' + accelerator,
            '-cpu', 'host' if accelerator == 'kvm' else 'max', '-m', '3072', '-smp', '2',
            '-nodefaults', '-nic', 'none', '-display', 'none', '-device',
            {'cirrus-fbdev': 'cirrus-vga', 'ramfb': 'ramfb', 'vga-kms': 'VGA'}[graphics],
            '-serial', 'none' if serial_mode == 'none' else 'file:' + str(serial),
            '-qmp', 'unix:' + str(qmp) + ',server=on,wait=off',
            '-action', 'reboot=shutdown', '-action', 'shutdown=pause', '-action', 'panic=pause',
            '-device', 'qemu-xhci', '-device', 'usb-tablet', '-device', 'usb-kbd',
            '-device', 'virtio-rng-pci', '-rtc',
            'base=' + datetime.datetime.now(ZoneInfo('Europe/Warsaw')).strftime('%Y-%m-%dT%H:%M:%S') + ',clock=rt']
    args += common.boot_source_args(media, 'usb-storage', writable=True)
    args += ['-drive', 'if=pflash,format=raw,readonly=on,file=' + str(code),
             '-drive', 'if=pflash,format=raw,file=' + str(work / 'fresh-vars.fd')]
    (output / 'qemu-argv.json').write_text(json.dumps(args, indent=2) + '\n')
    before = common.host_policy_snapshot()
    report = {'kind': 'drivekey-console-regression-observation', 'source': str(source),
              'sourceSha256': source_hash, 'sourceManifestSha256': layout['manifestSha256'],
              'runnerSha256': common.sha(__file__), 'helperSha256': common.sha(helper),
              'graphicsProfile': graphics, 'serialProfile': serial_mode,
              'firmware': {'codeSha256': common.sha(code), 'variablesSha256': common.sha(variables)},
              'work': str(work), 'disposableMedia': str(media), 'nic': False, 'hostShares': False,
              'storageDeviceCount': 1, 'physicalHardwareTested': False, 'fundingReady': False,
              'walletsCreated': 0, 'signaturesProduced': 0, 'transactionsSubmitted': 0,
              'keyboardInputsSent': False, 'protectedPayloadModified': False,
              'reproductionConfirmed': False, 'visualReviewRequired': True,
              'harnessCompleted': False, 'events': [], 'screenshots': [], 'operatorActions': []}
    print(json.dumps({'output': str(output), 'work': str(work), 'stage': 'launching'}), flush=True)
    stream = qsocket = vm = None
    log = (work / 'qemu-stderr.log').open('wb')
    start = time.monotonic()

    def command(name, arguments=None):
        stream.write((json.dumps({'execute': name, 'arguments': arguments or {}}) + '\n').encode())
        stream.flush()
        while True:
            raw = stream.readline()
            if not raw:
                raise RuntimeError('QMP connection ended')
            reply = json.loads(raw)
            if 'event' in reply:
                common.require(len(report['events']) < 1000, 'QMP event count exceeds bound')
                report['events'].append(reply)
            if 'error' in reply:
                raise RuntimeError(reply['error'])
            if 'return' in reply:
                return reply['return']

    def capture(name):
        from PIL import Image
        ppm = work / 'frame.ppm'
        command('screendump', {'filename': str(ppm)})
        target = output / (name + '.png')
        with Image.open(ppm) as pixels:
            pixels.save(target)
        report['screenshots'].append({'name': name, 'path': target.name,
                                      'sha256': common.sha(target),
                                      'elapsedSeconds': round(time.monotonic() - start, 2)})

    def operator_action():
        # This is a bounded local harness control file, never guest or USB input.
        # Each action must cite a recently captured image reviewed by the operator.
        control = work / 'operator-action.json'
        if not control.exists():
            return
        info = control.lstat()
        common.require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                       and not info.st_mode & 0o077 and info.st_size <= 1024,
                       'Unsafe operator control file')
        action = json.loads(control.read_text())
        common.require(set(action) == {'sequence', 'action', 'reviewedScreenshotSha256'},
                       'Unexpected operator action fields')
        sequence = len(report['operatorActions']) + 1
        if type(action['sequence']) is int and action['sequence'] < sequence:
            return
        prior = [item['action'] for item in report['operatorActions']]
        allowed = {'select-exchange'} if not prior else {'request-shutdown'} if prior == ['select-exchange'] else {'request-shutdown', 'confirm-shutdown'}
        if 'confirm-shutdown' in prior:
            allowed = set()
        common.require(type(action['sequence']) is int and action['sequence'] == sequence
                       and sequence <= 12 and action['action'] in allowed,
                       'Operator actions must follow the fixed empty-desktop workflow')
        reviewed = [item for item in report['screenshots']
                    if item['sha256'] == action['reviewedScreenshotSha256']]
        common.require(reviewed and time.monotonic() - start - reviewed[-1]['elapsedSeconds'] < 45,
                       'Operator action requires a recent captured screenshot')
        steps = {'select-exchange': [('down',), ('ret',)],
                 'request-shutdown': [('ctrl', 'alt', 'q')], 'confirm-shutdown': [('ret',)]}
        for keys in steps[action['action']]:
            command('send-key', {'keys': [{'type': 'qcode', 'data': key} for key in keys], 'hold-time': 80})
            time.sleep(.35)
        report['keyboardInputsSent'] = True
        report['operatorActions'].append({**action, 'elapsedSeconds': round(time.monotonic() - start, 2)})

    try:
        vm = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=log, stderr=log)
        deadline = time.monotonic() + 15
        while not qmp.exists():
            if vm.poll() is not None or time.monotonic() >= deadline:
                raise RuntimeError('QEMU did not expose bounded local QMP')
            time.sleep(.1)
        qsocket = socket.socket(socket.AF_UNIX)
        qsocket.settimeout(5)
        qsocket.connect(str(qmp))
        stream = qsocket.makefile('rwb')
        json.loads(stream.readline())
        command('qmp_capabilities')
        next_capture = 0
        while time.monotonic() - start < seconds:
            if vm.poll() is not None:
                report['observation'] = 'qemu-exited'
                break
            status = command('query-status')
            report['finalGuestStatus'] = status
            elapsed = time.monotonic() - start
            if not status.get('running'):
                capture('guest-stopped')
                report['observation'] = 'guest-stopped'
                break
            operator_action()
            if elapsed >= next_capture:
                capture('frame-' + str(int(elapsed)).zfill(3))
                next_capture = elapsed + 10
            time.sleep(.5)
        else:
            capture('observation-end')
            report['observation'] = 'observation-deadline-reached'
        report['harnessCompleted'] = True
    except Exception as error:
        report['error'] = str(error)
    finally:
        if vm is not None and vm.poll() is None:
            try:
                command('quit')
                report['stopMethod'] = 'qmp-quit'
                vm.wait(timeout=5)
            except Exception:
                vm.terminate()
                report['stopMethod'] = 'terminate'
                try:
                    vm.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    vm.kill()
                    vm.wait(timeout=5)
                    report['stopMethod'] = 'kill'
        if stream is not None:
            stream.close()
        if qsocket is not None:
            qsocket.close()
        log.close()
        report['qemuExitCode'] = vm.returncode if vm is not None else None
        report['processStopped'] = vm is None or vm.poll() is not None
        report['durationSeconds'] = round(time.monotonic() - start, 3)
        report['hostPolicyBefore'] = before
        report['hostPolicyAfter'] = common.host_policy_snapshot()
        report['hostPolicyUnchanged'] = before['configuration'] == report['hostPolicyAfter']['configuration']
        report['sourceImageUnchanged'] = common.sha(source) == source_hash
        report['finalMediaSha256'] = common.sha(media)
        report['mediaUnchanged'] = report['finalMediaSha256'] == source_hash
        exchange = layout['manifest']['exchange']
        end = exchange['offsetBytes'] + exchange['lengthBytes']
        report['allBytesOutsideFATUnchanged'] = (
            common.sha_range(media, 0, exchange['offsetBytes']) == layout['protectedPrefixSha256']
            and common.sha_range(media, end, media.stat().st_size - end) == layout['protectedSuffixSha256'])
        report['finalFATEntries'] = common.fat_entries(media, exchange['offsetBytes'])
        if serial.exists():
            common.require(serial.stat().st_size <= 4 * 1024 * 1024, 'Serial log exceeds diagnostic bound')
            shutil.copyfile(serial, output / 'serial.log')
        shutil.copyfile(work / 'qemu-stderr.log', output / 'qemu-stderr.log')
        report['harnessCompleted'] = report['harnessCompleted'] and all(report[key] for key in
            ('processStopped', 'hostPolicyUnchanged', 'sourceImageUnchanged', 'allBytesOutsideFATUnchanged'))
        (output / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'output': str(output), **report}), flush=True)
    return 0 if report['harnessCompleted'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
