"""SWD 烧录：连接 / 擦除 / 编程 / 校验 / 芯片信息读取。

基于 pyOCD 统一支持 CMSIS-DAP / ST-Link / J-Link 调试器。
Pack 器件通过显式 pack 路径（session option "pack"）解析，避免依赖在线索引版本。
烧录进度通过 rpc.emit 推送 "flash.progress" 事件，阶段日志推送 "flash.log"。
"""

from __future__ import annotations

from typing import Any, Callable

from .rpc import emit, emit_log

# 默认 SWD 时钟频率。
# ⚠️ 不要设 4MHz：实测 ATK-HS-V3（CMSIS-DAP）在 4MHz 下 Flash 擦除算法执行
# 会 HardFault（pyOCD FlashFailure IPSR=3），烧录必失败。1MHz 与 pyOCD 默认一致，
# 对杜邦线/老固件探针最稳。前端 Max Clock 可调高，但默认保持 1MHz。
DEFAULT_FREQUENCY = 1_000_000


def _normalise_progress(value: float) -> int:
    """pyOCD 进度回调可能传 0-1 或 0-100，统一为 0-100 整数。"""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    return max(0, min(100, int(number * 100 if number <= 1 else number)))


def _normalise_id(value: str) -> str:
    """归一化探针 ID：去掉前导 0、空格、常见分隔符。

    rusb（前端枚举）与 pyOCD（后端连接）对同一探针的 ID 表示可能不同：
    如 J-Link 串号 rusb 读作 "000020090928"，pyOCD 为 "20090928"。
    归一化后比较避免匹配失败。
    """
    return "".join(ch for ch in value.strip() if ch.isalnum()).lstrip("0")


def _probe_id_matches(probe, probe_id: str) -> bool:
    """判断 pyOCD probe 是否匹配目标 ID（精确 + 归一化两种比较）。"""
    uid = getattr(probe, "unique_id", None) or ""
    pid = getattr(probe, "probe_id", None) or ""
    return (
        uid == probe_id
        or pid == probe_id
        or (_normalise_id(uid) and _normalise_id(uid) == _normalise_id(probe_id))
        or (_normalise_id(pid) and _normalise_id(pid) == _normalise_id(probe_id))
    )


def _open_session(probe, target: str, options: dict[str, Any]):
    """用指定 probe 对象建会话并打开（target 必须传入，否则退回 cortex_m）。"""
    from pyocd.core.session import Session

    session = Session(
        probe,
        auto_open=False,
        options=options,
        target_override=target or None,
    )
    if session is None:
        raise RuntimeError("无法创建 pyOCD 会话")
    if not session.is_open:
        session.open()
    return session


def _session(probe_id: str, target: str, verify: bool = True, pack: str | None = None, frequency: int = DEFAULT_FREQUENCY):
    from pyocd.core.helpers import ConnectHelper

    # ⚠️ 防卡死：先非阻塞枚举探针。pyOCD 的 session_with_chosen_probe 默认
    # blocking=True，匹配不上会无限循环等待探针插入（前端表现为"一直连接中"）。
    # 这里提前枚举 + 校验，匹配失败立即抛错，不让 pyOCD 进入等待循环。
    connected = ConnectHelper.get_all_connected_probes(blocking=False, unique_id=None)
    if not connected:
        raise RuntimeError("未检测到烧录器，请检查 USB 连接后刷新")

    options: dict[str, Any] = {"frequency": frequency, "verify": verify}
    if pack:
        options["pack"] = pack
    emit_log(f"[连接] 创建 pyOCD 会话（target={target}，SWD {frequency // 1_000_000}MHz）...")

    # 首选探针：指定的 probe_id；未指定/匹配不上时用全部在线探针作为候选。
    candidates: list = []
    if probe_id:
        emit_log(f"[连接] 检查烧录器 {probe_id} 是否在线...")
        candidates = [p for p in connected if _probe_id_matches(p, probe_id)]
        if not candidates:
            raise RuntimeError(f"未找到烧录器 {probe_id}，请检查连接后刷新")
        emit_log(f"[连接] 烧录器在线：{probe_id}")
    else:
        candidates = list(connected)

    # 依次尝试每个候选探针：前一个连不上（探针硬件问题/接线问题）时自动换下一个。
    last_error: Exception | None = None
    for probe in candidates:
        uid = getattr(probe, "unique_id", None) or getattr(probe, "probe_id", None) or "unknown"
        emit_log(f"[连接] 尝试烧录器：{uid} ...")
        try:
            session = _open_session(probe, target, options)
            emit_log(f"[连接] 会话就绪：{getattr(session.target, 'part_number', target)}")
            return session
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            emit_log(f"[连接] 烧录器 {uid} 连接失败（{str(exc)[:60]}），尝试下一个...")

    raise RuntimeError(
        f"连接目标芯片失败（{last_error}）。请检查："
        "① SWD 接线（SWDIO/SWCLK/GND 与目标板对应）；"
        "② 目标板独立供电；"
        "③ 探针接口电压与芯片匹配；"
        "④ 芯片是否被读保护（RDP）"
    ) from last_error


