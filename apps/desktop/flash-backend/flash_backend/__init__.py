"""BusSpy 烧录器后端（pyOCD 侧车进程）。

通过 JSON Lines over stdio 与 Rust 宿主通信：
  请求:  {"id": 1, "method": "probe.list", "params": {}}
  响应:  {"id": 1, "result": {...}}  或  {"id": 1, "error": "..."}
  事件:  {"event": "flash.progress", "data": {...}}
"""

__version__ = "0.1.0"
