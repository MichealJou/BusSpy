#!/bin/bash
# BusSpy 首次运行授权工具(放进 dmg,用户双击执行)
#
# 作用:去掉未签名应用的 quarantine 标记,避免 macOS Gatekeeper 提示
#      "无法验证开发者" / "无法打开"。
#
# 用法:双击本文件即可,无需手动输命令。
#
# 说明:
#   - 处理同目录的 BusSpy.app(dmg 挂载点)和 /Applications/BusSpy.app(用户已拖过去的),
#     两个位置都覆盖,无论用户先拖还是先双击脚本都能生效。
#   - 未签名应用每次升级(替换 .app)后 macOS 会重新加 quarantine 标记,
#     所以升级后如果又提示"无法打开",重新双击本脚本一次即可。
#   - 本脚本只移除 quarantine 属性,不修改系统安全策略,不联网。

set -e

cat <<'BANNER'
========================================
  BusSpy 首次运行授权工具
========================================
正在去掉 macOS 的"未验证开发者"提示...
BANNER

# 处理两个可能的位置:同目录(dmg 挂载点)和 /Applications
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROCESSED=0

for APP in "$SCRIPT_DIR/BusSpy.app" "/Applications/BusSpy.app"; do
  if [ -d "$APP" ]; then
    xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
    xattr -cr "$APP" 2>/dev/null || true
    echo "已处理:$APP"
    PROCESSED=$((PROCESSED + 1))
  fi
done

if [ "$PROCESSED" -eq 0 ]; then
  echo
  echo "未找到 BusSpy.app。"
  echo "请先把 BusSpy.app 拖到应用程序文件夹,或确保本脚本和 BusSpy.app 在同一目录。"
  echo
  exit 1
fi

cat <<'FOOTER'

完成!现在可以正常打开 BusSpy 了。

提示:以后每次升级 BusSpy,如果再次提示"无法打开",重新双击本脚本一次即可。
FOOTER
