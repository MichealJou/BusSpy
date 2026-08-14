//! probe-rs 快速通道。
//!
//! 对 probe-rs 兼容的探针（ST-Link / J-Link / 标准 CMSIS-DAP）直接用 Rust
//! 单进程烧录/擦除/读芯片，无 Python 子进程启动开销。
//! 不兼容的探针（如 Microchip 04D8 系列的 CMSIS-DAP）由调用方回退 pyOCD。

use std::path::Path;

use probe_rs::flashing::{self, BinOptions, DownloadOptions, Format};
use probe_rs::probe::list::Lister;
use probe_rs::{MemoryInterface, Permissions, Session};
use serde_json::{json, Value};

const DBGMCU_IDCODE: u64 = 0xE004_2000;
const UID_ADDRS: [u64; 3] = [0x1FFF_7A10, 0x1FFF_F7E8, 0x1FFF_7590];

/// STM32 DEVID(12bit) -> target 映射表（与 flash.py STM32_DEVID_TARGETS 一致）
const STM32_DEVID_TARGETS: &[(u32, &str)] = &[
    (0x410, "STM32F103RC"),
    (0x411, "STM32F103RC"),
    (0x412, "STM32F103RC"),
    (0x413, "STM32F407ZG"),
    (0x418, "STM32F103RC"),
    (0x419, "STM32F429XI"),
    (0x420, "STM32F205RG"),
    (0x421, "STM32F207ZG"),
    (0x422, "STM32F407VG"),
    (0x423, "STM32F405RG"),
    (0x430, "STM32F446RE"),
    (0x431, "STM32F411RE"),
    (0x433, "STM32F401RE"),
    (0x440, "STM32F051"),
    (0x441, "STM32F051"),
    (0x442, "STM32F303CB"),
    (0x446, "STM32F302x8"),
    (0x447, "STM32L031x6"),
    (0x448, "STM32F051"),
    (0x450, "STM32H743xx"),
    (0x451, "STM32L432KC"),
    (0x452, "STM32L475xC"),
    (0x456, "STM32L031x6"),
    (0x457, "STM32L031x6"),
    (0x461, "STM32G431"),
    (0x462, "STM32G0x1"),
    (0x464, "STM32G4x1"),
    (0x470, "STM32L4R9"),
    (0x480, "STM32L475xC"),
    (0x483, "STM32G0x1"),
    (0x484, "STM32L475xC"),
    (0x490, "STM32WB55"),
    (0x492, "STM32F767ZI"),
    (0x495, "STM32F767ZI"),
    (0x496, "STM32F767ZI"),
    (0x4A0, "STM32U5x"),
];

/// probe-rs 快速通道白名单：已知兼容的调试器 VID。
/// 白名单外的（如 Microchip 04D8 的 ATK）不碰 probe-rs，直接回退 pyOCD，
/// 从源头避免「probe-rs 打开失败后残留 HID 句柄 → pyOCD 报 already open」。
fn is_fast_probe_vid(vid: u16) -> bool {
    matches!(
        vid,
        0x0483 | // ST-Link (STMicroelectronics)
        0x1366 | // J-Link (SEGGER)
        0x0d28 | // DAPLink (ARM mbed)
        0xc251 | // ULINK (Keil)
        0x1fc9 | // LPC-Link (NXP)
        0x2e8a | // Raspberry Pi Debug Probe
        0x1209 // pid.codes (各类 CMSIS-DAP)
    )
}

