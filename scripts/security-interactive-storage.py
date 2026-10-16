#!/usr/bin/python3
"""Explicit USB exchange selection for the interactive candidate guest only.

Enumeration reads filesystem metadata, never wallet files. Nothing is formatted.
The unprivileged picker returns an identity from the parent's current allowlist.
"""
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

UUID = re.compile(r'[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}')
DEVICE = re.compile(r'(?:sd[a-z]+|vd[a-z]+|nvme[0-9]+n[0-9]+)(?:p?[0-9]+)?')
MOUNT = '/mnt/drivekey'
BOOT_MOUNT = '/run/boot-source'
BOOT_LAYOUT = {
    'schemaVersion': 1, 'kind': 'drivekey-interactive-boot-layout',
    'protectedPrefixBytes': 268435456, 'sectorBytes': 512,
    'sameDiskExchangeAllowed': True, 'exchangePartitionNumber': 5,
    'exchangeStartBytes': 268435456, 'exchangeLengthBytes': 804257792,
    'diskImageBytes': 1073741824,
}


def public_label(value):
    return ''.join(c for c in value if 32 <= ord(c) <= 126)[:40] or 'Unnamed USB'


def disk_family(node):
    """Resolved sysfs disk ancestor, shared by all partitions on that disk."""
    resolved = node.resolve(strict=True)
    return resolved.parent if (resolved / 'partition').exists() else resolved


def bounded_number(path, positive=False):
    value = path.read_text().strip()
    if not re.fullmatch(r'[0-9]{1,20}', value) or (positive and int(value) == 0):
        raise ValueError('Invalid block geometry')
    return int(value)


def geometry(node):
    family = disk_family(node)
    partition = (node / 'partition').exists()
    start = bounded_number(node / 'start') if partition else 0
    sectors = bounded_number(node / 'size', True)
    parent_sectors = bounded_number(family / 'size', True)
    number = bounded_number(node / 'partition', True) if partition else 0
    if start + sectors > parent_sectors:
        raise ValueError('Partition exceeds its disk')
    return {'partitionNumber': number, 'startBytes': start * 512,
            'bytes': sectors * 512, 'parentBytes': parent_sectors * 512}


def boot_layout(root):
    path = root / 'etc/drivekey-boot-layout.json'
    if not path.exists() and not path.is_symlink():
        return None  # Historical images retain separate-USB-only behavior.
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or info.st_size > 2048:
        raise ValueError('Untrusted boot layout metadata')
    value = json.loads(path.read_text())
    if value != BOOT_LAYOUT or any(type(value[key]) is not type(expected) for key, expected in BOOT_LAYOUT.items()):
        raise ValueError('Unsupported boot layout metadata')
    return value


def captured_boot_device(root):
    path = root / 'run/drivekey-boot-device.json'
    if not path.exists() and not path.is_symlink():
        return None
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077 or info.st_size > 4096:
        raise ValueError('Untrusted boot device metadata')
    value = json.loads(path.read_text())
    keys = {'schemaVersion', 'bootMajorMinor', 'familyMajorMinor', 'diskseq', 'mountId', 'sysfsFamily', 'imageId',
            'sourceDevice', 'sourceMajorMinor', 'loopDevice', 'loopOffsetBytes', 'loopSizeLimitBytes'}
    integers = {'schemaVersion', 'diskseq', 'loopOffsetBytes', 'loopSizeLimitBytes'}
    if (not isinstance(value, dict) or set(value) != keys
            or type(value['schemaVersion']) is not int or value['schemaVersion'] != 1
            or type(value['diskseq']) is not int or not 0 < value['diskseq'] < 2**64
            or any(not isinstance(value[key], str) for key in keys - integers)
            or type(value['loopOffsetBytes']) is not int or value['loopOffsetBytes'] != 0
            or type(value['loopSizeLimitBytes']) is not int or value['loopSizeLimitBytes'] != BOOT_LAYOUT['protectedPrefixBytes']
            or not re.fullmatch(r'[0-9]{1,10}:[0-9]{1,10}', value['bootMajorMinor'])
            or not re.fullmatch(r'[0-9]{1,10}:[0-9]{1,10}', value['sourceMajorMinor'])
            or not re.fullmatch(r'[0-9]{1,10}:[0-9]{1,10}', value['familyMajorMinor'])
            or not value['sourceDevice'].startswith('/dev/')
            or not (DEVICE.fullmatch(value['sourceDevice'][5:]) or re.fullmatch(r'sr[0-9]{1,4}', value['sourceDevice'][5:]))
            or not re.fullmatch(r'/dev/loop[0-9]{1,4}', value['loopDevice'])
            or not re.fullmatch(r'[0-9]{1,20}', value['mountId'])
            or not re.fullmatch(r'/sys/devices/[A-Za-z0-9_.:+/-]{1,1000}', value['sysfsFamily'])
            or value['imageId'] != (root / 'etc/drivekey-interactive-image').read_text().strip()):
        raise ValueError('Invalid boot device metadata')
    return value


