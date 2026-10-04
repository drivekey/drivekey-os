#!/bin/bash
set -euo pipefail
[[ $EUID == 0 && $# == 1 ]] || exit 1
project=$(realpath "$1")
base="$project/outputs/images/drivekey-offline-amd64-v5-desktop-r21-rc20.iso"
output="$project/outputs/images/drivekey-offline-amd64-v5-desktop-r21-rc20-simple.iso"
[[ -f $base && ! -b $base && ! -e $output ]] || exit 1
[[ $(sha256sum "$base" | cut -d ' ' -f1) == 8d57b42ccde9c8455527c9b1857695f9a57c56ed76ba0f76a27e966539b2b81e ]] || exit 1
stage=$(mktemp -d /opt/drivekey-builds/ui-rc20-simple-XXXXXXXX)
echo "BUILD_WORK=$stage"
xorriso -osirrox on -indev "$base" -extract /live/filesystem.squashfs "$stage/base.squashfs"
unsquashfs -d "$stage/root" "$stage/base.squashfs"
for file in drivekey-desktop.py drivekey_rules.py drivekey_rules_simple.py drivekey_widgets.py; do
 install -m 644 "$project/packaging/$file" "$stage/root/opt/drivekey/$file"
done
install -m 644 "$project/packaging/ui-icons/asset-usdg.png" "$stage/root/opt/drivekey/ui-icons/asset-usdg.png"
install -m 644 "$project/outputs/tools-v2/drivekey-gui-worker.cjs" "$stage/root/opt/drivekey/drivekey-gui-worker.cjs"
printf '%s\n' 'drivekey-offline-amd64-v5-desktop-r21-rc20-simple.iso' > "$stage/root/opt/drivekey/release-name.txt"
chroot "$stage/root" python3 -c 'import ast; [ast.parse(open("/opt/drivekey/"+n).read()) for n in ("drivekey-desktop.py","drivekey_rules.py","drivekey_rules_simple.py")]'
for file in drivekey-desktop.py drivekey_rules.py drivekey_rules_simple.py drivekey_widgets.py drivekey-gui-worker.cjs ui-icons/asset-usdg.png; do
 sha256sum "$stage/root/opt/drivekey/$file"
done > "$project/work/rc20-simple/iso-payload.sha256"
mksquashfs "$stage/root" "$stage/filesystem.squashfs" -noappend -comp xz -processors 4
xorriso -indev "$base" -outdev "$output" -map "$stage/filesystem.squashfs" /live/filesystem.squashfs -boot_image any replay -commit -end
sha256sum "$output" > "$output.sha256"
xorriso -indev "$output" -report_el_torito plain -report_system_area plain > "$output.boot-report.txt" 2>&1
printf '%s\n' "$stage" > "$project/work/rc20-simple/iso-build-directory.txt"
echo 'RC20 private candidate built. Exact-image acceptance still required.'
