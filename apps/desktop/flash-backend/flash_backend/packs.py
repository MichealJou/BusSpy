"""CMSIS DFP Pack 管理：导入本地官方 Pack / 在线搜索 / 在线下载安装。

pyOCD 通过 cmsis-pack-manager 索引查找已安装 Pack，文件布局为：
    <data_path>/<Vendor>/<Pack>/<version>.pack
索引版本可能与本地 Pack 版本不同（在线索引较新），导入时会按索引版本
补一份副本，确保 pyOCD 能发现该 Pack 与其中的器件。
"""

from __future__ import annotations

import re
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


def _from_pack_name(descriptor: dict[str, Any]) -> str:
    from_pack = descriptor.get("from_pack")
    if not isinstance(from_pack, dict):
        return ""
    return f"{from_pack.get('vendor', '')}.{from_pack.get('pack', '')}"


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
    """列出已安装的 Pack（名称 + 版本 + 支持的器件数）。

    dataPath 供 Rust 下载器复用：搜索/下载已迁到 Rust（pack_downloader），
    但索引与数据目录由 cmsis-pack-manager 维护，这里把目录报给 Rust 缓存。
    """
    try:
        cache = _cache()
        _ensure_index(cache)
        installed = _installed_pack_files(cache)
    except Exception as exc:  # noqa: BLE001
        return {"packs": [], "error": str(exc)}
    return {"packs": installed, "dataPath": cache.data_path}


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


# ── 烧录算法（Keil Programming Algorithm 同源数据） ────────────────────────

