#!/bin/bash
set -euo pipefail
# Private regular-file image only; preserve every earlier ISO and signing worker.
[[ $EUID == 0 && $# == 1 ]] || exit 1
project=$(realpath "$1")
base="$project/outputs/images/drivekey-offline-amd64-v5-desktop-r21-rc14.iso"
output="$project/outputs/images/drivekey-offline-amd64-v5-desktop-r21-rc15.iso"
[[ -f $base && ! -b $base && ! -e $output ]] || exit 1
[[ $(sha256sum "$base" | cut -d ' ' -f1) == 2c43110a128ea3610bfcbcdbf50dd44cd9a5ac1dec4ca5afd1778aabe567a650 ]] || exit 1
[[ $(sha256sum "$project/packaging/fonts/Nunito-Regular.ttf" | cut -d ' ' -f1) == 0a590070a68330924dd04b4b1593b4479d2e66f2bb843cb54403e0258dd4da8e ]] || exit 1
[[ $(sha256sum "$project/packaging/fonts/Nunito-Bold.ttf" | cut -d ' ' -f1) == 452490694a32df825403270d3d0ec36cb2525aafb9d26b4c92bfc2c7e5213f62 ]] || exit 1
[[ $(sha256sum "$project/packaging/fonts/OFL.txt" | cut -d ' ' -f1) == 580df76c95a1ec5ab878ceb25bb3d85c6a076804e9c970c8c6972aea775fdf65 ]] || exit 1
stage=$(mktemp -d /opt/drivekey-builds/ui-rc15-XXXXXXXX)
echo "BUILD_WORK=$stage"
xorriso -osirrox on -indev "$base" -extract /live/filesystem.squashfs "$stage/base.squashfs"
unsquashfs -d "$stage/root" "$stage/base.squashfs"
for file in drivekey-desktop.py drivekey_widgets.py drivekey_theme.py; do
 install -m 644 "$project/packaging/$file" "$stage/root/opt/drivekey/$file"
done
install -d "$stage/root/usr/share/fonts/truetype/drivekey" "$stage/root/usr/share/doc/drivekey-fonts"
install -m 644 "$project/packaging/fonts/Nunito-Regular.ttf" "$project/packaging/fonts/Nunito-Bold.ttf" "$stage/root/usr/share/fonts/truetype/drivekey/"
install -m 644 "$project/packaging/fonts/OFL.txt" "$stage/root/usr/share/doc/drivekey-fonts/"
install -m 644 "$project/packaging/fonts/PROVENANCE.json" "$stage/root/usr/share/doc/drivekey-fonts/"
printf '%s\n' 'drivekey-offline-amd64-v5-desktop-r21-rc15.iso' > "$stage/root/opt/drivekey/release-name.txt"
chroot "$stage/root" fc-cache -f
chroot "$stage/root" fc-match Nunito
chroot "$stage/root" python3 -c 'import ast; [ast.parse(open("/opt/drivekey/"+name).read()) for name in ("drivekey-desktop.py","drivekey_widgets.py","drivekey_theme.py")]'
[[ $(sha256sum "$stage/root/opt/drivekey/drivekey-gui-worker.cjs" | cut -d ' ' -f1) == 2a10a155efa4d5e6c927cf69b157d99108280df4ba9b52f11d1370c52bfd5fe3 ]] || exit 1
mksquashfs "$stage/root" "$stage/filesystem.squashfs" -noappend -comp xz -processors 4
xorriso -indev "$base" -outdev "$output" -map "$stage/filesystem.squashfs" /live/filesystem.squashfs -boot_image any replay -commit -end
sha256sum "$output" > "$output.sha256"
xorriso -indev "$output" -report_el_torito plain -report_system_area plain > "$output.boot-report.txt" 2>&1
printf '%s\n' "$stage" > "$project/work/ui-rc15/iso-build-directory.txt"
echo 'RC15 private candidate built. Exact-image acceptance still required.'