/// 尝试用 probe-rs 打开探针并 attach 到 target。
/// 失败返回 Err（调用方据此回退 pyOCD）。
pub fn try_open(target: &str, probe_id: &str) -> Result<Session, String> {
    let lister = Lister::new();
    let infos = lister.list_all();
    if infos.is_empty() {
        return Err("未检测到探针".to_string());
    }
    let info = if probe_id.is_empty() {
        infos.first().ok_or_else(|| "未检测到探针".to_string())?
    } else {
        infos
            .iter()
            .find(|i| i.serial_number.as_deref() == Some(probe_id) || i.identifier == probe_id)
            .ok_or_else(|| format!("未找到探针 {probe_id}"))?
    };
    // 不在白名单：不打开探针，直接返回 Err，让调用方回退 pyOCD
    if !is_fast_probe_vid(info.vendor_id) {
        return Err(format!(
            "探针 VID={:04X} 不在快速通道白名单，回退 pyOCD",
            info.vendor_id
        ));
    }
    let mut probe = lister
        .open(info)
        .map_err(|e| format!("打开探针失败：{e}"))?;
    let _ = probe.set_speed(1000); // 1MHz，与 pyOCD 默认一致
    probe
        .attach(target, Permissions::default())
        .map_err(|e| format!("连接目标 {target} 失败：{e}"))
}

fn file_format(path: &Path) -> Result<Format, String> {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("hex") || ext.eq_ignore_ascii_case("ihex") => {
            Ok(Format::Hex)
        }
        Some(ext) if ext.eq_ignore_ascii_case("bin") => Ok(Format::Bin(BinOptions::default())),
        Some(ext) if ext.eq_ignore_ascii_case("elf") => Ok(Format::Elf(Default::default())),
        _ => Err(format!(
            "不支持的文件类型：{}（仅支持 HEX/BIN/ELF）",
            path.display()
        )),
    }
}

/// probe-rs 烧录固件。
pub fn program(
    session: &mut Session,
    file_path: &str,
    erase_mode: &str,
    verify: bool,
) -> Result<(), String> {
    let path = Path::new(file_path);
    if !path.is_file() {
        return Err(format!("文件不存在：{file_path}"));
    }
    let format = file_format(path)?;

    let mut loader = session.target().flash_loader();
    let mut file = std::fs::File::open(path).map_err(|e| format!("打开文件失败：{e}"))?;
    loader
        .load_image(session, &mut file, format, None)
        .map_err(|e| format!("解析固件失败：{e}"))?;

    let mut options = DownloadOptions::default();
    options.do_chip_erase = erase_mode == "chip";
    options.verify = verify;
    options.keep_unwritten_bytes = true;

    loader
        .commit(session, options)
        .map_err(|e| format!("烧录失败：{e}"))?;

    // 烧录后复位运行
    let _ = session.core(0).and_then(|mut core| core.reset());
    Ok(())
}

/// probe-rs 整片擦除。
pub fn erase(session: &mut Session) -> Result<(), String> {
    let mut progress = flashing::FlashProgress::new(|_| {});
    flashing::erase_all(session, &mut progress, false).map_err(|e| format!("整片擦除失败：{e}"))
}

/// probe-rs 读芯片信息（chipId / uid / suggestedTarget）。
pub fn read_chip_info(session: &mut Session, target: &str) -> Result<Value, String> {
    let mut core = session
        .core(0)
        .map_err(|e| format!("获取 core 失败：{e}"))?;

    let mut info = json!({});
    let chip_id = core.read_word_32(DBGMCU_IDCODE).ok();
    info["chipId"] = chip_id.map(|v| json!(format!("0x{v:X}"))).unwrap_or(Value::Null);

    let mut uid: Vec<String> = Vec::new();
    for addr in UID_ADDRS {
        match core.read_word_32(addr) {
            Ok(w) if w != 0 => {
                uid.push(format!("{w:08X}"));
                break;
            }
            _ => {}
        }
    }
    info["uid"] = json!(uid);
    info["target"] = json!(target);

    let devid = chip_id.map(|v| v & 0xFFF);
    let suggested = devid.and_then(|d| {
        STM32_DEVID_TARGETS
            .iter()
            .find(|(dd, _)| *dd == d)
            .map(|(_, t)| *t)
    });
    info["suggestedTarget"] = suggested.map(|s| json!(s)).unwrap_or(Value::Null);

    Ok(info)
}