def _algorithms_for_device(device_name: str) -> list[dict[str, Any]]:
    """在已装 DFP 中查找某器件的烧录算法列表（默认算法优先）。

    数据源：各 Pack 内 .pdsc 的 <algorithm name= start= size= default=1/> 节点，
    与 Keil 的 Programming Algorithm 完全同源。返回按 default 排序：
      [{name, address, sizeKb, default}, ...]
    """
    try:
        cache = _cache()
        _ensure_index(cache)
        data_dir = Path(cache.data_path)
    except Exception:  # noqa: BLE001
        return []
    if not data_dir.is_dir():
        return []

    import zipfile

    results: list[dict[str, Any]] = []
    # 扫描数据目录下的 .pack 文件（扁平 + 子目录布局）
    pack_files = list(data_dir.glob("*.pack")) + list(data_dir.glob("*/*/*.pack"))
    for pack_file in pack_files:
        try:
            with zipfile.ZipFile(pack_file) as archive:
                pdsc_name = next(
                    (name for name in archive.namelist() if name.endswith(".pdsc")),
                    None,
                )
                if pdsc_name is None:
                    continue
                content = archive.read(pdsc_name).decode("utf-8", errors="ignore")
        except Exception:  # noqa: BLE001
            continue

        # 定位该器件的 <device Dname="XXX"> ... </device> 块。
        # Dname 可能是完整型号（STM32F407ZGT6 / STM32F407ZGTx）或家族名（STM32F407ZG），
        # 而前端传入的是 target 名（形态不一），因此做归一化匹配：
        #   - 忽略大小写
        #   - 生成候选：原始名 / 去封装尾缀名（去掉尾部 "T6"/"x"/数字，如 ZGT6→ZG、ZGTx→ZG）
        # 任一候选命中即认为该器件。
        normalized = device_name.upper()
        candidates = {normalized}
        # STM32F407ZGT6 / STM32F407ZGTx → STM32F407ZG（去掉尾部 T6/Tx/x/数字）
        stripped = re.sub(r"(?:T[0-9X]|[0-9X])+$", "", normalized)
        if stripped and stripped != normalized:
            candidates.add(stripped)
        # STM32F407ZGT6 → STM32F407ZGT（再去一层：去尾部任意数字/字母）
        stripped2 = re.sub(r"[0-9A-Z]+$", "", stripped)
        if stripped2 and stripped2 != stripped:
            candidates.add(stripped2)

        block: str | None = None
        # 先做一次全量 Dname 扫描，支持模糊匹配（避免正则二次扫描）
        for dname_match in re.finditer(r'<device\s+Dname="([^"]+)"\s*>.*?</device>', content, re.DOTALL):
            dname = dname_match.group(1).upper()
            if dname in candidates:
                block = dname_match.group(0)
                break
            # 双向子串/前缀兜底：STM32F407ZG vs STM32F407ZGT6
            if any(
                (cand in dname and len(cand) >= len(dname) - 3)
                or (dname in cand and len(dname) >= len(cand) - 3)
                for cand in candidates
            ):
                block = dname_match.group(0)
                break
        if block is None:
            continue

        # 提取块内所有 <algorithm>，解析 default 标记
        alg_pattern = re.compile(
            r'<algorithm\s+name="([^"]+)"\s+start="([^"]+)"\s+size="([^"]+)"(?:\s+default="([^"]*)")?'
        )
        for alg_match in alg_pattern.finditer(block):
            name, start, size, default = alg_match.groups()
            try:
                address = int(start, 16)
                size_kb = int(int(size, 16) / 1024)
            except ValueError:
                continue
            is_default = str(default or "").strip() in ("1", "true")
            results.append(
                {
                    "name": name.rsplit("/", 1)[-1],  # 只保留文件名，如 STM32F4xx_1024.FLM
                    "path": name,
                    "address": address,
                    "sizeKb": size_kb,
                    "default": is_default,
                }
            )

    # 去重（多 Pack 可能重复定义），默认算法排前
    seen: set[tuple[str, int]] = set()
    unique: list[dict[str, Any]] = []
    for item in results:
        key = (item["name"], item["address"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    unique.sort(key=lambda item: (not item["default"], item["name"].lower()))
    return unique


def list_algorithms(params: dict[str, Any] | None = None) -> dict[str, Any]:
    """查询某器件的烧录算法列表（Keil Programming Algorithm 同源）。

    返回 [{name, address, sizeKb, default}]；default=True 的是该器件
    默认算法（Keil 自动带出的那个）。
    """
    params = params or {}
    device_name = params.get("device", "").strip()
    if not device_name:
        raise ValueError("缺少器件型号（device）")
    algorithms = _algorithms_for_device(device_name)
    return {
        "device": device_name,
        "algorithms": algorithms,
        "default": next((a for a in algorithms if a["default"]), None),
    }


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


def search(params: dict[str, Any] | None = None) -> dict[str, Any]:
    """在线搜索器件：按型号关键字匹配官方 Pack 索引，返回器件 + 所属 Pack。"""
    params = params or {}
    query = params.get("query", "").strip()
    if not query:
        raise ValueError("缺少搜索关键字")

    cache = _cache()
    _ensure_index(cache)

    pattern = re.compile(re.escape(query), re.IGNORECASE)
    results: list[dict[str, Any]] = []
    seen_packs: set[str] = set()
    for name, descriptor in cache.index.items():
        if not isinstance(descriptor, dict) or not pattern.search(name):
            continue
        pack_name = _from_pack_name(descriptor)
        version = ""
        flash_size: int | None = None
        from_pack = descriptor.get("from_pack")
        if isinstance(from_pack, dict):
            version = from_pack.get("version", "")
        memories = descriptor.get("memories")
        if isinstance(memories, dict):
            for memory in memories.values():
                if isinstance(memory, dict) and str(memory.get("default", "")).lower() == "1":
                    flash_size = memory.get("size")
                    break
        results.append(
            {
                "device": name,
                "pack": pack_name,
                "version": version,
                "flashKb": int(flash_size / 1024) if isinstance(flash_size, int) else None,
            }
        )
        if pack_name:
            seen_packs.add(pack_name)

    results.sort(key=lambda item: item["device"].lower())
    return {"results": results[:100], "total": len(results), "packs": sorted(seen_packs)}


def download(params: dict[str, Any] | None = None) -> dict[str, Any]:
    """在线下载并安装指定 Pack（自动从官方 Pack 服务器下载 + 注册）。"""
    params = params or {}
    pack_name = params.get("pack", "")
    if not pack_name:
        raise ValueError("缺少 Pack 名称")

    cache = _cache()
    _ensure_index(cache)

    # 收集属于该 Pack 的器件描述，交给 cmsis-pack-manager 解析下载地址
    devices = [
        descriptor
        for descriptor in cache.index.values()
        if isinstance(descriptor, dict) and _from_pack_name(descriptor) == pack_name
    ]
    if not devices:
        raise RuntimeError(f"索引中未找到 Pack：{pack_name}")

    from cmsis_pack_manager import Cache  # noqa: F401
    packs = cache.packs_for_devices(devices)
    target = next((p for p in packs if str(p).startswith(pack_name)), None)
    if target is None:
        raise RuntimeError(f"无法解析 Pack 下载地址：{pack_name}")

    emit_log(f"开始下载：{target}")
    cache.download_pack_list([target])
    emit_log("下载完成，正在注册器件库...")
    _ensure_index(cache)

    # 确保子目录布局可用（与本地导入一致）
    vendor, pack = pack_name.split(".", 1)
    index_name = _index_pack_name(cache, vendor, pack)
    target_version = index_name.split(".")[-1] if index_name else "latest"
    data_dir = Path(cache.data_path)
    candidates = list(data_dir.glob(f"**/{pack_name.split('.')[-1]}*.pack")) + list(data_dir.glob(f"{pack_name}*.pack"))
    # 统一从下载落盘位置复制到子目录布局
    for candidate in candidates:
        target_dir = data_dir / vendor / pack
        target_dir.mkdir(parents=True, exist_ok=True)
        target_file = target_dir / f"{target_version}.pack"
        if not target_file.is_file():
            shutil.copy2(candidate, target_file)
            emit_log(f"已注册 Pack：{target_file.name}")
        break

    emit_log(f"Pack 安装完成：{pack_name}")
    return {"installed": True, "pack": pack_name, "packs": _installed_pack_files(cache)}
