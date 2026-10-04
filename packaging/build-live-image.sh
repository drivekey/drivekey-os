#!/bin/bash
set -euo pipefail
# Image-file builder only. It never selects, formats, or flashes a disk.
# Prerequisite: an existing Debian 13 amd64 build machine with live-build installed.
[[ $EUID == 0 ]] || { echo 'Run with sudo on a Debian build machine.'; exit 1; }
command -v lb >/dev/null || { echo 'Install live-build on the separate build machine first.'; exit 1; }
[[ $(dpkg --print-architecture) == amd64 ]] || { echo 'An amd64 builder is required.'; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
archive=node-v22.23.2-linux-x64.tar.xz
cd "$source_dir"
echo "d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307  $archive" | sha256sum -c -
[[ -f drivekey-signer.cjs && -f drivekey-gui-worker.cjs && -f drivekey-gui.py && -f drivekey-x-session && -f drivekey-offline && -f finalize-live-image.sh ]] || { echo 'Extract the full graphical offline source bundle first.'; exit 1; }
build_dir=$(mktemp -d "$source_dir/live-build-XXXXXXXX")
cd "$build_dir"
lb config --mode debian --distribution trixie --architectures amd64 --binary-images iso-hybrid --debian-installer none --archive-areas main --apt-recommends false --security true --mirror-bootstrap https://deb.debian.org/debian --mirror-chroot https://deb.debian.org/debian --mirror-chroot-security https://security.debian.org/debian-security --mirror-binary https://deb.debian.org/debian --mirror-binary-security https://security.debian.org/debian-security --bootappend-live 'boot=live components noswap nopersistence hostname=drivekey username=user locales=en_US.UTF-8 keyboard-layouts=us timezone=UTC console=tty0 console=ttyS0,115200n8'
mkdir -p config/package-lists config/includes.chroot/opt/drivekey/node config/includes.chroot/usr/local/bin config/includes.chroot/etc/systemd/system config/includes.chroot/etc/security/limits.d config/includes.chroot/etc/sysctl.d
printf '%s\n' linux-image-amd64 live-boot live-config live-config-systemd systemd-sysv iproute2 util-linux rfkill exfatprogs dosfstools sudo locales less > config/package-lists/drivekey.list.chroot
tar -xJf "$source_dir/$archive" --strip-components=1 -C config/includes.chroot/opt/drivekey/node
cp "$source_dir/drivekey-signer.cjs" config/includes.chroot/opt/drivekey/
cp "$source_dir/drivekey-offline" config/includes.chroot/usr/local/bin/
chmod 755 config/includes.chroot/usr/local/bin/drivekey-offline
touch config/includes.chroot/etc/drivekey-live
printf '\nDRIVEKEY OFFLINE PROTOTYPE / TRUSTED CLEAN PC ONLY\nCreate vault: sudo drivekey-offline create\nSign request: sudo drivekey-offline sign\nRestore public file: sudo drivekey-offline export-public\nFully shut down with: sudo poweroff\nNever remove USB while this live system is running.\n\n' > config/includes.chroot/etc/motd
printf '* hard core 0\n* soft core 0\n' > config/includes.chroot/etc/security/limits.d/99-drivekey.conf
printf 'kernel.core_pattern=|/bin/false\n' > config/includes.chroot/etc/sysctl.d/99-drivekey.conf
for service in NetworkManager.service systemd-networkd.service systemd-networkd.socket networking.service wpa_supplicant.service systemd-coredump.socket; do
  ln -s /dev/null "config/includes.chroot/etc/systemd/system/$service"
done
# No signer dependencies are fetched at first boot. Live-build itself fetches OS packages here.
lb build
bash "$source_dir/finalize-live-image.sh" "$build_dir/live-image-amd64.hybrid.iso" "$build_dir/drivekey-offline-amd64-v3.iso"
printf '\nImage output: %s/drivekey-offline-amd64-v3.iso\n' "$build_dir"
echo 'Includes an empty DRIVEKEY FAT32 partition. Physical hardware remains unverified. Never flash an unidentified disk.'
