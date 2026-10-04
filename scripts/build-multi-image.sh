#!/bin/bash
set -euo pipefail
project=$(realpath "$1")
name=${2:-drivekey-offline-amd64-v5-experimental.iso}
[[ $name =~ ^drivekey-offline-amd64-v5-experimental(-r[0-9]+)?\.iso$ ]] || exit 1
base=$(realpath "$project/outputs/images/drivekey-offline-amd64-v4-r4.iso")
worker_dir=$(realpath "${3:-$project/outputs/multi-v5}")
[[ -f $base && ! -e $project/outputs/images/$name ]] || exit 1
stage=$(mktemp -d /opt/drivekey-builds/multi-source-XXXXXXXX)
cp "$project"/packaging/{drivekey,drivekey-isolate,drivekey-terminal.py,drivekey_clock.py,drivekey_dashboard.py,drivekey_workspace.py,finalize-terminal-image.sh,logo.txt,logo-ascii.txt,logo-large.txt} "$stage/"
cp -R "$project/packaging/chain-icons" "$stage/chain-icons"
printf '%s\n' "$name" > "$stage/release-name.txt"
cp "$worker_dir/drivekey-gui-worker.cjs" "$stage/"
cp "$worker_dir/THIRD-PARTY-NOTICES.txt" "$stage/"
find "$stage" -maxdepth 1 -type f -exec sed -i 's/\r$//' {} +
python3 -c 'import ast,sys;ast.parse(open(sys.argv[1]).read())' "$stage/drivekey-terminal.py"
echo "STAGE=$stage"
bash "$stage/finalize-terminal-image.sh" "$base" "$stage/$name" > "$stage/build.log" 2>&1
cp "$stage/$name" "$project/outputs/images/"
cp "$stage/$name.boot-report.txt" "$project/outputs/images/"
sha256sum "$project/outputs/images/$name" | tee "$project/outputs/images/$name.sha256"
echo "COMPLETE=$stage"
