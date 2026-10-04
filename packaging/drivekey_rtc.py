"""Fixed-profile boot clock initialization. No request input and no RTC writes."""
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import stat
import struct
import sys
import time
from zoneinfo import ZoneInfo

ZONE = 'Europe/Warsaw'
STATE = Path('/run/drivekey-clock.json')
UTC = dt.timezone.utc


def rtc_to_utc(wall):
    """Reject DST gaps and repeated hours rather than picking an expiry clock."""
    if wall.tzinfo is not None or not 2000 <= wall.year <= 2100:
        raise ValueError('Invalid hardware clock date')
    zone = ZoneInfo(ZONE)
    candidates = set()
    for fold in (0, 1):
        value = wall.replace(tzinfo=zone, fold=fold).astimezone(UTC)
        if value.astimezone(zone).replace(tzinfo=None) == wall:
            candidates.add(value)
    if len(candidates) != 1:
        raise ValueError('Hardware clock is ambiguous or invalid during a daylight-saving transition. Signing is locked.')
    return candidates.pop()


def read_rtc():
    # RTC_RD_TIME atomically reads struct rtc_time (nine native 32-bit integers).
    # Never issue RTC_SET_TIME or hwclock --systohc.
    with open('/dev/rtc0', 'rb', buffering=0) as device:
        data = bytearray(36)
        fcntl.ioctl(device.fileno(), 0x80247009, data, True)
    second, minute, hour, day, month, year, *_ = struct.unpack('=9i', data)
    return dt.datetime(year + 1900, month + 1, day, hour, minute, second)


def uptime():
    return float(Path('/proc/uptime').read_text().split()[0])


def validate_state(state, boot_id, now, elapsed):
    if (state.get('version') != 1 or state.get('rtcZone') != ZONE
            or state.get('bootId') != boot_id):
        raise ValueError('Clock initialization does not match this boot')
    epoch, initial = state.get('epoch'), state.get('uptime')
    if (type(epoch) not in (int, float) or type(initial) not in (int, float)
            or not 946684800 <= epoch <= 4133980800 or not 0 <= initial <= elapsed
            or abs(now - (epoch + elapsed - initial)) > 5):
        raise ValueError('System clock changed after boot initialization. Signing is locked.')


def initialize():
    if os.geteuid() != 0 or sys.platform != 'linux' or not Path('/etc/drivekey-live').is_file():
        raise RuntimeError('Boot clock initialization requires the DriveKey live OS')
    if 'microsoft' in Path('/proc/sys/kernel/osrelease').read_text().lower():
        raise RuntimeError('Never initialize the host or WSL clock')
    config = Path('/etc/drivekey-rtc-zone')
    info = config.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or config.read_text().strip() != ZONE:
        raise RuntimeError('Invalid fixed hardware clock profile')
    with open('/run/drivekey-clock.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        boot_id = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        if STATE.exists() or STATE.is_symlink():
            info = STATE.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
                raise RuntimeError('Invalid boot clock record')
            validate_state(json.loads(STATE.read_text()), boot_id, time.time(), uptime())
            return  # Idempotent: never shift an already-initialized session.
        wall = read_rtc()
        target = rtc_to_utc(wall)
        time.clock_settime(time.CLOCK_REALTIME, target.timestamp())
        state = dict(version=1, rtcZone=ZONE, bootId=boot_id, rtcWall=wall.isoformat(),
                     utcAtInitialization=target.isoformat(), epoch=time.time(), uptime=uptime())
        descriptor = os.open(str(STATE), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(state, stream)
            stream.flush()
            os.fsync(stream.fileno())


if __name__ == '__main__':
    try:
        initialize()
    except Exception as error:
        print('Clock initialization failed. Wallet operations locked: ' + str(error), file=sys.stderr)
        sys.exit(1)
