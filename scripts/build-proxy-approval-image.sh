#!/bin/bash
set -euo pipefail
# Derive a private RC10 candidate from the verified RC9 image; regular files only.
[[ $EUID == 0 && $# == 1 ]] || exit 1
project=$(realpath "$1")
base="$project/outputs/images/drivekey-offline-amd64-v5-desktop-r21-rc9.iso"
output="$project/outputs/images/drivekey-offline-amd64-v5-desktop-r21-rc10.iso"
[[ -f $base && ! -b $base && ! -e $output && -f $project/work/proxy-v6/drivekey-gui-worker.cjs ]] || exit 1
[[ $(sha256sum "$base" | cut -d ' ' -f1) == f4b80a1af0de7fd503d7359700728e11c805d6a7731acb889c73808e14efa216 ]] || exit 1
stage=$(mktemp -d /opt/drivekey-builds/proxy-approval-XXXXXXXX)
echo "BUILD_WORK=$stage"
xorriso -osirrox on -indev "$base" -extract /live/filesystem.squashfs "$stage/base.squashfs"
unsquashfs -d "$stage/root" "$stage/base.squashfs"
install -m 644 "$project/work/proxy-v6/drivekey-gui-worker.cjs" "$stage/root/opt/drivekey/drivekey-gui-worker.cjs"
install -m 644 "$project/packaging/drivekey-desktop.py" "$stage/root/opt/drivekey/drivekey-desktop.py"
printf '%s\n' 'drivekey-offline-amd64-v5-desktop-r21-rc10.iso' > "$stage/root/opt/drivekey/release-name.txt"
chroot "$stage/root" python3 -c 'import ast; ast.parse(open("/opt/drivekey/drivekey-desktop.py").read())'
mksquashfs "$stage/root" "$stage/filesystem.squashfs" -noappend -comp xz -processors 4
xorriso -indev "$base" -outdev "$output" -map "$stage/filesystem.squashfs" /live/filesystem.squashfs -boot_image any replay -commit -end
sha256sum "$output" > "$output.sha256"
xorriso -indev "$output" -report_el_torito plain -report_system_area plain > "$output.boot-report.txt" 2>&1
printf '%s\n' "$stage" > "$project/work/proxy-v6/iso-build-directory.txt"
echo 'RC10 candidate built. Signing acceptance is still required; no public release changed.'
