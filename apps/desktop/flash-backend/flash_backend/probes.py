"""烧录器（debug probe）枚举。

通过 pyOCD 统一枚举 CMSIS-DAP / ST-Link / J-Link 等调试器，
返回给前端展示的型号、唯一 ID、支持协议等信息。
"""

from __future__ import annotations

from typing import Any

from pyocd.probe.aggregator import DebugProbeAggregator


def list_probes(_params: dict[str, Any] | None = None) -> dict[str, Any]:
    """枚举当前连接的烧录器。"""
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
    return {"probes": probes}
