#!/bin/bash
set -euo pipefail
[[ $EUID == 0 && $# == 1 ]] || exit 1
project=$(realpath "$1")
base="$project/outputs/images/drivekey-offline-amd64-v5-desktop-r21-rc19.iso"
output="$project/outputs/images/drivekey-offline-amd64-v5-desktop-r21-rc20.iso"
[[ -f $base && ! -b $base && ! -e $output ]] || exit 1
[[ $(sha256sum "$base" | cut -d ' ' -f1) == 56bb5b2f7eae86f5e99543d70590b1d01528625735733f05ec27fa782a284ba8 ]] || exit 1
stage=$(mktemp -d /opt/drivekey-builds/ui-rc20-XXXXXXXX)
echo "BUILD_WORK=$stage"
xorriso -osirrox on -indev "$base" -extract /live/filesystem.squashfs "$stage/base.squashfs"
unsquashfs -d "$stage/root" "$stage/base.squashfs"
for file in drivekey-desktop.py drivekey_rules.py drivekey_widgets.py; do
 install -m 644 "$project/packaging/$file" "$stage/root/opt/drivekey/$file"
done
install -m 644 "$project/packaging/ui-icons/asset-usdg.png" "$stage/root/opt/drivekey/ui-icons/asset-usdg.png"
install -m 644 "$project/outputs/tools-v2/drivekey-gui-worker.cjs" "$stage/root/opt/drivekey/drivekey-gui-worker.cjs"
printf '%s\n' 'drivekey-offline-amd64-v5-desktop-r21-rc20.iso' > "$stage/root/opt/drivekey/release-name.txt"
chroot "$stage/root" python3 -c 'import ast; [ast.parse(open("/opt/drivekey/"+n).read()) for n in ("drivekey-desktop.py","drivekey_rules.py")]'
for file in drivekey-desktop.py drivekey_rules.py drivekey_widgets.py drivekey-gui-worker.cjs ui-icons/asset-usdg.png; do
 sha256sum "$stage/root/opt/drivekey/$file"
done > "$project/work/rc20/iso-payload.sha256"
mksquashfs "$stage/root" "$stage/filesystem.squashfs" -noappend -comp xz -processors 4
xorriso -indev "$base" -outdev "$output" -map "$stage/filesystem.squashfs" /live/filesystem.squashfs -boot_image any replay -commit -end
sha256sum "$output" > "$output.sha256"
xorriso -indev "$output" -report_el_torito plain -report_system_area plain > "$output.boot-report.txt" 2>&1
printf '%s\n' "$stage" > "$project/work/rc20/iso-build-directory.txt"
echo 'RC20 private candidate built. Exact-image acceptance still required.'
