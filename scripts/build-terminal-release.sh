#!/bin/bash
set -euo pipefail
project=$(realpath "$1")
name=${2:-drivekey-offline-amd64-v4.iso}
[[ $name =~ ^drivekey-offline-amd64-v4(-r[0-9]+)?\.iso$ ]] || exit 1
base=$(realpath "$project/outputs/images/drivekey-offline-amd64-v3.iso")
stage=$(mktemp -d /opt/drivekey-builds/terminal-source-XXXXXXXX)
cp "$project"/packaging/{drivekey,drivekey-isolate,drivekey-terminal.py,drivekey_clock.py,drivekey_dashboard.py,drivekey_workspace.py,finalize-terminal-image.sh,logo.txt,logo-ascii.txt,logo-large.txt} "$stage/"
cp -R "$project/packaging/chain-icons" "$stage/chain-icons"
printf '%s\n' "$name" > "$stage/release-name.txt"
cp "$project/outputs/terminal-v4/drivekey-gui-worker.cjs" "$stage/"
find "$stage" -maxdepth 1 -type f -exec sed -i 's/\r$//' {} +
echo "STAGE=$stage"
bash "$stage/finalize-terminal-image.sh" "$base" "$stage/$name" > "$stage/build.log" 2>&1
[[ ! -e $project/outputs/images/$name ]] || exit 1
cp "$stage/$name" "$project/outputs/images/"
cp "$stage/$name.boot-report.txt" "$project/outputs/images/"
sha256sum "$project/outputs/images/$name"
echo "COMPLETE=$stage"
