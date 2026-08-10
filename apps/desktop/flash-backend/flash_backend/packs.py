"""CMSIS DFP Pack 管理：导入本地官方 Pack / 列出已安装 Pack。

pyOCD 通过 cmsis-pack-manager 索引查找已安装 Pack，文件布局为：
    <data_path>/<Vendor>/<Pack>/<version>.pack
索引版本可能与本地 Pack 版本不同（在线索引较新），导入时会按索引版本
补一份副本，确保 pyOCD 能发现该 Pack 与其中的器件。
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from .rpc import emit_log


def _cache():
    from cmsis_pack_manager import Cache

    return Cache(True, True)


def _ensure_index(cache) -> None:
    """本地 pack 目录为空索引时，扫描/下载一次索引（含各厂商器件清单）。"""
    if not cache.index:
        cache.cache_descriptors()


def _index_pack_name(cache, vendor: str, pack: str) -> str | None:
    """从索引中找该 pack 的规范文件名（Vendor.Pack.version.pack）。"""
    for descriptor in cache.index.values():
        if not isinstance(descriptor, dict):
            continue
        from_pack = descriptor.get("from_pack")
        if not isinstance(from_pack, dict):
            continue
        if from_pack.get("vendor") == vendor and from_pack.get("pack") == pack:
            version = from_pack.get("version")
            if version:
                return f"{vendor}.{pack}.{version}"
    return None


def list_packs(_params: dict[str, Any] | None = None) -> dict[str, Any]:
    """列出已安装的 Pack（名称 + 版本 + 支持的器件数）。"""
    try:
        cache = _cache()
        _ensure_index(cache)
        installed = _installed_pack_files(cache)
    except Exception as exc:  # noqa: BLE001
        return {"packs": [], "error": str(exc)}
    return {"packs": installed}


def _installed_pack_files(cache) -> list[dict[str, Any]]:
    """扫描数据目录（含子目录布局），返回本地真实存在的 Pack。"""
    packs: dict[str, dict[str, Any]] = {}
    data_dir = Path(cache.data_path)
    if not data_dir.is_dir():
        return []

    # 扁平布局：Vendor.Pack.version.pack
    for path in data_dir.glob("*.pack"):
        parts = path.stem.split(".")
        if len(parts) < 3:
            continue
        key = f"{parts[0]}.{parts[1]}"
        packs.setdefault(key, {"name": key, "version": parts[2], "deviceCount": 0})

    # 子目录布局：Vendor/Pack/version.pack
    for path in data_dir.glob("*/*/*.pack"):
        vendor, pack_name, version = path.parts[-3], path.parts[-2], path.stem
        key = f"{vendor}.{pack_name}"
        existing = packs.get(key)
        if not existing or _version_key(version) > _version_key(existing["version"]):
            packs[key] = {"name": key, "version": version, "deviceCount": 0}

    # 补充器件数（来自索引，非精确）
    if isinstance(cache.index, dict):
        for descriptor in cache.index.values():
            if not isinstance(descriptor, dict):
                continue
            from_pack = descriptor.get("from_pack")
            if not isinstance(from_pack, dict):
                continue
            key = f"{from_pack.get('vendor')}.{from_pack.get('pack')}"
            if key in packs:
                devices = descriptor.get("devices") or []
                packs[key]["deviceCount"] += len(devices) if isinstance(devices, dict) else 0

    return sorted(packs.values(), key=lambda item: item["name"].lower())


def _version_key(version: str) -> tuple[int, ...]:
    try:
        return tuple(int(part) for part in version.split("."))
    except ValueError:
        return (0,)


def import_pack(params: dict[str, Any] | None = None) -> dict[str, Any]:
    """导入本地官方 Pack（.pack 文件），安装后器件库自动扩展。"""
    params = params or {}
    pack_path = params.get("path", "")
    if not pack_path:
        raise ValueError("缺少 Pack 文件路径")
    if not Path(pack_path).is_file():
        raise FileNotFoundError(f"Pack 文件不存在：{pack_path}")

    emit_log(f"正在安装 Pack：{Path(pack_path).name}")
    cache = _cache()
    cache.add_pack_from_path(pack_path)
    _ensure_index(cache)

    # 确保 pyOCD 子目录布局中存在该 Pack（按索引版本或本地版本命名）
    file_name = Path(pack_path).name  # Vendor.Pack.version.pack
    parts = file_name[:-5].split(".")
    if len(parts) >= 3:
        vendor, pack_name, local_version = parts[0], parts[1], parts[2]
        index_name = _index_pack_name(cache, vendor, pack_name)
        target_version = index_name.split(".")[-1] if index_name else local_version
        target_dir = Path(cache.data_path) / vendor / pack_name
        target_dir.mkdir(parents=True, exist_ok=True)
        target_file = target_dir / f"{target_version}.pack"
        if not target_file.is_file():
            shutil.copy2(pack_path, target_file)
            emit_log(f"已按索引版本 {target_version} 注册 Pack")

    emit_log("Pack 安装完成，器件库已扩展")
    return {"imported": True, "path": pack_path, "packs": _installed_pack_files(cache)}
