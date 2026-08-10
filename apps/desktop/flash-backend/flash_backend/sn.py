"""SN 序列号：读 / 写 / 修改。

存储位置：Flash 保留扇区（可反复修改）或 OTP（一次写入）。
格式：ASCII（定长/变长）、BCD、uint32/uint64（大小端可选）。
校验：None / CRC16(Modbus) / CRC32，追加在数据末尾。
"""

from __future__ import annotations

import struct
import tempfile
from pathlib import Path
from typing import Any

from .rpc import emit_log

_CHECKSUM_SIZES = {"none": 0, "crc16": 2, "crc32": 4}


def _crc16_modbus(data: bytes) -> bytes:
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    return struct.pack("<H", crc)


def _crc32(data: bytes) -> bytes:
    import binascii

    return struct.pack(">I", binascii.crc32(data) & 0xFFFFFFFF)


def _checksum(data: bytes, kind: str) -> bytes:
    if kind == "crc16":
        return _crc16_modbus(data)
    if kind == "crc32":
        return _crc32(data)
    return b""


def encode_sn(value: str, fmt: str, length: int | None, endian: str = "little", checksum: str = "none") -> bytes:
    """把用户输入的 SN 字符串按格式编码为字节流（含校验）。"""
    fmt = (fmt or "ascii").lower()
    if fmt in ("ascii", "bcd") and length:
        digits = sum(1 for ch in value if ch.isdigit())
        length = max(length, digits)
    if fmt == "ascii":
        payload = value.encode("ascii", errors="replace")
        if length and len(payload) < length:
            payload = payload + b"\x00" * (length - len(payload))
        elif length:
            payload = payload[:length]
    elif fmt == "bcd":
        if not value.isdigit() or len(value) % 2:
            raise ValueError("BCD 格式要求纯数字且位数为偶数")
        payload = bytes(int(value[i : i + 2]) for i in range(0, len(value), 2))
        if length and len(payload) < length:
            payload = payload + b"\xff" * (length - len(payload))
    elif fmt in ("uint32", "uint64"):
        size = 4 if fmt == "uint32" else 8
        number = int(value)
        if number < 0 or number >= (1 << (size * 8)):
            raise ValueError(f"{fmt} 数值超出范围")
        order = "little" if endian != "big" else "big"
        payload = number.to_bytes(size, order)
    else:
        raise ValueError(f"不支持的 SN 格式：{fmt}")

    suffix = _checksum(payload, checksum)
    return payload + suffix


def decode_sn(data: bytes, fmt: str, endian: str = "little", checksum: str = "none") -> dict[str, Any]:
    """解析 SN 字节流：数据 + 校验值 + 校验是否通过。"""
    fmt = (fmt or "ascii").lower()
    check_size = _CHECKSUM_SIZES.get(checksum or "none", 0)
    payload, suffix = data[: len(data) - check_size], data[len(data) - check_size :] if check_size else b""

    if fmt == "ascii":
        value = payload.split(b"\x00", 1)[0].decode("ascii", errors="replace").strip("\x00 \r\n")
    elif fmt == "bcd":
        value = "".join(f"{byte:02d}" for byte in payload if byte != 0xFF)
    elif fmt == "uint32":
        value = str(int.from_bytes(payload[:4], "little" if endian != "big" else "big"))
    elif fmt == "uint64":
        value = str(int.from_bytes(payload[:8], "little" if endian != "big" else "big"))
    else:
        raise ValueError(f"不支持的 SN 格式：{fmt}")

    valid = True
    expected = _checksum(payload, checksum)
    if check_size and suffix != expected:
        valid = False
    return {
        "value": value,
        "raw": list(payload),
        "checksum": list(suffix) if suffix else [],
        "valid": valid,
    }


def _connect(probe_id: str, target: str, pack: str | None = None):
    from pyocd.core.helpers import ConnectHelper

    options: dict[str, Any] = {"frequency": 2_000_000}
    if pack:
        options["pack"] = pack
    # auto_open 默认 True：ConnectHelper 会打开探针并初始化目标，勿再手动 open
    session = ConnectHelper.session_with_chosen_probe(
        unique_id=probe_id,
        target_override=target,
        options=options,
    )
    if session is None:
        raise RuntimeError(f"无法连接烧录器/芯片：{probe_id}")
    return session


def read(params: dict[str, Any] | None = None) -> dict[str, Any]:
    """读取并解析 SN。"""
    params = params or {}
    probe_id = params.get("probeId")
    target = params.get("target")
    pack = params.get("pack")
    address = int(params.get("address", 0))
    fmt = params.get("format", "ascii")
    endian = params.get("endian", "little")
    checksum = params.get("checksum", "none")
    length = params.get("length")

    size = _CHECKSUM_SIZES.get(checksum or "none", 0)
    if fmt in ("uint32", "uint64"):
        data_len = (4 if fmt == "uint32" else 8) + size
    elif length:
        data_len = int(length) + size
    else:
        raise ValueError("ASCII/BCD 格式需要提供长度")

    emit_log(f"读取 SN @ 0x{address:08X}")
    session = _connect(probe_id, target, pack)
    try:
        raw = session.target.read_memory_block8(address, data_len)
        result = decode_sn(bytes(raw), fmt, endian, checksum)
        emit_log(f"SN 读取成功：{result['value']}" + ("" if result["valid"] else "（校验不符！）"))
        return result
    finally:
        session.close()


def write(params: dict[str, Any] | None = None) -> dict[str, Any]:
    """写入 / 修改 SN：擦除所在扇区 → 写入编码数据 → 回读校验。"""
    params = params or {}
    probe_id = params.get("probeId")
    target = params.get("target")
    pack = params.get("pack")
    address = int(params.get("address", 0))
    value = params.get("value", "")
    fmt = params.get("format", "ascii")
    endian = params.get("endian", "little")
    checksum = params.get("checksum", "none")
    length = params.get("length")

    if not probe_id or not target:
        raise ValueError("缺少 SN 写入参数（probeId/target）")
    if not value:
        raise ValueError("SN 值不能为空")

    data = encode_sn(str(value), fmt, length, endian, checksum)
    emit_log(f"写入 SN @ 0x{address:08X}：{value}（{len(data)} 字节）")

    session = _connect(probe_id, target, pack)
    try:
        # 用临时 BIN 走 FileProgrammer（chip_erase="sector" 只擦数据所在扇区，安全）
        with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as handle:
            handle.write(data)
            temp_path = Path(handle.name)
        try:
            from pyocd.flash.file_programmer import FileProgrammer

            programmer = FileProgrammer(session, chip_erase="sector")
            programmer.add_file(str(temp_path), address=address)
            programmer.commit()
        finally:
            temp_path.unlink(missing_ok=True)

        # 回读校验
        raw = session.target.read_memory_block8(address, len(data))
        parsed = decode_sn(bytes(raw), fmt, endian, checksum)
        if bytes(raw) != data:
            raise RuntimeError(f"回读校验失败：期望 {list(data)} 实际 {list(raw)}")
        emit_log(f"SN 写入成功：{parsed['value']}（回读一致）")
        return {"ok": True, "value": parsed["value"], "valid": parsed["valid"]}
    finally:
        session.close()
