"""烧录器后端入口：JSON Lines over stdio 的 RPC 服务。

Rust 宿主通过 stdin 写入请求行，后端把响应写回 stdout；
进度等异步信息通过事件行推送给宿主。

每个请求在独立线程处理，避免慢请求（如 USB 枚举）阻塞其他请求；
输出通过全局锁保证行不交错。
"""

from __future__ import annotations

import importlib
import json
import sys
import threading
import traceback
from typing import Any, Callable

from . import __version__
from .packs import import_pack, list_algorithms, list_packs
from .probes import list_probes
from .production import records as production_records
from .production import start as production_start
from .production import stats as production_stats
from .production import stop as production_stop
from .serial_isp import program as isp_program
from .sn import read as sn_read
from .sn import write as sn_write
from .targets import list_targets
# 硬件重操作（烧录/擦除/读芯片）走独立子进程：崩溃隔离 + 无 session 残留
from .worker import chip_info, erase, program as flash_program

# 需要访问硬件的重操作：串行执行，避免并发访问探针/串口。
# probe.list 也在其中：并发的 USB/HID 枚举会让 macOS IOHIDManager 崩溃
# （多个 pyOCD 子进程同时访问同一探针会互踢，进程直接 SIGTRAP）。
_HARDWARE_LOCK = threading.Lock()
_HARDWARE_METHODS = {
    "probe.list",
    "flash.program",
    "flash.erase",
    "flash.chipInfo",
    "sn.read",
    "sn.write",
    "isp.program",
    "production.start",
}


def env_status(_params: dict[str, Any] | None = None) -> dict[str, Any]:
    """上报 Python / pyocd / pyserial 安装情况，供前端环境自检展示。"""

    def probe(name: str) -> dict[str, Any]:
        try:
            module = importlib.import_module(name)
            return {
                "installed": True,
                "version": getattr(module, "__version__", ""),
            }
        except Exception as exc:  # noqa: BLE001
            return {"installed": False, "error": str(exc)}

    return {
        "python": sys.version.split()[0],
        "backend": __version__,
        "pyocd": probe("pyocd"),
        "pyserial": probe("serial"),
    }


# method 名 -> 处理函数(params: dict) -> result(dict)
HANDLERS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "ping": lambda _params: {"pong": True, "version": __version__},
    "env.status": env_status,
    "probe.list": list_probes,
    "target.list": list_targets,
    "pack.list": list_packs,
    "pack.algorithms": list_algorithms,
    "pack.import": import_pack,
    "flash.program": flash_program,
    "flash.erase": erase,
    "flash.chipInfo": chip_info,
    "sn.read": sn_read,
    "sn.write": sn_write,
    "isp.program": isp_program,
    "production.start": production_start,
    "production.stop": production_stop,
    "production.stats": production_stats,
    "production.records": production_records,
}

_write_lock = threading.Lock()
_active_threads: list[threading.Thread] = []
_threads_lock = threading.Lock()


def _write(payload: dict[str, Any]) -> None:
    with _write_lock:
        sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def _handle(req_id: Any, method: str, params: dict[str, Any]) -> None:
    try:
        handler = HANDLERS.get(method)
        if handler is None:
            _write({"id": req_id, "error": f"未知方法: {method}"})
            return
        if method in _HARDWARE_METHODS:
            with _HARDWARE_LOCK:
                result = handler(params)
        else:
            result = handler(params)
        _write({"id": req_id, "result": result})
    except Exception as exc:  # noqa: BLE001 - 进程级兜底，任何异常都不能杀死后端
        traceback.print_exc(file=sys.stderr)
        _write({"id": req_id, "error": str(exc)})


def serve() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id: Any = None
        try:
            request = json.loads(line)
            req_id = request.get("id")
            method = request.get("method", "")
            params = request.get("params") or {}
        except Exception:  # noqa: BLE001
            _write({"id": req_id, "error": "请求解析失败"})
            continue
        thread = threading.Thread(
            target=_handle,
            args=(req_id, method, params),
            daemon=True,
        )
        with _threads_lock:
            _active_threads.append(thread)
        thread.start()

    # stdin 关闭（宿主退出/重启）：等待活动线程收尾，避免响应丢失
    with _threads_lock:
        pending = list(_active_threads)
    for thread in pending:
        thread.join(timeout=15)


if __name__ == "__main__":
    serve()
