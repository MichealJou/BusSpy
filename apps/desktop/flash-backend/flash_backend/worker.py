"""硬件操作独立子进程执行（崩溃隔离 + 无 session 残留）。

为什么需要子进程：
  1. ATK-HS-V3 等探针在同一进程内多次连接（自动读芯片信息 + 烧录并发）
     会让 pyOCD 第二次 session 的 core 发现异常（"NoneType' has no attribute
     'node_name'"），烧录必失败。
  2. 探针 HID 交互偶发会让 Python 进程直接崩溃（EXC_BREAKPOINT），
     在主进程崩溃会击穿整个后端。

因此烧录 / 擦除 / 读芯片信息都在独立子进程里执行：
  - 每次全新进程，零 session 残留，绝无并发串扰
  - 子进程崩溃只影响它自己，主后端进程保持存活
  - 阶段日志 / 进度通过子进程 stdout 的 JSON 行转发为事件
"""

from __future__ import annotations

import json
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

from .rpc import emit, emit_log

# 烧录超时（秒）：大固件（如 512KB）1MHz 下可能 1-2 分钟，放宽到 10 分钟
PROGRAM_TIMEOUT = 600.0
# 擦除 / 读芯片信息超时
SHORT_TIMEOUT = 120.0

_WORKER_SCRIPT = r"""
import json, sys, traceback, logging

# pyOCD 详细日志（连接/发现/擦除/编程过程）输出到 stderr，全部转发给主进程
logging.basicConfig(level=logging.INFO, format="[pyocd] %(message)s")

method = sys.argv[1]
params = json.loads(sys.argv[2])

# 把 flash.py 内部的 emit / emit_log 重定向为子进程自己的 JSON 行
import flash_backend.rpc as rpc

def out(kind, data):
    sys.stdout.write(json.dumps({"kind": kind, "data": data}) + "\n")
    sys.stdout.flush()

rpc.emit = lambda event, data: out("event", {"event": event, "data": data})
rpc.emit_log = lambda message: out("log", message)

from flash_backend.flash import program, erase, chip_info

handlers = {
    "flash.program": program,
    "flash.erase": erase,
    "flash.chipInfo": chip_info,
}

try:
    result = handlers[method](params)
    out("result", result)
except Exception as exc:
    traceback.print_exc(file=sys.stderr)
    out("error", str(exc))
"""


def _run_worker(method: str, params: dict[str, Any], timeout: float) -> dict[str, Any]:
    """在独立子进程执行硬件操作；事件行转发为主后端事件。成功返回业务结果 dict。"""
    cwd = str(Path(__file__).resolve().parents[1])  # flash-backend/ 目录（跨平台）
    script = _WORKER_SCRIPT
    env_cwd = cwd
    proc = subprocess.Popen(
        [sys.executable, "-c", script, method, json.dumps(params)],
        cwd=env_cwd,
        env={**__import__("os").environ, "PYTHONPATH": cwd},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    result_payload: dict[str, Any] | None = None
    error_msg: str | None = None

    def read_stdout() -> None:
        nonlocal result_payload, error_msg
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            kind = payload.get("kind")
            data = payload.get("data")
            if kind == "result":
                result_payload = data
            elif kind == "error":
                error_msg = data
            elif kind == "log":
                emit_log(data)
            elif kind == "event":
                evt = data.get("event") if isinstance(data, dict) else None
                if evt:
                    emit(evt, data.get("data"))

    def read_stderr() -> None:
        # pyOCD 详细日志（stderr）逐行转发为前端日志，实时可见
        assert proc.stderr is not None
        for line in proc.stderr:
            line = line.rstrip("\n")
            if line.strip():
                emit_log(line)

    thread = threading.Thread(target=read_stdout, daemon=True)
    thread.start()
    stderr_thread = threading.Thread(target=read_stderr, daemon=True)
    stderr_thread.start()

    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
        raise RuntimeError(f"操作超时（>{int(timeout)}s），已终止。请检查探针/芯片连接后重试")

    thread.join(timeout=5)
    stderr_thread.join(timeout=5)

    if result_payload is not None:
        return result_payload

    # 子进程崩溃（探针 HID 兼容问题）：主进程保持存活，向上抛错
    if error_msg:
        raise RuntimeError(error_msg)
    if proc.returncode != 0:
        raise RuntimeError(f"烧录后端子进程异常退出（退出码 {proc.returncode}）")

    raise RuntimeError("后端子进程无结果返回")


def program(params: dict[str, Any] | None = None) -> dict[str, Any]:
    """烧录（独立子进程）。"""
    return _run_worker("flash.program", params or {}, PROGRAM_TIMEOUT)


def erase(params: dict[str, Any] | None = None) -> dict[str, Any]:
    """整片擦除（独立子进程）。"""
    return _run_worker("flash.erase", params or {}, SHORT_TIMEOUT)


def chip_info(params: dict[str, Any] | None = None) -> dict[str, Any]:
    """读芯片信息（独立子进程）。"""
    return _run_worker("flash.chipInfo", params or {}, SHORT_TIMEOUT)
