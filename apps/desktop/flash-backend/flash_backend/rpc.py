"""RPC 基础设施：事件推送（供各 handler 在长任务中上报进度）。"""

from __future__ import annotations

import json
import sys
import threading
from typing import Any

# 与 __main__ 共享的写锁：emit/emit_log 会被多线程调用（量产后台线程、
# worker 子进程 stdout/stderr 转发线程），必须串行化写 stdout，否则 JSON 行会交错。
_write_lock = threading.Lock()


def _write(payload: dict[str, Any]) -> None:
    with _write_lock:
        sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
        sys.stdout.flush()


# 硬件访问锁：所有需要独占访问探针/串口的操作（RPC handler 与量产后台线程）共用。
# 并发的 USB/HID 枚举会让 macOS IOHIDManager 崩溃；多个 pyOCD 子进程同时
# 访问同一探针会互踢（进程 SIGTRAP）。__main__ 与 production 均 import 此锁。
HARDWARE_LOCK = threading.Lock()


def emit(event: str, data: dict[str, Any]) -> None:
    """向宿主推送异步事件（如烧录进度、阶段日志）。"""
    _write({"event": event, "data": data})


def emit_log(message: str) -> None:
    emit("flash.log", {"message": message})
