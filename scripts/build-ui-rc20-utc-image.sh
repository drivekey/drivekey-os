#!/bin/bash
set -euo pipefail
[[ $EUID == 0 && $# == 1 ]] || exit 1
project=$(realpath "$1")
base="$project/outputs/images/drivekey-offline-amd64-v5-desktop-r21-rc20-simple.iso"
output="$project/outputs/images/drivekey-offline-amd64-v5-desktop-r21-rc20-utc.iso"
[[ -f $base && ! -b $base && ! -e $output ]] || exit 1
[[ $(sha256sum "$base" | cut -d ' ' -f1) == 8d5066ad32ce050f154df61ce5508d4925703a4bc1c6a2f47aeab0f2dda6e9f6 ]] || exit 1
stage=$(mktemp -d /opt/drivekey-builds/ui-rc20-utc-XXXXXXXX)
mkdir -p "$project/work/rc20-utc"
printf '%s\n' "$stage" > "$project/work/rc20-utc/build-directory.txt"
xorriso -osirrox on -indev "$base" -extract /live/filesystem.squashfs "$stage/base.squashfs"
unsquashfs -d "$stage/root" "$stage/base.squashfs"
for file in drivekey-desktop.py drivekey_settings.py drivekey-terminal.py drivekey_workspace.py drivekey_clock.py; do
 install -m 644 "$project/packaging/$file" "$stage/root/opt/drivekey/$file"
done
# No privileged time setter is shipped or authorized in this release.
rm -f "$stage/root/usr/local/bin/drivekey-desktop-clock"
printf '%s\n' 'Defaults env_reset' 'user ALL=(root) NOPASSWD: /usr/local/bin/drivekey-desktop-start "", /usr/local/bin/drivekey, /sbin/poweroff ""' > "$stage/root/etc/sudoers.d/drivekey-live"
chmod 440 "$stage/root/etc/sudoers.d/drivekey-live"
ln -snf /usr/share/zoneinfo/UTC "$stage/root/etc/localtime"
printf 'UTC\n' > "$stage/root/etc/timezone"
printf '0.0 0 0.0\n0\nUTC\n' > "$stage/root/etc/adjtime"
for unit in systemd-timedated.service systemd-timesyncd.service hwclock-save.service; do
 ln -snf /dev/null "$stage/root/etc/systemd/system/$unit"
done
printf '%s\n' 'drivekey-offline-amd64-v5-desktop-r21-rc20-utc.iso' > "$stage/root/opt/drivekey/release-name.txt"
chroot "$stage/root" visudo -c
chroot "$stage/root" python3 -c 'import ast; from pathlib import Path; [ast.parse(p.read_text()) for p in Path("/opt/drivekey").glob("*.py")]'
mksquashfs "$stage/root" "$stage/filesystem.squashfs" -noappend -comp xz -processors 4
xorriso -indev "$base" -outdev "$output" -map "$stage/filesystem.squashfs" /live/filesystem.squashfs -boot_image any replay -commit -end
sha256sum "$output" > "$output.sha256"
xorriso -indev "$output" -report_el_torito plain -report_system_area plain > "$output.boot-report.txt" 2>&1
echo 'UTC-only candidate built. Exact-image verification still required.'
