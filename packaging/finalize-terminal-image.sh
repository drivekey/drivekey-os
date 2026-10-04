#!/bin/bash
set -euo pipefail
# Repack a known v3 regular ISO. No block devices, physical mounts or vaults.
[[ $EUID == 0 && $# == 2 ]] || exit 1
src=$(cd -- "$(dirname -- "$0")" && pwd)
base=$(realpath "$1"); output=$(realpath -m "$2")
[[ -f $base && ! -b $base && ! -e $output && $output != /dev/* ]] || exit 1
work=$(mktemp -d /opt/drivekey-builds/terminal-v4-XXXXXXXX)
xorriso -osirrox on -indev "$base" -extract /live/filesystem.squashfs "$work/original.squashfs"
unsquashfs -d "$work/root" "$work/original.squashfs"
for name in drivekey drivekey-isolate; do install -m 755 "$src/$name" "$work/root/usr/local/bin/$name"; done
for name in drivekey-terminal.py drivekey_clock.py drivekey_dashboard.py drivekey_workspace.py drivekey-gui-worker.cjs logo.txt logo-ascii.txt logo-large.txt; do install -m 644 "$src/$name" "$work/root/opt/drivekey/$name"; done
cp -R "$src/chain-icons" "$work/root/opt/drivekey/chain-icons"
if [[ -f $src/release-name.txt ]]; then install -m 644 "$src/release-name.txt" "$work/root/opt/drivekey/release-name.txt"; fi
ln -snf /usr/share/zoneinfo/UTC "$work/root/etc/localtime"
printf 'UTC\n' > "$work/root/etc/timezone"
ln -snf /dev/null "$work/root/etc/systemd/system/hwclock-save.service"
chroot "$work/root" python3 -c 'from zoneinfo import ZoneInfo; ZoneInfo("UTC")'
if [[ -f $src/THIRD-PARTY-NOTICES.txt ]]; then install -m 644 "$src/THIRD-PARTY-NOTICES.txt" "$work/root/opt/drivekey/THIRD-PARTY-NOTICES-multi.txt"; fi
chroot "$work/root" python3 -c 'import curses'
printf '%s\n' '[Unit]' 'Description=DriveKey fail-closed network isolation' 'After=systemd-udev-settle.service' 'Before=getty@tty1.service serial-getty@ttyS0.service' '[Service]' 'Type=oneshot' 'ExecStart=/usr/local/bin/drivekey-isolate' 'RemainAfterExit=yes' > "$work/root/etc/systemd/system/drivekey-isolate.service"
for unit in getty@tty1 serial-getty@ttyS0; do
  mkdir -p "$work/root/etc/systemd/system/$unit.service.d"
  printf '%s\n' '[Unit]' 'Requires=drivekey-isolate.service' 'After=drivekey-isolate.service' > "$work/root/etc/systemd/system/$unit.service.d/isolation.conf"
done
printf '%s\n' '# DriveKey terminal owns startup; no X auto-start.' > "$work/root/etc/profile.d/zz-live-config_xinit.sh"
printf '%s\n' 'export LANG=en_US.UTF-8 TERM=linux TZ=UTC' 'case "$(tty)" in /dev/tty1)' ' drivekey' ' ;; esac' > "$work/root/home/user/.bash_profile"
chroot "$work/root" chown user:user /home/user/.bash_profile
# Restrict routine privilege escalation; diagnostic shell remains an unprivileged shell.
printf '%s\n' 'user ALL=(root) NOPASSWD: /usr/local/bin/drivekey, /usr/local/bin/drivekey-offline, /sbin/poweroff' > "$work/root/etc/sudoers.d/drivekey-live"
chmod 440 "$work/root/etc/sudoers.d/drivekey-live"
chroot "$work/root" visudo -cf /etc/sudoers.d/drivekey-live
printf 'DriveKey offline workspace. Run drivekey for the menu.\n' > "$work/root/etc/motd"
mksquashfs "$work/root" "$work/filesystem.squashfs" -noappend -comp xz -processors 4
truncate -s 64M "$work/exchange.fat"
mkfs.vfat -F 32 -n DRIVEKEY "$work/exchange.fat"
mmd -i "$work/exchange.fat" ::/DriveKey
xorriso -indev "$base" -outdev "$output" -map "$work/filesystem.squashfs" /live/filesystem.squashfs -boot_image any replay -append_partition 3 0x0c "$work/exchange.fat" -commit -end
sha256sum "$output" > "$output.sha256"
xorriso -indev "$output" -report_el_torito plain -report_system_area plain > "$output.boot-report.txt" 2>&1
echo "$work"
