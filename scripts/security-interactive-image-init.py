#!/usr/bin/python3
"""Guest PID-1 for the separate interactive, unreleased candidate image.

Uses the existing immutable broker policy. No fixture generator, test wallet,
automounter, network service, formatting tool, or production-policy override.
"""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import resource
import signal
import struct
import subprocess
import sys
import termios
import time


def require_guest_pid1():
    if sys.platform != 'linux' or os.getpid() != 1 or os.geteuid() != 0:
        raise RuntimeError('Guest PID-1 required')
    try:
        kernel_release = Path('/proc/sys/kernel/osrelease').read_text().lower()
    except BaseException as error:
        # The identity is unknown: hold without running cleanup, subprocesses,
        # policy writes or the GUI. The ordinary host checks above still reject
        # imported/manual launches before any diagnostic side effects.
        hold_failure('Unable to verify guest kernel: ' + type(error).__name__)
        raise RuntimeError('Guest identity hold unexpectedly returned')
    if 'microsoft' in kernel_release:
        raise RuntimeError('Build host cannot run guest init')


def guard():
    require_guest_pid1()
    if 'drivekey.interactive=1' not in Path('/proc/cmdline').read_text().split():
        raise RuntimeError('Interactive boot argument missing')
    if not Path('/etc/drivekey-interactive-image').is_file() or not Path('/etc/drivekey-unfunded-image').is_file():
        raise RuntimeError('Interactive candidate markers missing')


def prepare_stdio():
    """Repair actual inherited descriptors before policy or GUI subprocesses.

    A registered but unusable serial console can return EIO. Python then
    exits 120 while flushing even when a policy check otherwise succeeded.
    No failed policy result is reinterpreted here: its output sink is repaired
    first, and its ordinary checked exit status remains mandatory.
    """
    probe = b'DRIVEKEY_INTERACTIVE_CONSOLE_PROBE\n'
    try:
        if all(os.write(fd, probe) == len(probe) for fd in (1, 2)):
            return 'inherited'
    except OSError:
        pass
    for path in ('/dev/tty0', '/dev/null'):
        fd = None
        try:
            fd = os.open(path, os.O_WRONLY | os.O_NOCTTY | os.O_NONBLOCK | os.O_CLOEXEC)
            if os.write(fd, probe) != len(probe):
                continue
            for target in (1, 2):
                if fd != target:
                    os.dup2(fd, target)
            return path
        except OSError:
            continue
        finally:
            if fd is not None and fd not in (1, 2):
                os.close(fd)
    raise RuntimeError('No usable startup output sink')


def emit(message, visible=False):
    """Bounded best-effort diagnostics must never terminate PID 1."""
    try:
        data = (str(message)[:6000] + '\n').encode('utf-8', errors='replace')
        delivered = False
        try:
            delivered = os.write(1, data) == len(data)
        except OSError:
            pass
        if visible or not delivered:
            local = False
            for path in ('/dev/tty0', '/dev/kmsg'):
                fd = None
                try:
                    fd = os.open(path, os.O_WRONLY | os.O_NOCTTY | os.O_NONBLOCK | os.O_CLOEXEC)
                    payload = b'<3>' + data if path == '/dev/kmsg' else data
                    local = os.write(fd, payload) == len(payload)
                except OSError:
                    pass
                finally:
                    if fd is not None:
                        os.close(fd)
                if local:
                    break
    except BaseException:
        # Error reporting cannot become a second startup failure.
        pass


def hold_failure(message):
    emit('DRIVEKEY_INTERACTIVE_STOPPED ' + message +
         '\nStartup stopped. Photograph this message, then power off.', visible=True)
    while True:
        try:
            time.sleep(60)
        except BaseException:
            pass


def environment_check():
    if sorted(p.name for p in Path('/sys/class/net').iterdir()) != ['lo']:
        raise RuntimeError('Non-loopback network interface present')
    if len(Path('/proc/swaps').read_text().splitlines()) != 1:
        raise RuntimeError('Swap is enabled')
    if Path('/proc/sys/kernel/modules_disabled').read_text().strip() != '1':
        raise RuntimeError('Kernel module loading remains enabled')
    roots = [line.split() for line in Path('/proc/self/mountinfo').read_text().splitlines() if line.split()[4] == '/']
    if len(roots) != 1 or 'ro' not in roots[0][5].split(','):
        raise RuntimeError('Root filesystem is not read-only')


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def terminate(process):
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def monitored_wait(process, xserver):
    while process.poll() is None:
        environment_check()
        if xserver.poll() is not None:
            terminate(process)
            raise RuntimeError('Display server exited')
        time.sleep(.25)
    return process.returncode


def console_session():
    os.setsid()
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)


