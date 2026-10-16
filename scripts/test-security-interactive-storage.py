#!/usr/bin/python3
"""Storage selection checks using isolated fake sysfs; never mounts a disk."""
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('storage', Path(__file__).with_name('security-interactive-storage.py'))
storage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(storage)


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'sys/class/block').mkdir(parents=True)
        (self.root / 'proc/self').mkdir(parents=True)
        (self.root / 'proc/self/mountinfo').write_text('1 0 0:1 / / ro - squashfs /dev/loop0 ro\n')
        self.metadata = {}
        self.numbers = {}

    def tearDown(self):
        self.temp.cleanup()

    def add(self, name, number, uuid='1234-ABCD', usb=True, disk=None, readonly=False,
            start=2048, sectors=131072, partition_number=1, parent_sectors=4194304):
        bus = 'usb1/1-1/1-1:1.0/host0' if usb else 'pci0000:00/ata1/host0'
        family = self.root / 'sys/devices' / bus / 'block' / (disk or name)
        node = family / name if disk else family
        node.mkdir(parents=True)
        if not (family / 'diskseq').exists():
            (family / 'diskseq').write_text(str(int(number.split(':')[1]) + 1))
        (family / 'size').write_text(str(parent_sectors))
        if disk:
            (node / 'partition').write_text(str(partition_number))
            (node / 'start').write_text(str(start))
        (node / 'dev').write_text(number)
        (node / 'ro').write_text('1' if readonly else '0')
        (node / 'size').write_text(str(sectors))
        (self.root / 'sys/class/block' / name).symlink_to(node)
        self.metadata[name] = f'TYPE=vfat\nUUID={uuid}\nLABEL=TEST\n'
        self.numbers[name] = number

    def probe(self, args, **kwargs):
        return types.SimpleNamespace(returncode=0, stdout=self.metadata[Path(args[-1]).name])

    def device_stat(self, path, **kwargs):
        major, minor = map(int, self.numbers[Path(path).name].split(':'))
        return types.SimpleNamespace(st_mode=stat.S_IFBLK | 0o600, st_rdev=os.makedev(major, minor))

    def discover(self):
        return storage.discover_exchange(self.root, self.probe, self.device_stat)

    def single_usb(self):
        self.add('sda', '8:0', sectors=4194304)
        self.metadata['sda'] = 'TYPE=iso9660\nLABEL=DKI_TEST\n'
        self.add('sda1', '8:1', disk='sda', start=64, sectors=229332,
                 uuid='1111-AAAA')
        self.add('sda5', '8:5', disk='sda', start=524288, sectors=1570816,
                 partition_number=5, uuid='5555-EEEE')
        (self.root / 'etc').mkdir()
        (self.root / 'etc/drivekey-boot-layout.json').write_text(json.dumps(storage.BOOT_LAYOUT))
        (self.root / 'etc/drivekey-interactive-image').write_text('interactive-test\n')
        (self.root / 'run').mkdir()
        loop = self.root / 'sys/devices/virtual/block/loop0'
        (loop / 'loop').mkdir(parents=True)
        (loop / 'dev').write_text('7:0')
        (loop / 'ro').write_text('1')
        (loop / 'loop/backing_file').write_text('/dev/sda')
        (loop / 'loop/offset').write_text('0')
        (loop / 'loop/sizelimit').write_text('268435456')
        (self.root / 'sys/class/block/loop0').symlink_to(loop)
        family = storage.disk_family(self.root / 'sys/class/block/sda')
        captured = {'schemaVersion': 1, 'bootMajorMinor': '7:0', 'familyMajorMinor': '8:0',
                    'diskseq': int((family / 'diskseq').read_text()), 'mountId': '9',
                    'sysfsFamily': '/' + str(family.relative_to(self.root)), 'imageId': 'interactive-test',
                    'sourceDevice': '/dev/sda', 'sourceMajorMinor': '8:0',
                    'loopDevice': '/dev/loop0', 'loopOffsetBytes': 0, 'loopSizeLimitBytes': 268435456}
        metadata = self.root / 'run/drivekey-boot-device.json'
        metadata.write_text(json.dumps(captured))
        metadata.chmod(0o600)
        (self.root / 'proc/self/mountinfo').write_text(
            '9 0 7:0 / /run/boot-source ro,nosuid,nodev,noexec - iso9660 /dev/loop0 ro\n')

    def test_exact_same_usb_data_partition_only(self):
        self.single_usb()
        found = self.discover()
        self.assertEqual([item['device'] for item in found], ['/dev/sda5'])
        self.assertTrue(found[0]['sameBootDisk'])
        self.assertEqual(found[0]['startBytes'], 268435456)
        self.assertEqual(found[0]['bytes'], 804257792)
        self.assertEqual(found[0]['bootMountId'], '9')

    def test_same_usb_without_immutable_policy_keeps_old_exclusion(self):
        self.single_usb()
        (self.root / 'etc/drivekey-boot-layout.json').unlink()
        # Historical images used a direct ISO mount, before bounded loop support.
        (self.root / 'proc/self/mountinfo').write_text(
            '9 0 8:0 / /run/boot-source ro,nosuid,nodev,noexec - iso9660 /dev/sda ro\n')
        self.assertEqual(self.discover(), [])

    def test_same_usb_duplicate_uuid_on_other_disk_is_not_selected(self):
        self.single_usb()
        self.add('sdb', '8:16', uuid='5555-eeee')
        self.assertEqual(self.discover(), [])

    def test_boot_mount_replacement_rejects_new_selection(self):
        self.single_usb()
        before = self.discover()[0]
        mountinfo = self.root / 'proc/self/mountinfo'
        mountinfo.write_text(mountinfo.read_text().replace('9 0 7:0', '19 0 7:0'))
        self.assertEqual(before['bootMountId'], '9')
        self.assertEqual(self.discover(), [])

    def test_boot_disk_replacement_before_initial_inventory_is_not_fresh_baseline(self):
        self.single_usb()
        family = storage.disk_family(self.root / 'sys/class/block/sda')
        (family / 'diskseq').write_text(str(int((family / 'diskseq').read_text()) + 1))
        # Same mount id, dev_t, sysfs path, FAT UUID and geometry; different disk.
        self.assertEqual(self.discover(), [])

    def test_missing_captured_boot_identity_keeps_boot_disk_excluded(self):
        self.single_usb()
        (self.root / 'run/drivekey-boot-device.json').unlink()
        self.assertEqual(self.discover(), [])

    def test_captured_boot_identity_is_bound_to_image_family_and_mount(self):
        self.single_usb()
        path = self.root / 'run/drivekey-boot-device.json'
        captured = json.loads(path.read_text())
        for key, value in [('bootMajorMinor', '8:16'), ('familyMajorMinor', '8:16'),
                           ('sysfsFamily', '/sys/devices/usb2/other'),
                           ('mountId', '10'), ('sourceMajorMinor', '8:16'),
                           ('sourceDevice', '/dev/sdb'), ('loopDevice', '/dev/loop1')]:
            with self.subTest(field=key):
                path.write_text(json.dumps(dict(captured, **{key: value})))
                self.assertEqual(self.discover(), [])
        path.write_text(json.dumps(dict(captured, imageId='another-image')))
        with self.assertRaisesRegex(ValueError, 'Invalid boot device metadata'):
            self.discover()
        path.write_text(json.dumps(captured))

    def test_untrusted_loop_never_falls_back_to_efi_or_separate_usb(self):
        self.single_usb()
        self.add('sdb', '8:16', uuid='BBBB-CCCC')
        loop = self.root / 'sys/class/block/loop0'
        for name, changed in [('ro', '0'), ('loop/backing_file', '/dev/sdb'),
                              ('loop/offset', '512'), ('loop/sizelimit', '0'),
                              ('loop/sizelimit', '268435457')]:
            with self.subTest(field=name, value=changed):
                path = loop / name
                original = path.read_text()
                path.write_text(changed)
                try:
                    if name == 'loop/sizelimit' and changed == '0':
                        with self.assertRaisesRegex(ValueError, 'geometry'):
                            self.discover()
                    else:
                        self.assertEqual(self.discover(), [])
                finally:
                    path.write_text(original)
        self.assertEqual([item['device'] for item in self.discover()], ['/dev/sda5', '/dev/sdb'])

    def test_missing_loop_attributes_never_fall_back_to_efi_or_separate_usb(self):
        self.single_usb()
        self.add('sdb', '8:16', uuid='BBBB-CCCC')
        path = self.root / 'sys/class/block/loop0/loop/backing_file'
        path.unlink()
        self.assertEqual(self.discover(), [])

    def test_missing_captured_identity_blocks_separate_usb_under_loop_policy(self):
        self.single_usb()
        self.add('sdb', '8:16', uuid='BBBB-CCCC')
        (self.root / 'run/drivekey-boot-device.json').unlink()
        self.assertEqual(self.discover(), [])

    def test_captured_loop_bounds_are_strict_integers_and_exact(self):
        self.single_usb()
        path = self.root / 'run/drivekey-boot-device.json'
        captured = json.loads(path.read_text())
        for key, value in [('loopOffsetBytes', False), ('loopOffsetBytes', 512),
                           ('loopSizeLimitBytes', '268435456'), ('loopSizeLimitBytes', 268435457)]:
            with self.subTest(field=key, value=value):
                path.write_text(json.dumps(dict(captured, **{key: value})))
                with self.assertRaisesRegex(ValueError, 'Invalid boot device metadata'):
                    self.discover()
        path.write_text(json.dumps(captured))

    def test_loop_prefix_is_relative_to_whole_physical_disk(self):
        self.single_usb()
        # A zero loop offset over a partition does not prove disk offset zero.
        path = self.root / 'run/drivekey-boot-device.json'
        captured = json.loads(path.read_text())
        captured.update(sourceDevice='/dev/sda1', sourceMajorMinor='8:1')
        path.write_text(json.dumps(captured))
        (self.root / 'sys/class/block/loop0/loop/backing_file').write_text('/dev/sda1')
        self.assertEqual(self.discover(), [])

    def test_policy_boolean_does_not_stand_in_for_integer_schema_version(self):
        self.single_usb()
        value = dict(storage.BOOT_LAYOUT, schemaVersion=True)
        (self.root / 'etc/drivekey-boot-layout.json').write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, 'Unsupported'):
            self.discover()

    def test_mutable_or_wrong_policy_is_rejected(self):
        self.single_usb()
        policy = self.root / 'etc/drivekey-boot-layout.json'
        policy.chmod(0o666)
        with self.assertRaisesRegex(ValueError, 'Untrusted'):
            self.discover()
        policy.chmod(0o644)
        value = dict(storage.BOOT_LAYOUT, exchangeStartBytes=0)
        policy.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, 'Unsupported'):
            self.discover()

    def test_same_usb_other_mounted_sibling_blocks_family(self):
        self.single_usb()
        mountinfo = self.root / 'proc/self/mountinfo'
        mountinfo.write_text(mountinfo.read_text() + '10 0 8:1 / /other ro - vfat /dev/sda1 ro\n')
        self.assertEqual(self.discover(), [])

    def test_same_usb_boot_mount_must_be_readonly_iso_with_required_flags(self):
        self.single_usb()
        mountinfo = self.root / 'proc/self/mountinfo'
        original = mountinfo.read_text()
        for changed in (original.replace('ro,nosuid', 'rw,nosuid'),
                        original.replace('iso9660', 'vfat'),
                        original.replace(',nodev', ''),
                        original + original):
            mountinfo.write_text(changed)
            self.assertEqual(self.discover(), [])

    def test_same_usb_wrong_partition_geometry_is_rejected(self):
        self.single_usb()
        partition = self.root / 'sys/class/block/sda5'
        for name, bad in [('start', '524287'), ('start', '524289'),
                          ('size', '1570815'), ('size', '1570817'), ('partition', '6')]:
            original = (partition / name).read_text()
            (partition / name).write_text(bad)
            self.assertEqual(self.discover(), [])
            (partition / name).write_text(original)

    def test_same_usb_overlapping_sibling_is_rejected(self):
        self.single_usb()
        self.add('sda6', '8:6', disk='sda', start=524287, sectors=2,
                 partition_number=6, uuid='6666-FFFF')
        self.assertEqual(self.discover(), [])

    def test_same_usb_adjacent_nonoverlapping_sibling_is_allowed(self):
        self.single_usb()
        self.add('sda6', '8:6', disk='sda', start=2095104, sectors=1024,
                 partition_number=6, uuid='6666-FFFF')
        self.assertEqual([item['device'] for item in self.discover()], ['/dev/sda5'])

    def test_partition_outside_parent_disk_and_invalid_bounds_are_rejected(self):
        self.single_usb()
        family = storage.disk_family(self.root / 'sys/class/block/sda5')
        (family / 'size').write_text('1048576')
        with self.assertRaisesRegex(ValueError, 'exceeds'):
            self.discover()
        (family / 'size').write_text('4194304')
        (self.root / 'sys/class/block/sda5/start').write_text('-1')
        with self.assertRaisesRegex(ValueError, 'geometry'):
            self.discover()

    def test_partition_geometry_change_is_part_of_selection_identity(self):
        self.add('sdb', '8:16', sectors=4194304)
        self.metadata['sdb'] = 'TYPE=ext4\n'
        self.add('sdb1', '8:17', disk='sdb')
        before = self.discover()[0]
        (self.root / 'sys/class/block/sdb1/start').write_text('4096')
        after = self.discover()[0]
        self.assertNotEqual(before, after)
        self.assertEqual(before['diskseq'], after['diskseq'])

    def test_same_usb_selected_mount_exception_does_not_allow_other_mounts(self):
        self.single_usb()
        mountinfo = self.root / 'proc/self/mountinfo'
        mountinfo.write_text(mountinfo.read_text() + '10 0 8:5 / /mnt/drivekey ro,nosuid,nodev,noexec - vfat /dev/sda5 ro\n')
        self.assertEqual(self.discover(), [])
        found = storage.discover_exchange(self.root, self.probe, self.device_stat,
                                         allow_selected_mount=('/mnt/drivekey', '8:5'))
        self.assertEqual([item['device'] for item in found], ['/dev/sda5'])
        mountinfo.write_text(mountinfo.read_text() + '11 0 8:5 / /unexpected ro - vfat /dev/sda5 ro\n')
        self.assertEqual(storage.discover_exchange(self.root, self.probe, self.device_stat,
                                                   allow_selected_mount=('/mnt/drivekey', '8:5')), [])

    def test_only_unique_unmounted_writable_usb_fat_is_offered(self):
        self.add('sda', '8:0', usb=False)
        self.add('sdb', '8:16', readonly=True)
        self.add('sdc', '8:32', uuid='AABB-CCDD')
        self.add('sdd', '8:48', uuid='EEEE-FFFF')
        self.metadata['sdd'] = 'TYPE=ext4\nUUID=EEEE-FFFF\n'
        self.assertEqual([item['device'] for item in self.discover()], ['/dev/sdc'])

    def test_all_partitions_of_mounted_boot_disk_are_excluded(self):
        self.add('sda1', '8:1', disk='sda', uuid='1111-AAAA')
        self.add('sda2', '8:2', disk='sda', uuid='2222-BBBB')
        self.add('sdb1', '8:17', disk='sdb', uuid='3333-CCCC')
        (self.root / 'proc/self/mountinfo').write_text('1 0 8:1 / /run/boot-source ro - iso9660 /dev/sda1 ro\n')
        self.assertEqual([item['device'] for item in self.discover()], ['/dev/sdb1'])

    def test_duplicate_fat_uuid_does_not_choose_arbitrarily(self):
        self.add('sda', '8:0', uuid='AAAA-BBBB')
        self.add('sdb', '8:16', uuid='aaaa-bbbb')
        self.assertEqual(self.discover(), [])

    def test_device_node_replacement_is_not_offered(self):
        self.add('sda', '8:0')
        self.numbers['sda'] = '8:16'
        self.assertEqual(self.discover(), [])

    def test_malformed_uuid_and_control_label_are_bounded(self):
        self.add('sda', '8:0', uuid='../../other')
        self.assertEqual(self.discover(), [])
        self.assertEqual(storage.public_label('A\x1b[31m\tB\n' + 'X' * 200), 'A[31mB' + 'X' * 34)

    def test_disconnected_sysfs_device_is_not_a_fallback(self):
        self.add('sda', '8:0')
        (self.root / 'sys/class/block/sda/dev').unlink()
        self.assertEqual(self.discover(), [])

    def test_replacement_after_explicit_selection_fails_before_mount(self):
        selected = {'uuid': '1234-ABCD', 'device': '/dev/sda', 'majorMinor': '8:0'}
        with patch.object(storage, 'require_guest'), patch.object(storage, 'discover_exchange', side_effect=[[selected], []]), patch.object(storage.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'changed during selection'):
                storage.select_and_mount_exchange({}, '1234-ABCD')
            run.assert_not_called()

    def test_missing_explicit_uuid_does_not_mount_a_different_usb(self):
        selected = {'uuid': '1234-ABCD', 'device': '/dev/sda'}
        with patch.object(storage, 'require_guest'), patch.object(storage, 'discover_exchange', return_value=[selected]), patch.object(storage.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'not a unique'):
                storage.select_and_mount_exchange({}, '5678-EFAB')
            run.assert_not_called()

    def test_reinserted_same_port_device_has_a_different_generation(self):
        self.add('sda', '8:0')
        before = self.discover()[0]
        (self.root / 'sys/class/block/sda/diskseq').write_text('2')
        after = self.discover()[0]
        self.assertEqual({k: v for k, v in before.items() if k != 'diskseq'}, {k: v for k, v in after.items() if k != 'diskseq'})
        self.assertNotEqual(before, after)

    def test_replacement_during_mount_unmounts_before_application_write(self):
        mount = self.root / 'exchange'
        mount.mkdir()
        selected = {'uuid': '1234-ABCD', 'device': '/dev/sda', 'majorMinor': '8:0', 'diskseq': 1}
        replacement = dict(selected, diskseq=2)
        metadata = self.root / 'proc/self/mountinfo'
        metadata.write_text(f'1 0 8:0 / {mount} ro,nosuid,nodev,noexec - vfat /dev/sda ro\n')
        def mapped_path(name):
            return metadata if name == '/proc/self/mountinfo' else Path(name)
        with patch.object(storage, 'require_guest'), patch.object(storage, 'MOUNT', str(mount)), patch.object(storage, 'Path', side_effect=mapped_path), patch.object(storage, 'discover_exchange', side_effect=[[selected], [selected], [replacement]]), patch.object(storage.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'generation changed'):
                storage.select_and_mount_exchange({}, '1234-ABCD')
            self.assertEqual(run.call_count, 2)
            self.assertEqual(run.call_args.args[0], ['/usr/bin/busybox', 'umount', str(mount)])
            self.assertFalse((mount / 'DriveKey').exists())

    def test_partition_geometry_change_during_readonly_mount_never_enables_writes(self):
        self.single_usb()
        selected = self.discover()[0]
        replacement = dict(selected, startBytes=selected['startBytes'] - 512)
        mount = self.root / 'exchange'
        mount.mkdir()
        metadata = self.root / 'proc/self/mountinfo'
        metadata.write_text(f'10 0 8:5 / {mount} ro,nosuid,nodev,noexec - vfat /dev/sda5 ro\n')
        def mapped_path(name):
            return metadata if name == '/proc/self/mountinfo' else Path(name)
        with patch.object(storage, 'require_guest'), patch.object(storage, 'MOUNT', str(mount)), patch.object(storage, 'Path', side_effect=mapped_path), patch.object(storage, 'discover_exchange', side_effect=[[selected], [selected], [replacement]]), patch.object(storage.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'generation changed'):
                storage.select_and_mount_exchange({}, selected['uuid'])
            self.assertEqual(run.call_count, 2)
            self.assertIn('ro,nosuid,nodev,noexec,uid=1000,gid=1000,umask=0077', run.call_args_list[0].args[0])
            self.assertEqual(run.call_args.args[0], ['/usr/bin/busybox', 'umount', str(mount)])
            self.assertFalse((mount / 'DriveKey').exists())


if __name__ == '__main__':
    unittest.main()
