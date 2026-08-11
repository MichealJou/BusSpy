"""串口 ISP 下载（STM32 系统 bootloader，AN3155 USART 协议）。

不依赖 SWD 调试器：通过 USB 转串口连接芯片 BOOT0 拉高的系统 bootloader，
支持擦除 / 写内存 / 读回校验。走 pyserial，跨 macOS / Windows。

帧校验约定（AN3155）：checksum = 0xFF ^ (命令字节 ^ 所有数据字节)。
"""

from __future__ import annotations

from functools import reduce
from operator import xor
from pathlib import Path
from typing import Any

import serial

from .rpc import emit, emit_log

ACK = 0x79
NACK = 0x1F

# AN3155 命令码
CMD_GET_ID = 0x02
CMD_READ_MEM = 0x11
CMD_WRITE_MEM = 0x31
CMD_EXT_ERASE = 0x44  # 扩展擦除（F2/F4/F7 等）

_PAGE_SIZE = 256


def _frame_checksum(header: int, payload: bytes) -> int:
    """AN3155 帧校验：0xFF 异或命令与所有数据字节。"""
    return 0xFF ^ header ^ reduce(xor, payload, 0)


def _read_byte(port: serial.Serial, timeout: float = 1.0) -> int:
    data = port.read(1)
    if len(data) != 1:
        raise TimeoutError("等待应答超时")
    return data[0]


def _wait_ack(port: serial.Serial) -> None:
    reply = _read_byte(port)
    if reply == NACK:
        raise RuntimeError("芯片返回 NACK")
    if reply != ACK:
        raise RuntimeError(f"应答异常：0x{reply:02X}")


def _send_command(port: serial.Serial, command: int, payload: bytes = b"") -> None:
    """发送命令帧：命令 + 数据 + 校验，等待 ACK。"""
    port.write(bytes([command]))
    if payload:
        port.write(payload)
    port.write(bytes([_frame_checksum(command, payload) & 0xFF]))
    port.flush()
    _wait_ack(port)


def _write_memory(port: serial.Serial, address: int, data: bytes) -> None:
    total = len(data)
    for offset in range(0, total, _PAGE_SIZE):
        chunk = data[offset : offset + _PAGE_SIZE]
        emit("flash.progress", {"phase": "program", "pct": int((offset + len(chunk)) * 100 / total)})
        addr_bytes = (address + offset).to_bytes(4, "big")
        # 地址帧：0x31 + 4 字节地址 + 校验
        _send_command(port, CMD_WRITE_MEM, addr_bytes)
        # 数据帧：len-1 + 数据 + 校验
        _write_data_frame(port, len(chunk) - 1, chunk)


def _write_data_frame(port: serial.Serial, length_byte: int, chunk: bytes) -> None:
    """WriteMemory 数据帧：首字节为 len-1，随后是数据，最后校验。"""
    frame = bytes([length_byte]) + chunk
    port.write(frame)
    port.write(bytes([_frame_checksum(length_byte, chunk) & 0xFF]))
    port.flush()
    _wait_ack(port)


def _read_memory(port: serial.Serial, address: int, length: int) -> bytes:
    """读回校验用（每次最多 256 字节）。"""
    result = bytearray()
    remaining = length
    current = address
    while remaining > 0:
        chunk_len = min(remaining, 256)
        addr_bytes = current.to_bytes(4, "big")
        _send_command(port, CMD_READ_MEM, addr_bytes)
        port.write(bytes([chunk_len - 1]))
        port.flush()
        _wait_ack(port)
        data = port.read(chunk_len)
        if len(data) != chunk_len:
            raise TimeoutError("读内存数据超时")
        result.extend(data)
        remaining -= chunk_len
        current += chunk_len
    return bytes(result)


def _sync(port: serial.Serial) -> None:
    """同步握手：发送 0x7F 直到收到 ACK（兼容自动波特率 bootloader）。"""
    for _ in range(100):
        port.write(b"\x7f")
        port.flush()
        try:
            reply = _read_byte(port, timeout=0.2)
        except TimeoutError:
            continue
        if reply == ACK:
            return
    raise RuntimeError("同步失败：请确认串口接线、BOOT0 已拉高并复位芯片")


def _get_chip_id(port: serial.Serial) -> int:
    """读取芯片 ID（AN3155 GetID）。

    协议响应为：ACK(0x79) + N + ID(N+1 字节) + ACK，其中 N = ID 字节数 - 1。
    因此 `port.read(length + 1)` 读到的正好是 ID 全量字节，直接按大端解析。
    """
    _send_command(port, CMD_GET_ID)
    length = _read_byte(port)
    if length < 1:
        raise RuntimeError("GetID 长度异常")
    id_bytes = port.read(length + 1)  # N+1 字节 ID（不含尾部 ACK，下一轮 ACK 由后续命令消费）
    if len(id_bytes) != length + 1:
        raise TimeoutError("GetID 数据超时")
    return int.from_bytes(id_bytes, "big")