def xauthority(path):
    # FamilyWild avoids dependency on hostname setup in this minimal guest.
    fields = (b'', b'0', b'MIT-MAGIC-COOKIE-1', os.urandom(16))
    data = struct.pack('>H', 65535)
    for field in fields:
        data += struct.pack('>H', len(field)) + field
    path.write_bytes(data)
    path.chmod(0o600)
    os.chown(path, 1000, 1000)


def main():
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    Path('/proc/sys/kernel/core_pattern').write_text('core\n')
    os.umask(0o077)
    environment_check()
    Path('/run/user/1000').mkdir(parents=True, exist_ok=True)
    Path('/run/user').chmod(0o755)
    os.chown('/run/user/1000', 1000, 1000)
    Path('/tmp/.X11-unix').mkdir(mode=0o1777)
    Path('/tmp/.X11-unix').chmod(0o1777)
    os.umask(0o022)
    try:
        run(['/usr/bin/python3', '-I', '-B', '/opt/drivekey/drivekey_rtc.py'])
    finally:
        os.umask(0o077)
    run(['/usr/bin/python3', '-I', '-B', '/opt/drivekey/drivekey-candidate-policy.py', '--check'])
    auth = Path('/run/user/1000/.Xauthority')
    xauthority(auth)
    env = {'PATH': '/usr/bin', 'LANG': 'C.UTF-8', 'HOME': '/run/user/1000',
           'DISPLAY': ':0', 'XAUTHORITY': str(auth), 'XDG_RUNTIME_DIR': '/run/user/1000',
           'PYTHONDONTWRITEBYTECODE': '1', 'NODE_ENV': 'production'}
    # Only the packaged input/DRM rules are present. No automount daemon runs.
    udev = subprocess.Popen(['/usr/lib/systemd/systemd-udevd'], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    xserver = desktop = None
    try:
        for _ in range(100):
            if udev.poll() is not None:
                raise RuntimeError('Input device manager exited')
            if Path('/run/udev/control').exists():
                break
            time.sleep(.05)
        else:
            raise RuntimeError('Input device manager startup timed out')
        run(['/usr/bin/udevadm', 'trigger', '--action=add'], env=env, timeout=20)
        run(['/usr/bin/udevadm', 'settle', '--timeout=15'], env=env, timeout=20)
        environment_check()
        # A DRM driver may also expose fb0 through its compatibility layer.
        # Prefer the native KMS path; firmware-only displays retain fbdev.
        driver = 'modesetting' if any(Path('/dev/dri').glob('card[0-9]*')) else 'fbdev'
        emit('DRIVEKEY_INTERACTIVE_DISPLAY_DRIVER ' + driver)
        config = '''Section "ServerFlags"
 Option "AutoAddDevices" "true"
 Option "AutoAddGPU" "false"
 Option "DontVTSwitch" "true"
 Option "DontZap" "true"
EndSection
Section "Module"
 Disable "glx"
EndSection
Section "Device"
 Identifier "Display"
 Driver "%s"
 Option "AccelMethod" "none"
EndSection
Section "Screen"
 Identifier "Screen"
 Device "Display"
 DefaultDepth 24
EndSection
Section "InputClass"
 Identifier "Candidate keyboard and pointer"
 MatchIsKeyboard "on"
 Driver "libinput"
EndSection
Section "InputClass"
 Identifier "Candidate pointing devices"
 MatchIsPointer "on"
 Driver "libinput"
EndSection
Section "InputClass"
 Identifier "Candidate touchpads"
 MatchIsTouchpad "on"
 Driver "libinput"
EndSection
''' % driver
        Path('/run/xorg.conf').write_text(config)
        with open('/dev/tty1', 'r+b', buffering=0) as tty, open('/run/xorg.log', 'wb') as log:
            xserver = subprocess.Popen(['/usr/lib/xorg/Xorg', ':0', 'vt1', '-keeptty',
                                        '-nolisten', 'tcp', '-noreset', '-auth', str(auth),
                                        '-config', '/run/xorg.conf', '-logfile', '/run/Xorg.0.log'],
                                       stdin=tty, stdout=log, stderr=log, env=env,
                                       preexec_fn=console_session)
            for _ in range(200):
                environment_check()
                if xserver.poll() is not None:
                    raise RuntimeError('Xorg failed: ' + Path('/run/xorg.log').read_text(errors='replace')[-3000:])
                if Path('/tmp/.X11-unix/X0').exists():
                    break
                time.sleep(.05)
            else:
                raise RuntimeError('Xorg startup timed out')
            emit('DRIVEKEY_INTERACTIVE_DISPLAY_READY')
            args = [a.split('=', 1)[1] for a in Path('/proc/cmdline').read_text().split()
                    if a.startswith('drivekey.exchange_uuid=')]
            if len(args) > 1:
                raise RuntimeError('Duplicate exchange selection')
            spec = importlib.util.spec_from_file_location('interactive_storage', '/opt/drivekey/security-interactive-storage.py')
            storage = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(storage)
            selected = storage.select_and_mount_exchange(env, args[0] if args else None)
            if selected is None:
                return
            environment_check()
            emit('DRIVEKEY_INTERACTIVE_EXCHANGE_SELECTED')
            # The original candidate wrapper checks the mandatory broker before
            # creating the real desktop. No runtime code is imported from USB.
            desktop = subprocess.Popen(['/usr/bin/python3', '-I', '-B', '/opt/drivekey/security-interactive-desktop.py'], env=env,
                                       user=1000, group=1000, extra_groups=[])
            status = monitored_wait(desktop, xserver)
            if status not in (0, 42, 43):
                raise RuntimeError('Candidate desktop exited unsuccessfully')
    finally:
        errors = []
        for process in (desktop, xserver, udev):
            try:
                terminate(process)
            except BaseException as error:
                errors.append(type(error).__name__)
        if errors:
            raise RuntimeError('Session cleanup failed: ' + ', '.join(errors))


def drain_children():
    started = time.monotonic()
    while time.monotonic() - started < 5:
        try:
            child, _ = os.waitpid(-1, os.WNOHANG)
            if child > 0:
                continue
        except ChildProcessError:
            return True
        raw = Path('/proc/1/task/1/children').read_text()
        if len(raw) > 8192:
            return False
        for value in raw.split():
            if not value.isdecimal() or int(value) <= 1:
                return False
            try:
                os.kill(int(value), signal.SIGTERM if time.monotonic() - started < 1 else signal.SIGKILL)
            except ProcessLookupError:
                pass
        time.sleep(.02)
    return False


def run_child():
    status = 1
    try:
        main()
        status = 0
    except BaseException as error:
        emit('DRIVEKEY_INTERACTIVE_FAILURE ' + type(error).__name__ + ': ' + str(error)[:3500], visible=True)
    finally:
        for stream in (sys.stdout, sys.stderr):
            try:
                stream.flush()
            except BaseException:
                status = 1
        # Never run Python finalization against a failed console.
        os._exit(status)


def exchange_mounted():
    return any(line.split()[4] == '/mnt/drivekey'
               for line in Path('/proc/self/mountinfo').read_text().splitlines())


def cleanup(exit_code):
    errors = []
    try:
        clean = drain_children()
    except BaseException as error:
        clean = False
        errors.append('children: ' + type(error).__name__)
    try:
        synced = subprocess.run(['/usr/bin/busybox', 'sync'], check=False, timeout=30).returncode
    except BaseException as error:
        synced = -1
        errors.append('sync: ' + type(error).__name__)
    try:
        unmounted = subprocess.run(['/usr/bin/busybox', 'umount', '/mnt/drivekey'],
                                   check=False, timeout=15).returncode if exchange_mounted() else 0
    except BaseException as error:
        unmounted = -1
        errors.append('unmount: ' + type(error).__name__)
    try:
        remains = exchange_mounted()
    except BaseException as error:
        remains = True
        errors.append('mount-state: ' + type(error).__name__)
    shutdown = {'childrenReaped': clean, 'exitCode': exit_code,
                'syncExitCode': synced, 'unmountExitCode': unmounted, 'exchangeStillMounted': remains}
    shutdown['shutdownPassed'] = clean and synced == 0 and unmounted == 0 and not remains and exit_code == 0
    if errors:
        shutdown['cleanupErrors'] = errors
    return shutdown


def supervise():
    # Never perform cleanup or enter an endless hold on a developer's host.
    require_guest_pid1()
    failure = None
    exit_code = 1
    try:
        sink = prepare_stdio()
        guard()
        emit('DRIVEKEY_INTERACTIVE_CONSOLE ' + sink)
        child = os.fork()
        if child == 0:
            run_child()
        while True:
            try:
                exited, status = os.waitpid(-1, 0)
            except InterruptedError:
                continue
            if exited == child:
                exit_code = os.waitstatus_to_exitcode(status)
                break
    except BaseException as error:
        failure = type(error).__name__ + ': ' + str(error)[:3500]
        emit('DRIVEKEY_INTERACTIVE_FAILURE ' + failure)
    try:
        shutdown = cleanup(exit_code)
        emit('DRIVEKEY_INTERACTIVE_SHUTDOWN ' + json.dumps(shutdown))
        if failure is not None or not shutdown['shutdownPassed']:
            hold_failure(failure or 'Startup/session failed; exit=' + str(exit_code))
        subprocess.run(['/usr/bin/busybox', 'poweroff', '-f'], check=False, timeout=15)
    except BaseException as error:
        failure = type(error).__name__ + ': ' + str(error)[:3500]
    hold_failure(failure or 'Power-off returned without stopping the machine.')


if __name__ == '__main__':
    supervise()
