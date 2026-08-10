"""SWD 烧录：连接 / 擦除 / 编程 / 校验 / 芯片信息读取。

基于 pyOCD 统一支持 CMSIS-DAP / ST-Link / J-Link 调试器。
Pack 器件通过显式 pack 路径（session option "pack"）解析，避免依赖在线索引版本。
烧录进度通过 rpc.emit 推送 "flash.progress" 事件，阶段日志推送 "flash.log"。
"""

from __future__ import annotations

from typing import Any, Callable

from .rpc import emit, emit_log

# 默认 SWD 时钟频率（2MHz，兼容大部分板载下载器）
DEFAULT_FREQUENCY = 2_000_000


def _normalise_progress(value: float) -> int:
    """pyOCD 进度回调可能传 0-1 或 0-100，统一为 0-100 整数。"""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    return max(0, min(100, int(number * 100 if number <= 1 else number)))


def _session(probe_id: str, target: str, verify: bool = True, pack: str | None = None):
    from pyocd.core.helpers import ConnectHelper

    options: dict[str, Any] = {"frequency": DEFAULT_FREQUENCY, "verify": verify}
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


def _progress_handler(phase: str) -> Callable[[float], None]:
    def handler(percent: float) -> None:
        emit("flash.progress", {"phase": phase, "pct": _normalise_progress(percent)})

    return handler


def _flash_size(target) -> int | None:
    """读取器件 Flash 总大小（字节）。"""
    for region in target.memory_map:
        if region.is_flash:
            return int(region.length)
    return None


def program(params: dict[str, Any] | None = None) -> dict[str, Any]:
    """烧录固件：连接 → 擦除 → 编程 → 校验。"""
    params = params or {}
    probe_id = params.get("probeId")
    target = params.get("target")
    file_path = params.get("filePath")
    erase_mode = params.get("eraseMode", "auto")  # "chip" | "auto"
    verify = params.get("verify", True)
    pack = params.get("pack")  # 可选的 Pack 文件路径（Pack 器件必需）
    address = params.get("address")  # BIN 文件起始地址（HEX/ELF 使用文件自带地址）

    if not probe_id or not target or not file_path:
        raise ValueError("缺少烧录参数（probeId/target/filePath）")

    emit_log(f"连接烧录器：{probe_id}，目标芯片：{target}")
    session = _session(probe_id, target, verify=verify, pack=pack)
    try:
        from pyocd.flash.file_programmer import FileProgrammer

        chip_erase = "chip" if erase_mode == "chip" else "auto"
        programmer = FileProgrammer(
            session,
            progress=_progress_handler("program"),
            chip_erase=chip_erase,
        )
        if address:
            programmer.add_file(file_path, address=int(address))
        else:
            programmer.add_file(file_path)
        emit_log("开始编程...")
        programmer.commit()
        if verify:
            emit_log("烧录完成，校验通过")
        return {"ok": True, "verified": verify}
    finally:
        session.close()


def erase(params: dict[str, Any] | None = None) -> dict[str, Any]:
    """整片擦除（chip erase）。"""
    params = params or {}
    probe_id = params.get("probeId")
    target = params.get("target")
    pack = params.get("pack")
    if not probe_id or not target:
        raise ValueError("缺少擦除参数（probeId/target）")

    emit_log(f"整片擦除：{target}")
    session = _session(probe_id, target, pack=pack)
    try:
        from pyocd.flash.eraser import FlashEraser

        eraser = FlashEraser(session, FlashEraser.Mode.CHIP)
        eraser.erase()
        emit_log("整片擦除完成")
        return {"ok": True}
    finally:
        session.close()


def chip_info(params: dict[str, Any] | None = None) -> dict[str, Any]:
    """读取芯片信息：Chip ID / 内核 / Flash 大小 / UID。"""
    params = params or {}
    probe_id = params.get("probeId")
    target = params.get("target")
    pack = params.get("pack")
    if not probe_id or not target:
        raise ValueError("缺少芯片信息参数（probeId/target）")

    session = _session(probe_id, target, pack=pack)
    try:
        chip = session.target
        info: dict[str, Any] = {}

        # Flash 大小（从 memory_map 读取）
        try:
            info["flashSize"] = _flash_size(chip)
        except Exception:  # noqa: BLE001
            info["flashSize"] = None

        # STM32 DBGMCU_IDCODE（0xE0042000，兼容 F0/F1/F3/F4/F7 等）
        try:
            info["chipId"] = hex(chip.read32(0xE0042000))
        except Exception:  # noqa: BLE001
            info["chipId"] = None

        # 内核 Debug Port IDR
        try:
            info["coreId"] = hex(chip.dp.idr)
        except Exception:  # noqa: BLE001
            info["coreId"] = None

        # UID：常见 STM32 位置（F1/F2/F3/F4/F7 等为 0x1FFFF7E8）
        for uid_address in (0x1FFFF7E8, 0x1FFF7590, 0x1FFF7A10):
            try:
                uid_words = chip.read_memory_block32(uid_address, 3)
                info["uid"] = [f"{word:08X}" for word in uid_words]
                break
            except Exception:  # noqa: BLE001
                continue
        else:
            info["uid"] = []

        # 连接到的目标名称
        info["target"] = getattr(chip, "part_number", None) or target
        return info
    finally:
        session.close()
