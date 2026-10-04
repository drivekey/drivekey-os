#!/bin/bash
set -euo pipefail
# Operates on regular image files only. Never opens or formats a block device.
[[ $EUID == 0 && $# == 2 ]] || { echo 'Usage: sudo finalize-live-image.sh BASE.iso OUTPUT.iso'; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
base=$(realpath -- "$1")
output=$(realpath -m -- "$2")
[[ -f $base && ! -b $base && ! -e $output && $output != /dev/* ]] || { echo 'Use an existing regular ISO and a NEW output file.'; exit 1; }
work=$(mktemp -d "$source_dir/finalize-XXXXXXXX")
xorriso -osirrox on -indev "$base" -extract /live/filesystem.squashfs "$work/original.squashfs"
unsquashfs -d "$work/root" "$work/original.squashfs"
install -m 755 "$source_dir/drivekey-offline" "$work/root/usr/local/bin/drivekey-offline"
install -m 644 "$source_dir/drivekey-signer.cjs" "$work/root/opt/drivekey/drivekey-signer.cjs"
[[ -f $source_dir/drivekey-gui-worker.cjs && -f $source_dir/drivekey-gui.py && -f $source_dir/drivekey-x-session ]] || { echo 'Graphical signer files are required.'; exit 1; }
# All GUI packages are installed at build time. No downloads at boot.
if ! chroot "$work/root" dpkg-query -W python3-tk xserver-xorg xinit openbox x11-utils >/dev/null 2>&1; then
  cp /etc/resolv.conf "$work/root/etc/resolv.conf"
  printf '#!/bin/sh\nexit 101\n' > "$work/root/usr/sbin/policy-rc.d"
  chmod 755 "$work/root/usr/sbin/policy-rc.d"
  for spec in 'null c 1 3' 'zero c 1 5' 'random c 1 8' 'urandom c 1 9'; do
    read -r name kind major minor <<< "$spec"
    [[ -e $work/root/dev/$name ]] || mknod -m 666 "$work/root/dev/$name" "$kind" "$major" "$minor"
  done
  chroot "$work/root" apt-get update
  chroot "$work/root" /usr/bin/env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3-tk xserver-xorg xinit xauth x11-xserver-utils x11-utils openbox fonts-dejavu-core
  chroot "$work/root" apt-get clean
  # Build-time DNS is not a runtime network configuration.
  : > "$work/root/etc/resolv.conf"
fi
install -m 644 "$source_dir/drivekey-gui-worker.cjs" "$work/root/opt/drivekey/drivekey-gui-worker.cjs"
install -m 644 "$source_dir/drivekey-gui.py" "$work/root/opt/drivekey/drivekey-gui.py"
install -m 755 "$source_dir/drivekey-x-session" "$work/root/usr/local/bin/drivekey-x-session"
[[ -d $source_dir/LICENSES ]] || { echo 'Dependency license directory is required.'; exit 1; }
cp -a "$source_dir/LICENSES" "$work/root/opt/drivekey/"
printf '\nDRIVEKEY OFFLINE PROTOTYPE / TRUSTED CLEAN PC ONLY\nCreate: sudo drivekey-offline create\nCheck password/backup: sudo drivekey-offline check-vault\nSign: sudo drivekey-offline sign\nRestore public file: sudo drivekey-offline export-public\nFully shut down: sudo poweroff\nDo not remove USB while Linux is running. No network downloads are needed.\n\n' > "$work/root/etc/motd"
# live-config's optional user-setup dependency is absent in a minimal image.
# Make a locked, nonpersistent live account; console autologin is intentional.
chroot "$work/root" id user >/dev/null 2>&1 || chroot "$work/root" useradd --create-home --shell /bin/bash user
printf 'user ALL=(ALL) NOPASSWD: ALL\n' > "$work/root/etc/sudoers.d/drivekey-live"
chmod 440 "$work/root/etc/sudoers.d/drivekey-live"
# tty1 is the graphical physical console. Serial consoles retain the CLI for recovery/tests.
mkdir -p "$work/root/etc/profile.d"
# live-config otherwise installs a rootless startx retry loop before .bash_profile.
# Keep the stock component/license intact, but opt out through its documented file guard.
printf '%s\n' '# DriveKey provides its guarded graphical startup in the live user profile.' > "$work/root/etc/profile.d/zz-live-config_xinit.sh"
printf '%s\n' '# DriveKey local graphical session; serial console remains a CLI.' 'if [ "$(tty)" = /dev/tty1 ] && [ -z "${DISPLAY:-}" ]; then' '  sudo startx /usr/local/bin/drivekey-x-session -- :0 -nolisten tcp vt1' 'fi' > "$work/root/home/user/.bash_profile"
chroot "$work/root" chown user:user /home/user/.bash_profile
for unit in getty@tty1 serial-getty@ttyS0; do
  mkdir -p "$work/root/etc/systemd/system/$unit.service.d"
  printf '%s\n' '[Service]' 'ExecStart=' 'ExecStart=-/sbin/agetty --autologin user --noclear %I 115200,38400,9600 vt100' > "$work/root/etc/systemd/system/$unit.service.d/autologin.conf"
done
mksquashfs "$work/root" "$work/filesystem.squashfs" -noappend -comp xz -processors 4
# An empty, writable FAT32 exchange partition travels in the same raw USB image.
truncate -s 64M "$work/exchange.fat"
[[ -f $work/exchange.fat && ! -b $work/exchange.fat ]] || exit 1
mkfs.vfat -F 32 -n DRIVEKEY "$work/exchange.fat"
mmd -i "$work/exchange.fat" ::/DriveKey
printf '%s\n' 'serial 0 115200' 'default drivekey' 'prompt 0' 'timeout 100' 'label drivekey' '  kernel /live/vmlinuz' '  append initrd=/live/initrd.img boot=live components noswap nopersistence hostname=drivekey username=user locales=en_US.UTF-8 keyboard-layouts=us timezone=UTC console=tty0 console=ttyS0,115200n8' > "$work/isolinux.cfg"
printf '%s\n' 'set default=0' 'set timeout=5' 'menuentry "DriveKey offline signer (amd64)" {' '  linux /live/vmlinuz boot=live components noswap nopersistence hostname=drivekey username=user locales=en_US.UTF-8 keyboard-layouts=us timezone=UTC console=tty0 console=ttyS0,115200n8' '  initrd /live/initrd.img' '}' > "$work/grub.cfg"
xorriso -indev "$base" -outdev "$output" \
  -map "$work/filesystem.squashfs" /live/filesystem.squashfs \
  -map "$work/isolinux.cfg" /isolinux/isolinux.cfg \
  -map "$work/grub.cfg" /boot/grub/grub.cfg \
  -volid DRIVEKEY_LIVE \
  -boot_image any replay -append_partition 3 0x0c "$work/exchange.fat" \
  -commit -end
sha256sum "$output" > "$output.sha256"
xorriso -indev "$output" -report_el_torito plain -report_system_area plain > "$output.boot-report.txt" 2>&1
echo "Built regular image: $output. No physical device was accessed."
