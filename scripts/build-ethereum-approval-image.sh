#!/bin/bash
set -euo pipefail
# Derive a private RC12 candidate from the verified RC11 image; regular files only.
[[ $EUID == 0 && $# == 1 ]] || exit 1
project=$(realpath "$1")
base="$project/outputs/images/drivekey-offline-amd64-v5-desktop-r21-rc11.iso"
output="$project/outputs/images/drivekey-offline-amd64-v5-desktop-r21-rc12.iso"
[[ -f $base && ! -b $base && ! -e $output && -f $project/work/ethereum-v7/drivekey-gui-worker.cjs ]] || exit 1
[[ $(sha256sum "$base" | cut -d ' ' -f1) == 9414291991bbf298caac1e6f851eb6740947961810caa5740afbc0c3c671a4a7 ]] || exit 1
stage=$(mktemp -d /opt/drivekey-builds/ethereum-approval-XXXXXXXX)
echo "BUILD_WORK=$stage"
xorriso -osirrox on -indev "$base" -extract /live/filesystem.squashfs "$stage/base.squashfs"
unsquashfs -d "$stage/root" "$stage/base.squashfs"
install -m 644 "$project/work/ethereum-v7/drivekey-gui-worker.cjs" "$stage/root/opt/drivekey/drivekey-gui-worker.cjs"
install -m 644 "$project/packaging/drivekey-desktop.py" "$stage/root/opt/drivekey/drivekey-desktop.py"
printf '%s\n' 'drivekey-offline-amd64-v5-desktop-r21-rc12.iso' > "$stage/root/opt/drivekey/release-name.txt"
chroot "$stage/root" python3 -c 'import ast; ast.parse(open("/opt/drivekey/drivekey-desktop.py").read())'
mksquashfs "$stage/root" "$stage/filesystem.squashfs" -noappend -comp xz -processors 4
xorriso -indev "$base" -outdev "$output" -map "$stage/filesystem.squashfs" /live/filesystem.squashfs -boot_image any replay -commit -end
sha256sum "$output" > "$output.sha256"
xorriso -indev "$output" -report_el_torito plain -report_system_area plain > "$output.boot-report.txt" 2>&1
printf '%s\n' "$stage" > "$project/work/ethereum-v7/iso-build-directory.txt"
echo 'RC12 candidate built. Signing acceptance is still required; no public release changed.'
