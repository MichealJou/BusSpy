"""烧录器后端入口：JSON Lines over stdio 的 RPC 服务。

Rust 宿主通过 stdin 写入请求行，后端把响应写回 stdout；
进度等异步信息通过事件行推送给宿主。
"""

from __future__ import annotations

import importlib
import json
import sys
import traceback
from typing import Any, Callable

from . import __version__
from .probes import list_probes


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
}


def emit(event: str, data: dict[str, Any]) -> None:
    """向宿主推送异步事件（如烧录进度）。"""
    _write({"event": event, "data": data})


def _write(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


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
            handler = HANDLERS.get(method)
            if handler is None:
                _write({"id": req_id, "error": f"未知方法: {method}"})
                continue
            result = handler(params)
            _write({"id": req_id, "result": result})
        except Exception as exc:  # noqa: BLE001 - 进程级兜底，任何异常都不能杀死后端
            traceback.print_exc(file=sys.stderr)
            _write({"id": req_id, "error": str(exc)})


if __name__ == "__main__":
    serve()
