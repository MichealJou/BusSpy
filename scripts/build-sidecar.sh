#!/usr/bin/env bash
# 构建 BusSpy 烧录器后端 sidecar（PyInstaller 单文件），并复制为 Tauri externalBin 需要的
# `<name>-<target-triple>` 命名。在 macOS / Windows 各自平台构建对应产物。
#
# 用法：
#   ./build-sidecar.sh            # 本机平台
#   在 CI 中分别于 macOS / Windows 运行，产物进入 src-tauri 打包。

set -euo pipefail

cd "$(dirname "$0")/apps/desktop/flash-backend"

# 若本机未装 pyocd 依赖，先自动初始化（国内镜像）
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
  .venv/bin/pip install --index-url https://pypi.tuna.tsinghua.edu.cn/simple \
    --trusted-host pypi.tuna.tsinghua.edu.cn pyocd pyserial pyinstaller
fi

.venv/bin/pyinstaller build.spec --noconfirm --distpath build/dist --workpath build/work

# Tauri externalBin 命名：flash-backend-<target-triple>
case "$(uname -s)" in
  Darwin) TRIPLE="aarch64-apple-darwin" ;;
  MINGW*|MSYS*|CYGWIN*) TRIPLE="x86_64-pc-windows-msvc" ;;
  *) TRIPLE="x86_64-unknown-linux-gnu" ;;
esac

EXT=""
[ "$(uname -s | cut -c1-5)" = "MINGW" ] && EXT=".exe"

cp "build/dist/flash-backend${EXT}" "build/dist/flash-backend-${TRIPLE}${EXT}"
echo "sidecar ready: build/dist/flash-backend-${TRIPLE}${EXT}"
