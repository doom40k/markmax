#!/bin/bash
# 打包 Alfred workflow：template/* + 图标 → dist/markmax.alfredworkflow
set -euo pipefail
cd "$(dirname "$0")"
root=$(pwd)

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

cp template/info.plist template/mk.sh template/mka.sh template/action.sh "$stage/"
cp ../extension/icons/icon128.png "$stage/icon.png"
chmod +x "$stage"/*.sh

mkdir -p dist
rm -f dist/markmax.alfredworkflow
(cd "$stage" && zip -q -r "$root/dist/markmax.alfredworkflow" .)

echo "已生成 $root/dist/markmax.alfredworkflow"