def boot_source(root, nodes, rows, layout):
    if layout is None:
        return None
    captured = captured_boot_device(root)
    if captured is None:
        return None
    matches = [row for row in rows if row[4] == BOOT_MOUNT]
    if len(matches) != 1:
        return None
    row = matches[0]
    separator = row.index('-') if '-' in row else -1
    if (separator < 6 or len(row) <= separator + 3 or row[3] != '/'
            or row[separator + 1] != 'iso9660'
            or not {'ro', 'nosuid', 'nodev', 'noexec'}.issubset(set(row[5].split(',')))):
        return None
    devices = []
    for node in nodes:
        try:
            if (node / 'dev').read_text().strip() == row[2]:
                devices.append(node)
        except FileNotFoundError:
            continue
    if len(devices) != 1:
        return None
    loop = devices[0]
    if loop.name != Path(captured['loopDevice']).name:
        return None
    try:
        if ((loop / 'ro').read_text().strip() != '1'
                or (loop / 'loop/backing_file').read_text().strip() != captured['sourceDevice']
                or bounded_number(loop / 'loop/offset') != captured['loopOffsetBytes']
                or bounded_number(loop / 'loop/sizelimit', True) != captured['loopSizeLimitBytes']):
            return None
        source = root / 'sys/class/block' / Path(captured['sourceDevice']).name
        if ((source / 'partition').exists()
                or captured['sourceMajorMinor'] != captured['familyMajorMinor']
                or (source / 'dev').read_text().strip() != captured['sourceMajorMinor']):
            return None
        family = disk_family(source)
    except FileNotFoundError:
        return None
    if (row[0] != captured['mountId'] or row[2] != captured['bootMajorMinor']
            or (family / 'dev').read_text().strip() != captured['familyMajorMinor']
            or bounded_number(family / 'diskseq', True) != captured['diskseq']
            or '/' + family.relative_to(root).as_posix() != captured['sysfsFamily']):
        return None
    return {'family': family, 'pair': (row[4], row[2]), 'mountId': row[0]}


def permitted_boot_partition(node, nodes, shape, layout):
    if (shape['partitionNumber'] != layout['exchangePartitionNumber']
            or shape['startBytes'] != layout['exchangeStartBytes']
            or shape['bytes'] != layout['exchangeLengthBytes']
            or shape['parentBytes'] < layout['diskImageBytes']):
        return False
    start, end = shape['startBytes'], shape['startBytes'] + shape['bytes']
    family = disk_family(node)
    for sibling in nodes:
        if sibling == node or not (sibling / 'partition').exists() or disk_family(sibling) != family:
            continue
        other = geometry(sibling)
        if start < other['startBytes'] + other['bytes'] and other['startBytes'] < end:
            return False
    return True


