#!/bin/bash
set -euo pipefail
# Derive a private RC13 candidate from the verified RC12 image; regular files only.
[[ $EUID == 0 && $# == 1 ]] || exit 1
project=$(realpath "$1")
base="$project/outputs/images/drivekey-offline-amd64-v5-desktop-r21-rc12.iso"
output="$project/outputs/images/drivekey-offline-amd64-v5-desktop-r21-rc13.iso"
[[ -f $base && ! -b $base && ! -e $output && -f $project/work/ethereum-v7/drivekey-gui-worker.cjs ]] || exit 1
[[ $(sha256sum "$base" | cut -d ' ' -f1) == 2deff5e4cbe64615691b9c93628d6e25de9614df129e02b39bda9d4908fb1c74 ]] || exit 1
stage=$(mktemp -d /opt/drivekey-builds/ui-rc13-XXXXXXXX)
echo "BUILD_WORK=$stage"
xorriso -osirrox on -indev "$base" -extract /live/filesystem.squashfs "$stage/base.squashfs"
unsquashfs -d "$stage/root" "$stage/base.squashfs"
install -m 644 "$project/packaging/drivekey-desktop.py" "$stage/root/opt/drivekey/drivekey-desktop.py"
printf '%s\n' 'drivekey-offline-amd64-v5-desktop-r21-rc13.iso' > "$stage/root/opt/drivekey/release-name.txt"
chroot "$stage/root" python3 -c 'import ast; ast.parse(open("/opt/drivekey/drivekey-desktop.py").read())'
mksquashfs "$stage/root" "$stage/filesystem.squashfs" -noappend -comp xz -processors 4
xorriso -indev "$base" -outdev "$output" -map "$stage/filesystem.squashfs" /live/filesystem.squashfs -boot_image any replay -commit -end
sha256sum "$output" > "$output.sha256"
xorriso -indev "$output" -report_el_torito plain -report_system_area plain > "$output.boot-report.txt" 2>&1
printf '%s\n' "$stage" > "$project/work/ui-rc13/iso-build-directory.txt"
echo 'RC13 candidate built. Signing acceptance is still required; no public release changed.'
