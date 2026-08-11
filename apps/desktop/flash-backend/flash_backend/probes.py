"""烧录器（debug probe）枚举。

通过 pyOCD 统一枚举 CMSIS-DAP / ST-Link / J-Link 等调试器，
返回给前端展示的型号、唯一 ID、支持协议等信息。

注意：pyOCD 0.45 的枚举 API 没有非阻塞选项，异常探针（如固件兼容问题的
老款 CMSIS-DAP）可能导致枚举长时间阻塞。这里在子线程中扫描并加超时，
超时后返回已发现的部分结果，避免界面卡死。
"""

from __future__ import annotations

import threading
from typing import Any

# 枚举超时（秒）：超过则认为探针枚举异常，返回部分结果
SCAN_TIMEOUT = 10.0


def _scan() -> list[dict[str, Any]]:
    from pyocd.probe.aggregator import DebugProbeAggregator

    probes: list[dict[str, Any]] = []
    for probe in DebugProbeAggregator.get_all_connected_probes():
        try:
            protocols = [
                DebugProbeAggregator.PROTOCOL_NAME_MAP.get(protocol, str(protocol))
                for protocol in probe.supported_wire_protocols
            ]
        except Exception:  # noqa: BLE001
            protocols = []
        probes.append(
            {
                "id": getattr(probe, "probe_id", None) or "",
                "vendor": getattr(probe, "vendor_name", None) or "",
                "product": getattr(probe, "product_name", None) or "",
                "uniqueId": getattr(probe, "unique_id", None) or "",
                "protocols": protocols,
            }
        )
    return probes


def list_probes(_params: dict[str, Any] | None = None) -> dict[str, Any]:
    """枚举当前连接的烧录器（带超时保护）。"""
    result: list[dict[str, Any]] = []

    def worker() -> None:
        try:
            result.extend(_scan())
        except Exception:  # noqa: BLE001 - 枚举失败返回空列表
            pass

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    thread.join(timeout=SCAN_TIMEOUT)

    return {"probes": result, "timeout": thread.is_alive()}
