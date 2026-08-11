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
from typing import Any

# 枚举超时（秒）
SCAN_TIMEOUT = 10.0

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


def list_probes(_params: dict[str, Any] | None = None) -> dict[str, Any]:
    """枚举当前连接的烧录器（子进程隔离，崩溃不影响主后端）。"""
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
