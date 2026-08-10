#!/bin/bash
# BusSpy macOS 信任脚本
# 作用:去掉未签名应用的 quarantine 标记,避免 macOS Gatekeeper 提示
#      "无法验证开发者" / "无法打开"。
#
# 用法:
#   1) 直接拖拽 BusSpy.app 到终端:
#        ./scripts/macos-trust.sh /Applications/BusSpy.app
#   2) 不传参数,默认处理 /Applications/BusSpy.app:
#        ./scripts/macos-trust.sh
#
# 说明:
#   - 未签名应用每次升级(替换 .app)后,macOS 会重新加 quarantine 标记,
#     所以升级后如果又提示"无法打开",重新执行一次本脚本即可。
#   - 本脚本只移除 quarantine 属性,不会修改系统安全策略,也不会后台联网。

set -e

APP_PATH="${1:-/Applications/BusSpy.app}"

if [ ! -d "$APP_PATH" ]; then
  echo "未找到应用:$APP_PATH"
  echo "请把 BusSpy.app 拖到终端里,或传入完整路径,例如:"
  echo "  ./scripts/macos-trust.sh /Applications/BusSpy.app"
  exit 1
fi

echo "处理应用:$APP_PATH"
xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true
xattr -cr "$APP_PATH" 2>/dev/null || true

echo "完成。现在可以正常打开 BusSpy 了。"
echo "提示:以后每次升级 BusSpy,如果再次提示无法打开,重新执行本脚本一次即可。"