def discover_exchange(root=Path('/'), probe=subprocess.run, device_stat=os.stat, allow_selected_mount=None):
    root = Path(root)
    classes = root / 'sys/class/block'
    nodes = list(classes.iterdir())
    if len(nodes) > 256:
        raise ValueError('Too many block devices')
    rows = []
    for line in (root / 'proc/self/mountinfo').read_text().splitlines():
        fields = line.split()
        if len(fields) < 6:
            raise ValueError('Invalid mount inventory')
        rows.append(fields)
    layout = boot_layout(root)
    boot = boot_source(root, nodes, rows, layout)
    if layout is not None and boot is None:
        # A loop-mounted ISO does not directly mark its physical disk mounted.
        # Never fall back to ordinary USB discovery when its binding is absent.
        return []
    mounted_pairs = {(row[4], row[2]) for row in rows if allow_selected_mount != (row[4], row[2])}
    mounted_by_family = {}
    for node in nodes:
        try:
            identity = (node / 'dev').read_text().strip()
            pairs = {pair for pair in mounted_pairs if pair[1] == identity}
            if pairs:
                mounted_by_family.setdefault(disk_family(node), set()).update(pairs)
        except FileNotFoundError:
            continue
    if boot is not None:
        mounted_by_family.setdefault(boot['family'], set()).add(boot['pair'])
    found = []
    for node in sorted(nodes):
        if not DEVICE.fullmatch(node.name):
            continue
        try:
            family = disk_family(node)
            # No internal or virtual disk. The one-stick exception is bound to
            # the real read-only ISO mount and immutable exact data geometry.
            if not any(re.fullmatch(r'usb[0-9]+', part) for part in family.parts):
                continue
            same_boot = boot is not None and family == boot['family']
            mounts = mounted_by_family.get(family, set())
            if mounts and not (same_boot and mounts == {boot['pair']}):
                continue
            if (node / 'ro').read_text().strip() != '0':
                continue
            shape = geometry(node)
            if same_boot and not permitted_boot_partition(node, nodes, shape, layout):
                continue
            identity = (node / 'dev').read_text().strip()
            if not re.fullmatch(r'[0-9]+:[0-9]+', identity):
                raise ValueError('Invalid block identity')
            diskseq = (family / 'diskseq').read_text().strip()
            if not diskseq.isdecimal() or int(diskseq) < 1:
                raise ValueError('Missing disk generation identity')
            device = root / 'dev' / node.name
            ds = device_stat(device, follow_symlinks=False)
            if not stat.S_ISBLK(ds.st_mode) or f'{os.major(ds.st_rdev)}:{os.minor(ds.st_rdev)}' != identity:
                continue
            result = probe(['/usr/sbin/blkid', '-p', '-o', 'export', str(device)],
                           capture_output=True, text=True, timeout=3, check=False)
            if result.returncode != 0 or len(result.stdout) > 8192:
                continue
            metadata = {}
            for line in result.stdout.splitlines():
                key, separator, value = line.partition('=')
                if separator and key not in metadata:
                    metadata[key] = value
            uuid = metadata.get('UUID', '')
            if metadata.get('TYPE') != 'vfat' or not UUID.fullmatch(uuid):
                continue
            size = shape['bytes']
            if size < 1024 * 1024:
                continue
            found.append({'device': '/dev/' + node.name, 'uuid': uuid.upper(),
                          'majorMinor': identity, 'sysfs': str(node.resolve(strict=True)),
                          'family': str(family), 'diskseq': int(diskseq), **shape,
                          'sameBootDisk': same_boot, 'bootMountId': boot['mountId'] if same_boot else None,
                          'label': public_label(metadata.get('LABEL', ''))})
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue  # A disconnected device never becomes a selectable fallback.
    counts = {}
    for item in found:
        counts[item['uuid']] = counts.get(item['uuid'], 0) + 1
    return [item for item in found if counts[item['uuid']] == 1]


def require_guest():
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise ValueError('Guest root supervisor required')
    if 'microsoft' in Path('/proc/sys/kernel/osrelease').read_text().lower():
        raise ValueError('Cannot run on the build host')
    if 'drivekey.interactive=1' not in Path('/proc/cmdline').read_text().split():
        raise ValueError('Interactive guest marker missing')
    if not Path('/etc/drivekey-unfunded-image').is_file():
        raise ValueError('Candidate marker missing')


def select_and_mount_exchange(env, requested_uuid=None):
    """Return selected public metadata, or None when the operator shuts down."""
    require_guest()
    if requested_uuid is not None and not UUID.fullmatch(requested_uuid):
        raise ValueError('Invalid explicitly requested FAT UUID')
    while True:
        choices = discover_exchange()
        if requested_uuid is not None:
            selected = [item for item in choices if item['uuid'] == requested_uuid.upper()]
            if len(selected) != 1:
                raise ValueError('Requested exchange UUID is not a unique unmounted USB FAT volume')
            chosen = selected[0]
        else:
            result = subprocess.run(['/usr/bin/python3', '-I', '-B', __file__, '--picker'],
                                    input=json.dumps(choices), stdout=subprocess.PIPE,
                                    text=True, env=env, user=1000, group=1000,
                                    extra_groups=[], check=True)
            if len(result.stdout) > 256:
                raise ValueError('Invalid picker response')
            reply = json.loads(result.stdout)
            if reply == {'action': 'shutdown'}:
                return None
            if reply == {'action': 'refresh'}:
                continue
            if set(reply) != {'uuid'} or not isinstance(reply['uuid'], str):
                raise ValueError('Invalid picker selection')
            selected = [item for item in choices if item['uuid'] == reply['uuid']]
            if len(selected) != 1:
                raise ValueError('Picker selection is not in the offered inventory')
            chosen = selected[0]
        # Re-probe after user interaction; unplug/replacement or new mounts fail closed.
        if chosen not in discover_exchange():
            raise ValueError('Exchange device changed during selection')
        if not Path(MOUNT).is_dir() or Path(MOUNT).is_symlink():
            raise ValueError('Invalid fixed exchange mount point')
        subprocess.run(['/usr/bin/busybox', 'mount', '-t', 'vfat', '-o',
                        'ro,nosuid,nodev,noexec,uid=1000,gid=1000,umask=0077',
                        chosen['device'], MOUNT], check=True, timeout=15)
        try:
            def verify_mounted(mode):
                rows = [line.split() for line in Path('/proc/self/mountinfo').read_text().splitlines()]
                mounted = [row for row in rows if len(row) >= 6 and row[4] == MOUNT]
                if len(mounted) != 1 or mounted[0][2] != chosen['majorMinor'] or not {mode, 'nosuid', 'nodev', 'noexec'}.issubset(set(mounted[0][5].split(','))):
                    raise ValueError('Exchange mount verification failed')
                if chosen not in discover_exchange(allow_selected_mount=(MOUNT, chosen['majorMinor'])):
                    raise ValueError('Exchange generation changed while mounting')
            # Validate the kernel-pinned read-only mount before any writable transition.
            verify_mounted('ro')
            subprocess.run(['/usr/bin/busybox', 'mount', '-o', 'remount,rw,nosuid,nodev,noexec', MOUNT], check=True, timeout=15)
            verify_mounted('rw')
            # First application write, after explicit selection and mount checks.
            directory = Path(MOUNT) / 'DriveKey'
            if directory.is_symlink() or (directory.exists() and not directory.is_dir()):
                raise ValueError('Invalid exchange directory')
            directory.mkdir(mode=0o700, exist_ok=True)
        except Exception:
            subprocess.run(['/usr/bin/busybox', 'umount', MOUNT], check=False)
            raise
        return chosen


