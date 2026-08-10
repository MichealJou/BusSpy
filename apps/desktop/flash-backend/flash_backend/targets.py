"""内置器件库 + Pack 已装器件合并查询。

三级芯片支持：
  1. 内置 devices.json（离线可用，常用 STM32 / GD32）
  2. 官方 CMSIS DFP Pack 导入后，pyOCD 通过 cmsis-pack-manager 自动识别器件
  3. 在线搜索安装（后续增强）
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_DEVICES_FILE = Path(__file__).resolve().parent.parent / "devices" / "devices.json"


def list_targets(_params: dict[str, Any] | None = None) -> dict[str, Any]:
    """返回内置器件库（含是否内置 pyOCD target / 是否需要 Pack）。"""
    with open(_DEVICES_FILE, encoding="utf-8") as handle:
        devices = json.load(handle)
    return {"targets": devices}
