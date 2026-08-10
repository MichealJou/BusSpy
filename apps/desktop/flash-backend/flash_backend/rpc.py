"""RPC 基础设施：事件推送（供各 handler 在长任务中上报进度）。"""

from __future__ import annotations

import json
import sys
from typing import Any


def _write(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def emit(event: str, data: dict[str, Any]) -> None:
    """向宿主推送异步事件（如烧录进度、阶段日志）。"""
    _write({"event": event, "data": data})


def emit_log(message: str) -> None:
    emit("flash.log", {"message": message})
