#!/bin/bash
set -euo pipefail
# WSL/Linux build host. Regular files only; never flash or mount physical media.
[[ $EUID == 0 && $# -ge 1 && $# -le 2 ]] || { echo 'Usage: build-desktop-image.sh PROJECT [NEW_NAME.iso]'; exit 1; }
project=$(realpath "$1")
name=${2:-drivekey-offline-amd64-v5-desktop-r20.iso}
[[ $name =~ ^drivekey-offline-amd64-v5-desktop-r[0-9]+(-rc[0-9]+)?\.iso$ ]] || exit 1
base="$project/outputs/images/drivekey-offline-amd64-v5-experimental-r13.iso"
output="$project/outputs/images/$name"
[[ -f $base && ! -b $base && ! -e $output ]] || exit 1
work=$(mktemp -d /opt/drivekey-builds/desktop-r14-XXXXXXXX)
echo "BUILD_WORK=$work"
xorriso -osirrox on -indev "$base" -extract /live/filesystem.squashfs "$work/base.squashfs"
unsquashfs -d "$work/root" "$work/base.squashfs"
cp /etc/resolv.conf "$work/root/etc/resolv.conf"
printf '#!/bin/sh\nexit 101\n' > "$work/root/usr/sbin/policy-rc.d"
chmod 755 "$work/root/usr/sbin/policy-rc.d"
chroot "$work/root" apt-get update
chroot "$work/root" env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends qrencode xterm python3-pil.imagetk
chroot "$work/root" apt-get clean
: > "$work/root/etc/resolv.conf"
for namefile in drivekey-desktop-start drivekey-desktop-xsession drivekey-desktop-session drivekey-desktop-clock; do
  install -m 755 "$project/packaging/$namefile" "$work/root/usr/local/bin/$namefile"
  sed -i 's/\r$//' "$work/root/usr/local/bin/$namefile"
done
install -m 644 "$project/packaging/drivekey-desktop.py" "$work/root/opt/drivekey/drivekey-desktop.py"
install -m 644 "$project/packaging/drivekey_character_field.py" "$work/root/opt/drivekey/drivekey_character_field.py"
install -m 644 "$project/packaging/drivekey_widgets.py" "$work/root/opt/drivekey/drivekey_widgets.py"
install -d -m 755 "$work/root/opt/drivekey/ui-icons"
install -m 644 "$project/packaging/ui-icons/"*.png "$project/packaging/ui-icons/"*LICENSE* "$project/packaging/ui-icons/PROVENANCE.json" "$work/root/opt/drivekey/ui-icons/"
install -D -m 644 "$project/public/brand/mark.png" "$work/root/opt/drivekey/brand/mark.png"
install -m 644 "$project/outputs/desktop-r14/drivekey-gui-worker.cjs" "$work/root/opt/drivekey/drivekey-gui-worker.cjs"
printf '%s\n' "$name" > "$work/root/opt/drivekey/release-name.txt"
printf '%s\n' 'export LANG=en_US.UTF-8 TZ=UTC' 'if [ "$(tty)" = /dev/tty1 ] && [ -z "${DISPLAY:-}" ]; then' ' sudo -n /usr/local/bin/drivekey-desktop-start' 'fi' > "$work/root/home/user/.bash_profile"
chroot "$work/root" chown user:user /home/user/.bash_profile
printf '%s\n' 'Defaults env_reset' 'user ALL=(root) NOPASSWD: /usr/local/bin/drivekey-desktop-start "", /usr/local/bin/drivekey-desktop-clock "", /usr/local/bin/drivekey, /sbin/poweroff ""' > "$work/root/etc/sudoers.d/drivekey-live"
chmod 440 "$work/root/etc/sudoers.d/drivekey-live"
# The stock live-config sudo component explicitly skips an existing user rule here.
# Preserve its source/license; preconfigure its documented file guard with narrow rights.
printf '%s\n' 'user ALL=(root) NOPASSWD: /sbin/poweroff ""' > "$work/root/etc/sudoers.d/live"
chmod 440 "$work/root/etc/sudoers.d/live"
chroot "$work/root" gpasswd -d user sudo 2>/dev/null || true
# live-config must not reinstate a broad sudo rule at boot.
mkdir -p "$work/root/etc/live/config.conf.d"
printf '%s\n' 'LIVE_CONFIG_NOAUTOLOGIN=""' 'LIVE_CONFIG_NOCOMPONENTS="sudo"' > "$work/root/etc/live/config.conf.d/99-drivekey-privileges.conf"
chroot "$work/root" visudo -cf /etc/sudoers.d/drivekey-live
chroot "$work/root" visudo -c
chroot "$work/root" python3 -c 'import tkinter; from PIL import Image, ImageTk; import ast; ast.parse(open("/opt/drivekey/drivekey-desktop.py").read()); Image.open("/opt/drivekey/brand/mark.png").verify()'
chroot "$work/root" dpkg-query -W > "$project/outputs/desktop-r14/packages.txt"
cp "$project/LICENSE" "$work/root/opt/drivekey/LICENSES/DriveKey.txt"
# Original notices and Debian /usr/share/doc copyright files remain in the image.
mksquashfs "$work/root" "$work/filesystem.squashfs" -noappend -comp xz -processors 4
truncate -s 64M "$work/exchange.fat"
mkfs.vfat -F 32 -n DRIVEKEY "$work/exchange.fat"
mmd -i "$work/exchange.fat" ::/DriveKey
xorriso -indev "$base" -outdev "$output" -map "$work/filesystem.squashfs" /live/filesystem.squashfs -boot_image any replay -append_partition 3 0x0c "$work/exchange.fat" -commit -end
sha256sum "$output" | tee "$output.sha256"
xorriso -indev "$output" -report_el_torito plain -report_system_area plain > "$output.boot-report.txt" 2>&1
printf '%s\n' "$work" > "$project/outputs/desktop-r14/build-work.txt"
echo 'Desktop candidate built; public downloads unchanged.'
