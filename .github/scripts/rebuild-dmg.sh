#!/bin/bash
# 在 macOS CI 上重制 BusSpy 的 dmg,把"首次运行请双击.command"信任脚本一起放进去。
#
# 入参:
#   $1 原 dmg 路径(tauri-action 产物)
#   $2 信任脚本路径(scripts/dmg-trust.command)
#
# 原理:Tauri 2 官方不支持往 dmg 根目录加文件,所以打包后用 hdiutil 重新制作:
#   挂载原 dmg → 提取 .app → 组装新目录(.app + Applications + 信任脚本)→ 生成新 dmg 覆盖原 dmg
#
# macOS runner 原生支持 UTF-8,中文文件名"首次运行请双击.command"安全。

set -euo pipefail

ORIGINAL_DMG="${1:?用法:rebuild-dmg.sh <原 dmg 路径> <信任脚本路径>}"
TRUST_COMMAND="${2:?用法:rebuild-dmg.sh <原 dmg 路径> <信任脚本路径>}"

# 确保 UTF-8,处理中文文件名
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

if [ ! -f "$ORIGINAL_DMG" ]; then
  echo "未找到原 dmg:$ORIGINAL_DMG" >&2
  exit 1
fi
if [ ! -f "$TRUST_COMMAND" ]; then
  echo "未找到信任脚本:$TRUST_COMMAND" >&2
  exit 1
fi

STAGING="$(mktemp -d)"
MOUNTPOINT="$(mktemp -d)"
TRUST_NAME="首次运行请双击.command"
NEW_DMG="$(mktemp -t busspy).dmg"

cleanup() {
  hdiutil detach "$MOUNTPOINT" -force >/dev/null 2>&1 || true
  rm -rf "$STAGING" "$NEW_DMG" "$MOUNTPOINT"
}
trap cleanup EXIT

# 1. 挂载原 dmg,提取 .app
echo "→ 挂载原 dmg"
hdiutil attach "$ORIGINAL_DMG" -nobrowse -mountpoint "$MOUNTPOINT" -readonly
APP_SRC="$(find "$MOUNTPOINT" -maxdepth 1 -name "*.app" -print -quit)"
if [ -z "$APP_SRC" ]; then
  echo "原 dmg 里没找到 .app" >&2
  exit 1
fi
APP_NAME="$(basename "$APP_SRC")"
echo "→ 提取 $APP_NAME"
cp -R "$APP_SRC" "$STAGING/"

# 2. Applications 快捷方式
ln -s /Applications "$STAGING/Applications"

# 3. 信任脚本(中文名,双击可执行)
cp "$TRUST_COMMAND" "$STAGING/$TRUST_NAME"
chmod +x "$STAGING/$TRUST_NAME"

# 4. 卸载原 dmg
hdiutil detach "$MOUNTPOINT" -force >/dev/null 2>&1 || true
rmdir "$MOUNTPOINT" 2>/dev/null || true

# 5. 生成新 dmg(UDZO 压缩),先到临时文件再覆盖原 dmg
echo "→ 生成新 dmg"
hdiutil create \
  -volname "BusSpy" \
  -srcfolder "$STAGING" \
  -fs HFS+ \
  -format UDZO \
  -imagekey zlib-level=9 \
  "$NEW_DMG"

# 6. 用新 dmg 覆盖原 dmg
mv -f "$NEW_DMG" "$ORIGINAL_DMG"
NEW_DMG=""  # 已移动,避免 trap 误删
echo "→ 完成,已覆盖:$ORIGINAL_DMG"
echo "   dmg 内含:$APP_NAME、Applications、$TRUST_NAME"