def picker():
    if sys.platform != 'linux' or os.getuid() != 1000:
        raise ValueError('Unprivileged picker required')
    raw = sys.stdin.read(65537)
    if len(raw) > 65536:
        raise ValueError('Invalid storage inventory')
    choices = json.loads(raw)
    if not isinstance(choices, list) or len(choices) > 256:
        raise ValueError('Invalid storage inventory')
    import tkinter as tk
    root = tk.Tk()
    root.title('DriveKey — Select exchange USB')
    root.configure(bg='#101114')
    root.attributes('-fullscreen', True)
    frame = tk.Frame(root, bg='#101114', padx=48, pady=40)
    frame.pack(fill='both', expand=True)
    def label(text, size=13, color='#c7c9d1'):
        widget = tk.Label(frame, text=text, font=('DejaVu Sans', size), bg='#101114',
                          fg=color, anchor='w', justify='left', wraplength=850)
        widget.pack(fill='x', pady=(0, 16))
    label('Select the exchange USB', 24, '#ffffff')
    label('This candidate is not released for real funds. Use empty storage or fresh unfunded test wallets. Funded submission remains disabled.', 14, '#ffce73')
    label('Choose the data partition on your DriveKey USB or a separate USB FAT volume. Boot partitions and internal disks are excluded. Nothing will be formatted.')
    box = tk.Listbox(frame, font=('DejaVu Sans', 14), bg='#1c1f25', fg='#ffffff',
                     selectbackground='#34567b', height=8, exportselection=False)
    box.pack(fill='both', expand=True, pady=(8, 20))
    for item in choices:
        where = 'same USB data' if item.get('sameBootDisk') else 'separate USB'
        box.insert('end', f"{item['label']}   •   {item['bytes'] / (1024 ** 3):.2f} GiB   •   {item['uuid']}   •   {where}")
    if not choices:
        label('No eligible data volume found. Use the one-USB image with its data partition, or insert a separate FAT USB and choose Refresh.', 13)
    result = {'action': 'shutdown'}
    def finish(value):
        nonlocal result
        result = value
        root.destroy()
    def choose(event=None):
        selected = box.curselection()
        if len(selected) == 1:
            finish({'uuid': choices[selected[0]]['uuid']})
    buttons = tk.Frame(frame, bg='#101114')
    buttons.pack(fill='x')
    use = tk.Button(buttons, text='Use selected USB', command=choose, state='disabled',
                    font=('DejaVu Sans', 14), padx=18, pady=10)
    use.pack(side='left', padx=(0, 16))
    box.bind('<<ListboxSelect>>', lambda event: use.configure(state='normal' if box.curselection() else 'disabled'))
    box.bind('<Return>', choose)
    tk.Button(buttons, text='Refresh', command=lambda: finish({'action': 'refresh'}),
              font=('DejaVu Sans', 14), padx=18, pady=10).pack(side='left')
    tk.Button(buttons, text='Shut down', command=lambda: finish({'action': 'shutdown'}),
              font=('DejaVu Sans', 14), padx=18, pady=10).pack(side='right')
    root.protocol('WM_DELETE_WINDOW', lambda: finish({'action': 'shutdown'}))
    root.bind('<Escape>', lambda event: finish({'action': 'shutdown'}))
    root.update_idletasks()
    print('DRIVEKEY_STORAGE_PICKER_READY', file=sys.stderr, flush=True)
    box.focus_set()
    root.mainloop()
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    if sys.argv[1:] != ['--picker']:
        raise SystemExit('Use through the guarded interactive guest supervisor')
    picker()
