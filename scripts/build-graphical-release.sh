#!/bin/bash
set -euo pipefail
[[ $EUID == 0 && $# == 2 ]] || { echo 'Usage: build-graphical-release.sh PROJECT_PATH EXISTING_BASE_ISO'; exit 1; }
project=$(realpath "$1")
base=$(realpath "$2")
[[ -f $base && ! -b $base && $base != /dev/* ]] || exit 1
stage=$(mktemp -d /opt/drivekey-builds/graphical-v3-XXXXXXXX)
cp "$project"/packaging/{drivekey-offline,drivekey-gui.py,drivekey-x-session,finalize-live-image.sh,build-live-image.sh} "$stage/"
cp "$project"/outputs/tools-v2/{drivekey-signer.cjs,drivekey-gui-worker.cjs} "$stage/"
cp -a /opt/drivekey-builds/release-RLs5wson/LICENSES "$stage/"
cp "$project/LICENSE" "$stage/LICENSES/DriveKey.txt"
cp /opt/drivekey-builds/release-RLs5wson/node-v22.23.2-linux-x64.tar.xz "$stage/"
# Normalize transferred text only; builds and scratch data remain on Linux's filesystem.
sed -i 's/\r$//' "$stage"/*.sh "$stage/drivekey-offline" "$stage/drivekey-x-session" "$stage/drivekey-gui.py"
echo "STAGING: $stage"
bash "$stage/finalize-live-image.sh" "$base" "$stage/drivekey-offline-amd64-v3.iso" > "$stage/build.log" 2>&1
mkdir -p "$project/outputs/images"
[[ ! -e $project/outputs/images/drivekey-offline-amd64-v3.iso ]] || { echo 'Release destination exists; inspect before replacing.'; exit 1; }
cp "$stage/drivekey-offline-amd64-v3.iso" "$project/outputs/images/"
cp "$stage/drivekey-offline-amd64-v3.iso.boot-report.txt" "$project/outputs/images/"
sha256sum "$project/outputs/images/drivekey-offline-amd64-v3.iso"
echo "BUILD_COMPLETE: $stage"