def _auto_detect_target(probe_id: str, pack: str | None = None, frequency: int = DEFAULT_FREQUENCY) -> str:
    """按芯片 IDCODE 自动识别 target：连接 → 读 IDCODE → DEVID 查表推断。"""
    try:
        session = _session(probe_id, None, pack=pack, frequency=frequency)
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


def _resolve_probe_id(probe_id: str | None) -> str:
    """确定要连接的探针 ID。

    - 显式传了 probeId：直接使用
    - 未传：枚举当前探针，恰好只有一个时自动用它；多个时要求明确选择
    """
    if probe_id:
        return probe_id
    from pyocd.core.helpers import ConnectHelper

    probes = ConnectHelper.get_all_connected_probes(blocking=False, unique_id=None)
    if not probes:
        raise ValueError("未检测到烧录器，请检查 USB 连接后刷新")
    if len(probes) == 1:
        uid = getattr(probes[0], "unique_id", None) or getattr(probes[0], "probe_id", None) or ""
        emit_log(f"[连接] 自动选择唯一烧录器：{uid or 'unknown'}")
        return uid
    raise ValueError(f"检测到 {len(probes)} 个烧录器，请在界面选择要使用的烧录器")


def program(params: dict[str, Any] | None = None) -> dict[str, Any]:
    """烧录固件：连接 → 擦除 → 编程 → 校验。"""
    params = params or {}
    probe_id = _resolve_probe_id(params.get("probeId"))
    target = params.get("target") or ""
    file_path = params.get("filePath")
    erase_mode = params.get("eraseMode", "auto")
    verify = params.get("verify", True)
    pack = params.get("pack")
    address = params.get("address")
    frequency = int(params.get("frequency", DEFAULT_FREQUENCY))
    algorithm = params.get("algorithm") or ""

    if not file_path:
        raise ValueError("缺少烧录参数（filePath）")

    # target 为空时按芯片 ID 自动识别（DEVID → target 推断）
    if not target:
        target = _auto_detect_target(probe_id, pack)
        emit_log(f"自动识别芯片型号：{target}")

    emit_log(f"连接烧录器：{probe_id}，目标芯片：{target}")
    if algorithm:
        emit_log(f"[烧录] 烧录算法：{algorithm}（前端指定）")
    session = _session(probe_id, target, verify=verify, pack=pack, frequency=frequency)
    try:
        from pyocd.flash.file_programmer import FileProgrammer

        chip_erase = "chip" if erase_mode == "chip" else "auto"
        programmer = FileProgrammer(
            session,
            progress=_progress_handler("program"),
            chip_erase=chip_erase,
        )
        if address:
            emit_log(f"[烧录] 固件：{file_path}（地址 0x{int(address):X}）")
            programmer.add_file(file_path, address=int(address))
        else:
            emit_log(f"[烧录] 固件：{file_path}")
            programmer.add_file(file_path)
        emit_log(f"[烧录] 开始编程（擦除模式：{chip_erase}）...")
        programmer.commit()
        if verify:
            emit_log("[烧录] 校验通过，烧录完成")
        else:
            emit_log("[烧录] 烧录完成（未校验）")

        # ⚠️ 烧录后必须复位运行：pyOCD 编程时把 core halt 住了，commit 结束不复位，
        # 芯片会停在 halt 状态 —— 表现为"烧录成功但设备没反应"。
        try:
            emit_log("[烧录] 复位芯片，启动固件...")
            session.target.reset_and_halt()
            session.target.resume()
            emit_log("[烧录] 芯片已复位运行")
        except Exception as exc:  # noqa: BLE001
            emit_log(f"[烧录] 复位运行失败（{exc}），可手动按复位键")
        return {"ok": True, "verified": verify}
    finally:
        session.close()
        emit_log("[烧录] 会话已释放")


def erase(params: dict[str, Any] | None = None) -> dict[str, Any]:
    """整片擦除（chip erase）。"""
    params = params or {}
    probe_id = _resolve_probe_id(params.get("probeId"))
    target = params.get("target") or ""
    pack = params.get("pack")
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
    0x413: "stm32f407zg",  # F40x/41x（含 F407ZG）
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
    probe_id = _resolve_probe_id(params.get("probeId"))
    target = params.get("target") or ""
    pack = params.get("pack")

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

        # UID：不同系列地址不同，且部分探针读某些地址会 SWD fault。
        # 按"F4+ (0x1FFF7A10) → F1/F2/F3/F7 (0x1FFFF7E8) → 老 F1 (0x1FFF7590)"顺序尝试；
        # 读取成功且非全 0 才算有效（避免拿到错误的空值提前退出）。
        info["uid"] = []
        for uid_address in (0x1FFF7A10, 0x1FFFF7E8, 0x1FFF7590):
            try:
                uid_words = chip.read_memory_block32(uid_address, 3)
                words = [f"{word:08X}" for word in uid_words]
            except Exception:  # noqa: BLE001
                continue
            if any(word != "00000000" for word in words):
                info["uid"] = words
                break

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
