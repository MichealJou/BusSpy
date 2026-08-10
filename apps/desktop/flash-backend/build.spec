# -*- mode: python ; coding: utf-8 -*-
"""BusSpy 烧录器后端 PyInstaller 打包配置。

产物：flash-backend（macOS） / flash-backend.exe（Windows）
作为 Tauri sidecar（externalBin）随 BusSpy 分发，用户机器无需安装 Python。
构建命令：
    .venv/bin/pyinstaller build.spec --noconfirm --distpath build/dist --workpath build/work
"""

from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = []

# pyOCD 及其依赖需要收集数据文件（FLM 算法、pack 数据、hidapi 动态库）
for package in ("pyocd", "cmsis_pack_manager", "hidapi", "pyusb", "intelhex", "pylink-square"):
    try:
        package_datas, package_binaries, package_hidden = collect_all(package)
        datas += package_datas
        binaries += package_binaries
        hiddenimports += package_hidden
    except Exception:
        pass

a = Analysis(
    ["backend_entry.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas + [("devices", "devices")],
    hiddenimports=hiddenimports + [
        "flash_backend.rpc",
        "flash_backend.probes",
        "flash_backend.targets",
        "flash_backend.packs",
        "flash_backend.flash",
        "flash_backend.sn",
        "flash_backend.serial_isp",
        "flash_backend.production",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="flash-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
)
