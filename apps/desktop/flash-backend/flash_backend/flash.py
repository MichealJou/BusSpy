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
    session = ConnectHelper.session_with_chosen_probe(
        unique_id=probe_id,
        target_override=target,
        options=options,
    )
    if session is None:
        raise RuntimeError(f"无法连接烧录器/芯片：{probe_id}")
    # pyOCD 0.45：session_with_chosen_probe 不再自动打开 session，
    # 必须显式 open()，否则 target 未初始化（读内存报 "no selected core"、
    # 烧录/擦除也会失败）
    if not session.is_open:
        session.open()
    return session


def _auto_detect_target(probe_id: str, pack: str | None = None) -> str:
    """按芯片 IDCODE 自动识别 target：连接 → 读 IDCODE → DEVID 查表推断。"""
    try:
        session = _session(probe_id, None, pack=pack)
        try:
            chip_id = session.target.read32(0xE0042000)
            devid = chip_id & 0xFFF
            suggested = STM32_DEVID_TARGETS.get(devid)
            if suggested:
                return suggested
        finally:
            session.close()
    except Exception:  # noqa: BLE001
        pass
    return "cortex_m"  # fallback：通用 Cortex-M


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
    target = params.get("target") or ""
    file_path = params.get("filePath")
    erase_mode = params.get("eraseMode", "auto")
    verify = params.get("verify", True)
    pack = params.get("pack")
    address = params.get("address")

    if not probe_id or not file_path:
        raise ValueError("缺少烧录参数（probeId/filePath）")

    # target 为空时按芯片 ID 自动识别（DEVID → target 推断）
    if not target:
        target = _auto_detect_target(probe_id, pack)
        emit_log(f"自动识别芯片型号：{target}")

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
    target = params.get("target") or ""
    pack = params.get("pack")
    if not probe_id:
        raise ValueError("缺少擦除参数（probeId）")
    if not target:
        target = _auto_detect_target(probe_id, pack)
        emit_log(f"自动识别芯片型号：{target}")

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


# 常见 STM32 芯片 ID（DBGMCU_IDCODE 低 12 位 DEVID）→ 建议 target。
# 优先映射到 pyOCD 内置可用的 target（无需装 DFP 即可连接）；
# F2/F3/G0/G4 等需 DFP 的保留常见名，重连失败时容错返回基础信息。
STM32_DEVID_TARGETS: dict[int, str] = {
    0x410: "stm32f103rc",  # F1 medium-density（内置可用）
    0x411: "stm32f103rc",  # F1 high-density
    0x412: "stm32f103rc",  # F1 connectivity（F105/F107）
    0x413: "stm32f103rc",  # F1 low-density
    0x418: "stm32f103rc",  # F1 XL-density
    0x420: "stm32f205rg",  # F2（需 DFP）
    0x421: "stm32f207zg",  # F2（需 DFP）
    0x422: "stm32f407vg",  # F4 F40x/41x（Keil.STM32F4xx_DFP）
    0x423: "stm32f405rg",  # F4 F405/407
    0x419: "stm32f429xi",  # F4 F42x/43x（内置可用）
    0x430: "stm32f446re",  # F4 F446
    0x431: "stm32f411re",  # F4 F411
    0x433: "stm32f401re",  # F4 F401
    0x440: "stm32f051",    # F0（内置可用）
    0x441: "stm32f051",    # F0 F05x
    0x442: "stm32f303cb",  # F3 F303（需 DFP）
    0x446: "stm32f302x8",  # F3 F302
    0x447: "stm32l031x6",  # L0（内置可用）
    0x448: "stm32f051",    # F0 F09x
    0x450: "stm32h743xx",  # H7（内置可用）
    0x451: "stm32l432kc",  # L4（内置可用）
    0x452: "stm32l475xc",  # L4（内置可用）
    0x456: "stm32l031x6",  # L0
    0x457: "stm32l031x6",  # L0
    0x461: "stm32g431",    # G4（需 DFP）
    0x462: "stm32g0x1",    # G0（需 DFP）
    0x464: "stm32g4x1",    # G4
    0x470: "stm32l4r9",    # L4+
    0x480: "stm32l475xc",  # L4
    0x483: "stm32g0x1",    # G0
    0x484: "stm32l475xc",  # L4
    0x490: "stm32wb55",    # WB（需 DFP）
    0x492: "stm32f767zi",  # F7（内置可用）
    0x495: "stm32f767zi",  # F7
    0x496: "stm32f767zi",  # F7
    0x4A0: "stm32u5x",     # U5（需 DFP）
}


def chip_info(params: dict[str, Any] | None = None) -> dict[str, Any]:
    """读取芯片信息：Chip ID / 内核 / Flash 大小 / UID。

    target 可省略：连接后自动识别（先读 IDCODE，按 DEVID 推断型号重连读取
    Flash/RAM，返回 suggestedTarget 供前端自动选择器件）。
    """
    params = params or {}
    probe_id = params.get("probeId")
    target = params.get("target") or ""
    pack = params.get("pack")
    if not probe_id:
        raise ValueError("缺少芯片信息参数（probeId）")

    # 第一段：连接（有 target 用指定，无则 generic 自动识别，读 IDCODE）
    session = _session(probe_id, target or None, pack=pack)
    try:
        chip = session.target
        info: dict[str, Any] = {}

        # STM32 DBGMCU_IDCODE（0xE0042000，兼容 F0/F1/F3/F4/F7 等）
        chip_id: int | None = None
        try:
            chip_id = chip.read32(0xE0042000)
            info["chipId"] = hex(chip_id)
        except Exception:  # noqa: BLE001
            info["chipId"] = None

        # 内核 Debug Port IDR
        try:
            info["coreId"] = hex(chip.dp.idr)
        except Exception:  # noqa: BLE001
            info["coreId"] = None

        # UID：常见 STM32 位置（F1/F2/F3/F4/F7 等为 0x1FFFF7E8）
        info["uid"] = []
        for uid_address in (0x1FFFF7E8, 0x1FFF7590, 0x1FFF7A10):
            try:
                uid_words = chip.read_memory_block32(uid_address, 3)
                info["uid"] = [f"{word:08X}" for word in uid_words]
                break
            except Exception:  # noqa: BLE001
                continue

        info["target"] = getattr(chip, "part_number", None) or target or "自动识别"
        info["flashSize"] = _flash_size(chip)
        info["suggestedTarget"] = None

        # 未选器件 / generic 无 Flash 定义时：按 DEVID 推断型号，重连读取完整信息
        if info["flashSize"] is None and chip_id is not None:
            devid = chip_id & 0xFFF
            suggested = STM32_DEVID_TARGETS.get(devid)
            if suggested:
                info["suggestedTarget"] = suggested
                emit_log(f"按芯片 ID 识别型号：{suggested}")
                try:
                    session.close()
                    session = _session(probe_id, suggested, pack=pack)
                    chip = session.target
                    info["flashSize"] = _flash_size(chip)
                    info["target"] = getattr(chip, "part_number", None) or suggested
                except Exception as exc:  # noqa: BLE001 - 推断 target 未安装 DFP 时保留基础信息
                    emit_log(f"按 ID 识别的型号不可用（{exc}），已保留基础信息")
        return info
    finally:
        session.close()
