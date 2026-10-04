#!/bin/bash
set -euo pipefail
[[ $EUID == 0 && $# == 1 ]] || exit 1
project=$(realpath "$1")
base="$project/outputs/images/drivekey-offline-amd64-v5-desktop-r21-rc20-utc.iso"
output="$project/outputs/images/drivekey-offline-amd64-v5-desktop-r21-rc20-warsaw-rtc.iso"
[[ -f $base && ! -b $base && ! -e $output ]] || exit 1
[[ $(sha256sum "$base" | cut -d ' ' -f1) == ded2266d1a9e99a58343598100af41887da5c525588653b59bd5512300699e4d ]] || exit 1
stage=$(mktemp -d /opt/drivekey-builds/ui-rc20-warsaw-XXXXXXXX)
mkdir -p "$project/work/rc20-warsaw-rtc"
printf '%s\n' "$stage" > "$project/work/rc20-warsaw-rtc/build-directory.txt"
xorriso -osirrox on -indev "$base" -extract /live/filesystem.squashfs "$stage/base.squashfs"
unsquashfs -d "$stage/root" "$stage/base.squashfs"
for file in drivekey-desktop.py drivekey_settings.py drivekey-terminal.py drivekey_rtc.py; do
 install -m 644 "$project/packaging/$file" "$stage/root/opt/drivekey/$file"
done
for file in drivekey drivekey-desktop-start drivekey-desktop-session; do
 install -m 755 "$project/packaging/$file" "$stage/root/usr/local/bin/$file"
done
for file in drivekey-signer.cjs drivekey-gui-worker.cjs; do
 install -m 644 "$project/work/rc20-warsaw-rtc/$file" "$stage/root/opt/drivekey/$file"
done
printf 'Europe/Warsaw\n' > "$stage/root/etc/drivekey-rtc-zone"
chmod 644 "$stage/root/etc/drivekey-rtc-zone"
printf '%s\n' 'drivekey-offline-amd64-v5-desktop-r21-rc20-warsaw-rtc.iso' > "$stage/root/opt/drivekey/release-name.txt"
# Keep UTC presentation; the fixed boot helper interprets local RTC without writing it.
chroot "$stage/root" visudo -c
chroot "$stage/root" python3 -c 'import ast; from pathlib import Path; [ast.parse(p.read_text()) for p in Path("/opt/drivekey").glob("*.py")]'
for file in drivekey drivekey-desktop-start drivekey-desktop-session; do bash -n "$stage/root/usr/local/bin/$file"; done
mksquashfs "$stage/root" "$stage/filesystem.squashfs" -noappend -comp xz -processors 4
xorriso -indev "$base" -outdev "$output" -map "$stage/filesystem.squashfs" /live/filesystem.squashfs -boot_image any replay -commit -end
sha256sum "$output" > "$output.sha256"
xorriso -indev "$output" -report_el_torito plain -report_system_area plain > "$output.boot-report.txt" 2>&1
