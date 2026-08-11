"""烧录器（debug probe）枚举。

通过 pyOCD 统一枚举 CMSIS-DAP / ST-Link / J-Link 等调试器。

⚠️ 崩溃隔离：个别探针（如 ATK-HS-V3 老固件）的 HID 交互会让 macOS 的
IOHIDManager 直接崩溃整个 Python 进程（EXC_BREAKPOINT）。因此枚举放到
独立子进程执行，子进程崩溃只影响它自己，主后端进程不受影响。
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from typing import Any

# 枚举超时（秒）
SCAN_TIMEOUT = 10.0

# 探针枚举结果缓存：USB 枚举最慢（子进程 + pyOCD 导入 + HID 交互，最长 10s），
# 页面初始化 / 多次刷新时避免重复触发；点击“刷新探针”会带 force 强制重扫。
_CACHE_TTL = 3.0
_SCAN_CACHE: dict[str, Any] = {"ts": 0.0, "result": None}

_SCAN_SCRIPT = r"""
import json, sys
from pyocd.probe.aggregator import DebugProbeAggregator
probes = []
try:
    for probe in DebugProbeAggregator.get_all_connected_probes():
        try:
            protocols = [
                DebugProbeAggregator.PROTOCOL_NAME_MAP.get(protocol, str(protocol))
                for protocol in probe.supported_wire_protocols
            ]
        except Exception:
            protocols = []
        probes.append({
            "id": getattr(probe, "probe_id", None) or "",
            "vendor": getattr(probe, "vendor_name", None) or "",
            "product": getattr(probe, "product_name", None) or "",
            "uniqueId": getattr(probe, "unique_id", None) or "",
            "protocols": protocols,
        })
except Exception as exc:
    sys.stderr.write(str(exc))
json.dump(probes, sys.stdout)
"""


def list_probes(params: dict[str, Any] | None = None) -> dict[str, Any]:
    """枚举当前连接的烧录器（子进程隔离，崩溃不影响主后端）。

    TTL 缓存 3 秒；params 带 force=true 时跳过缓存强制重扫（前端“刷新探针”按钮）。
    """
    params = params or {}
    force = bool(params.get("force"))
    now = time.monotonic()
    cached = _SCAN_CACHE["result"]
    if not force and cached is not None and now - _SCAN_CACHE["ts"] < _CACHE_TTL:
        return cached

    result = _scan()
    _SCAN_CACHE["ts"] = now
    _SCAN_CACHE["result"] = result
    return result


def _scan() -> dict[str, Any]:
    try:
        result = subprocess.run(
            [sys.executable, "-c", _SCAN_SCRIPT],
            capture_output=True,
            text=True,
            timeout=SCAN_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        return {"probes": [], "timeout": True}
    except Exception as exc:  # noqa: BLE001
        return {"probes": [], "error": str(exc)}

    if result.returncode != 0:
        # 子进程崩溃（探针 HID 兼容问题）：主后端保持存活，返回空列表
        return {"probes": [], "error": result.stderr.strip() or "探针枚举子进程异常退出"}

    try:
        probes = json.loads(result.stdout or "[]")
    except json.JSONDecodeError:
        return {"probes": []}
    return {"probes": probes}