def _extended_erase(port: serial.Serial) -> None:
    """扩展擦除：全片擦除（0x44 命令，N=0xFFFF 特殊值）。"""
    _send_command(port, CMD_EXT_ERASE)
    payload = b"\xff\xff"  # 0xFFFF = 全片擦除
    port.write(payload)
    port.write(bytes([_frame_checksum(0, payload) & 0xFF]))
    port.flush()
    _wait_ack(port)


def load_firmware(file_path: str, base_address: int) -> tuple[list[tuple[int, bytes]], int]:
    """加载固件：HEX 解析为地址段列表；BIN 作为单段。返回 (segments, 总长度)。"""
    path = Path(file_path)
    suffix = path.suffix.lower()
    if suffix == ".hex":
        from intelhex import IntelHex

        ih = IntelHex(str(path))
        segments = []
        total = 0
        for start, end in ih.segments():
            data = ih.tobinarray(start=start, end=end - 1)
            segments.append((start, bytes(data)))
            total += len(data)
        if not segments:
            raise ValueError("HEX 文件为空")
        return segments, total
    if suffix == ".bin":
        data = path.read_bytes()
        return [(base_address, data)], len(data)
    raise ValueError(f"串口 ISP 仅支持 HEX/BIN：{suffix}")


def program(params: dict[str, Any] | None = None) -> dict[str, Any]:
    """串口 ISP 烧录：同步 → GetID → 擦除 → 写内存 → 读回校验。"""
    params = params or {}
    port_name = params.get("port")
    baud_rate = int(params.get("baudRate", 115200))
    file_path = params.get("filePath")
    address = int(params.get("address", 0x08000000))
    verify = params.get("verify", True)

    if not port_name or not file_path:
        raise ValueError("缺少串口 ISP 参数（port/filePath）")

    segments, total = load_firmware(file_path, address)
    emit_log(f"固件已加载：{len(segments)} 段，共 {total} 字节")

    emit_log(f"打开串口 {port_name} @ {baud_rate}")
    with serial.Serial(port_name, baud_rate, timeout=1.0, write_timeout=2.0) as port:
        port.reset_input_buffer()
        _sync(port)
        chip_id = _get_chip_id(port)
        emit_log(f"芯片 ID：0x{chip_id:04X}")
        _extended_erase(port)
        emit_log("擦除完成")
        for start, data in segments:
            emit_log(f"写入 0x{start:08X}（{len(data)} 字节）")
            _write_memory(port, start, data)
        if verify:
            emit_log("回读校验...")
            for start, data in segments:
                readback = _read_memory(port, start, len(data))
                if readback != data:
                    raise RuntimeError(f"校验失败 @ 0x{start:08X}")
            emit_log("校验通过")
        return {"ok": True, "chipId": hex(chip_id), "verified": verify}


# ── 单元测试：AN3155 帧解析（用 FakePort 模拟串口应答） ──────────────────

import unittest


class _FakePort:
    """按预置字节队列应答的假串口，用于协议层单测。"""

    def __init__(self, responses: list[int]):
        self._responses = list(responses)
        self.written = b""

    def write(self, data) -> None:
        self.written += bytes(data)

    def flush(self) -> None:
        pass

    def read(self, size: int = 1) -> bytes:
        data = bytes(self._responses[:size])
        del self._responses[:size]
        return data


class SerialIspTests(unittest.TestCase):
    def test_get_chip_id_two_byte_id(self):
        # STM32F103：GetID 响应 ACK(0x79) + N=1 + ID[0x04,0x10]（0x0410）
        port = _FakePort([ACK, 0x01, 0x04, 0x10])
        self.assertEqual(_get_chip_id(port), 0x0410)

    def test_get_chip_id_three_byte_id(self):
        # 3 字节 ID：N=2
        port = _FakePort([ACK, 0x02, 0x04, 0x10, 0x50])
        self.assertEqual(_get_chip_id(port), 0x041050)

    def test_get_chip_id_rejects_bad_length(self):
        port = _FakePort([ACK, 0x00])  # N=0 视为异常（STM32 ID 均 ≥2 字节）
        with self.assertRaises(RuntimeError):
            _get_chip_id(port)

    def test_frame_checksum(self):
        self.assertEqual(_frame_checksum(0x02, b""), 0xFD)
        # 0xFF ^ 0x31 ^ 0x00 ^ 0x00 ^ 0x08 ^ 0x00 = 0xC6
        self.assertEqual(_frame_checksum(0x31, b"\x00\x00\x08\x00"), 0xC6)


if __name__ == "__main__":
    unittest.main()
