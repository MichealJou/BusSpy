"""量产批量模式：插板自动识别 → 自动烧录 → 自动写 SN → 结果记录。

由后端后台线程轮询探针列表，检测到「新插入的板卡」即自动执行烧录 + SN 写入。
结果通过 "production.record" 事件推送给宿主（Rust 侧持久化到 SQLite）。
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any

from .probes import list_probes
from .rpc import HARDWARE_LOCK, emit, emit_log

# 已识别过一轮的探针集合，用于检测新插板
_state: dict[str, Any] = {
    "running": False,
    "stop_flag": threading.Event(),
    "thread": None,
    "known_probes": set(),
    "records": [],
    "stats": {"total": 0, "ok": 0, "fail": 0},
    "config": None,
}


def _flash_board(config: dict[str, Any], probe: dict[str, Any]) -> dict[str, Any]:
    """对单块板执行：烧录固件 → 可选写 SN。返回记录。"""
    from .flash import program
    from .sn import write as sn_write

    record: dict[str, Any] = {
        "id": uuid.uuid4().hex[:12],
        "probeId": probe.get("uniqueId") or probe.get("id") or "",
        "product": probe.get("product", ""),
        "uid": "",
        "sn": "",
        "ok": False,
        "message": "",
        "durationMs": 0,
    }
    start = time.monotonic()
    try:
        flash_params = {
            "probeId": probe.get("uniqueId"),
            "target": config["target"],
            "filePath": config["firmwarePath"],
            "eraseMode": config.get("eraseMode", "auto"),
            "verify": config.get("verify", True),
            "pack": config.get("pack"),
        }
        # 单块板「烧录 + 写 SN」作为一个整体持硬件锁，与手动烧录/读芯片互斥，
        # 避免量产线程与 RPC 并发访问同一探针（互踢 → SIGTRAP）。
        with HARDWARE_LOCK:
            program(flash_params)
            message = "烧录成功"

            if config.get("snEnabled"):
                sn_value = _next_sn(config)
                sn_params = {
                    "probeId": probe.get("uniqueId"),
                    "target": config["target"],
                    "pack": config.get("pack"),
                    "address": config.get("snAddress", 0),
                    "format": config.get("snFormat", "ascii"),
                    "endian": config.get("snEndian", "little"),
                    "checksum": config.get("snChecksum", "none"),
                    "length": config.get("snLength"),
                    "value": sn_value,
                }
                sn_write(sn_params)
                record["sn"] = sn_value
                message += f"，SN={sn_value}"

        record["ok"] = True
        record["message"] = message
    except Exception as exc:  # noqa: BLE001
        record["message"] = str(exc)
    record["durationMs"] = int((time.monotonic() - start) * 1000)
    return record


def _next_sn(config: dict[str, Any]) -> str:
    """按生成规则取下一个 SN（内存计数递增；支持前缀/起始值/步长）。"""
    current = config.setdefault("_sn_current", int(config.get("snStart", 1)))
    step = int(config.get("snStep", 1))
    config["_sn_current"] = current + step
    prefix = config.get("snPrefix", "")
    return f"{prefix}{current}"


def _worker(config: dict[str, Any]) -> None:
    emit_log("量产模式已启动：插入板卡后自动烧录")
    while not _state["stop_flag"].is_set():
        try:
            with HARDWARE_LOCK:
                result = list_probes({})
            probes = result.get("probes", [])
        except Exception:  # noqa: BLE001
            probes = []

        current_ids = set()
        for probe in probes:
            probe_id = probe.get("uniqueId") or probe.get("id")
            if not probe_id:
                continue
            current_ids.add(probe_id)
            if probe_id in _state["known_probes"]:
                continue  # 已在烧过/已知，跳过
            emit_log(f"检测到新板卡：{probe.get('product', probe_id)}，开始烧录")
            record = _flash_board(config, probe)
            _state["records"].append(record)
            _state["stats"]["total"] += 1
            if record["ok"]:
                _state["stats"]["ok"] += 1
            else:
                _state["stats"]["fail"] += 1
            emit("production.record", record)
            emit("production.stats", _state["stats"])
            emit_log(f"板卡 {record['product'] or record['probeId']}：{record['message']}")

        # 只保留仍在线 + 本次新增的探针（拔掉重插会重新烧录）
        _state["known_probes"] = current_ids
        _state["stop_flag"].wait(0.8)


def start(params: dict[str, Any] | None = None) -> dict[str, Any]:
    """启动量产模式。"""
    params = params or {}
    for key in ("target", "firmwarePath"):
        if not params.get(key):
            raise ValueError(f"量产配置缺少 {key}")
    if _state["running"]:
        return {"started": True}
    # 上一次 stop 未真正收尾（worker 阻塞在子进程烧录中，最多 600s）：拒绝重入
    if _state["thread"] and _state["thread"].is_alive():
        raise RuntimeError("上次量产仍在收尾，请稍后重试")

    _state["config"] = dict(params)
    _state["stop_flag"].clear()
    _state["records"] = []
    _state["stats"] = {"total": 0, "ok": 0, "fail": 0}
    _state["known_probes"] = set()
    _state["thread"] = threading.Thread(target=_worker, args=(_state["config"],), daemon=True)
    _state["thread"].start()
    _state["running"] = True
    return {"started": True}


def stop(_params: dict[str, Any] | None = None) -> dict[str, Any]:
    """停止量产模式。"""
    _state["stop_flag"].set()
    _state["running"] = False
    if _state["thread"] and _state["thread"].is_alive():
        _state["thread"].join(timeout=3)
    emit_log("量产模式已停止")
    return {"stopped": True, **stats()}


def stats(_params: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"stats": _state["stats"], "running": _state["running"]}


def records(_params: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"records": list(reversed(_state["records"]))}
