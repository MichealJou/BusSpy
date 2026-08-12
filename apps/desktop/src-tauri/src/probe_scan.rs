//! USB 调试器快速识别（不依赖 pyOCD）。
//!
//! 直接用 rusb 枚举 USB 设备，按调试器的已知 VID/PID 认出来（毫秒级），
//! 与串口助手列设备同理：只认名字、不做协议交互；真正烧录时才由 pyOCD 连接。
//! 系统无 libusb 或初始化失败时返回 Err，调用方回退到 pyOCD 子进程枚举。

use std::time::Duration;

use serde_json::{json, Value};

/// 已知调试器表：(vid, pid, 厂商, 产品)。pid 为 0 表示匹配该 VID 下全部设备
/// （CMSIS-DAP 各厂商 PID 不统一，按 VID 或具体 PID 匹配）。
const KNOWN_DEBUGGERS: &[(u16, u16, &str, &str)] = &[
    // CMSIS-DAP / DAPLink（ARM 分配厂商 ID；NXP mbed）
    (0xC251, 0, "ARM", "CMSIS-DAP"),
    (0x0D28, 0, "NXP", "DAPLink"),
    // ATK-HS-V3 等基于 Microchip 芯片的 CMSIS-DAP（实测 VID=04D8 PID=00DF）
    (0x04D8, 0x00DF, "ATK", "CMSIS-DAP"),
    (0x04D8, 0x00D3, "Microchip", "CMSIS-DAP"),
    // ST-Link（STMicroelectronics）
    (0x0483, 0x3748, "STMicroelectronics", "ST-Link/V2"),
    (0x0483, 0x374B, "STMicroelectronics", "ST-Link/V2-1"),
    (0x0483, 0x3752, "STMicroelectronics", "ST-Link/V3"),
    (0x0483, 0x3754, "STMicroelectronics", "ST-Link/V3E"),
    // J-Link（SEGGER）
    (0x1366, 0, "SEGGER", "J-Link"),
];

/// 枚举 USB 调试器，返回与后端 probe.list 同结构的 JSON（毫秒级）。
///
/// ⚠️ ST-Link 等调试器在 macOS 上会暴露多个 USB 接口（HID + MSC/CDC），
/// 同一串号会枚举出多条。这里按串号去重，只保留第一条（烧录用主接口），
/// 避免前端列表出现重复探针、烧录时选中错误接口。
pub fn list_usb_probes() -> Result<Value, String> {
    let devices = rusb::devices().map_err(|error| format!("枚举 USB 设备失败：{error}"))?;

    let mut probes: Vec<Value> = Vec::new();
    let mut seen_serials: std::collections::HashSet<String> = std::collections::HashSet::new();
    for device in devices.iter() {
        let descriptor = match device.device_descriptor() {
            Ok(desc) => desc,
            Err(_) => continue,
        };
        let (vid, pid) = (descriptor.vendor_id(), descriptor.product_id());

        let mut matched: Option<(&str, &str)> = None;
        for &(known_vid, known_pid, vendor, product) in KNOWN_DEBUGGERS {
            if vid == known_vid && (known_pid == 0 || pid == known_pid) {
                matched = Some((vendor, product));
                break;
            }
        }
        let Some((vendor, product)) = matched else { continue };

        // 读 USB 串号作为 uniqueId（pyOCD 的 unique_id 通常即 USB 串号）
        let serial = read_serial(&device, &descriptor).unwrap_or_default();
        if !serial.is_empty() {
            if seen_serials.contains(&serial) {
                continue; // 同一探针的另一个 USB 接口，跳过
            }
            seen_serials.insert(serial.clone());
        }

        probes.push(json!({
            "id": serial,
            "vendor": vendor,
            "product": format!("{product} ({vid:04X}:{pid:04X})"),
            "uniqueId": serial,
            "protocols": ["swd"],
        }));
    }

    Ok(json!({ "probes": probes }))
}

/// 读取 USB 串号（iSerialNumber 字符串描述符）。
/// ⚠️ 部分设备（ATK-HS-V3 实测）返回的字符串末尾带 NUL（\0），
/// 直接发给 pyOCD 匹配 unique_id 会失败导致连接卡死，必须清理。
fn read_serial(
    device: &rusb::Device<rusb::GlobalContext>,
    descriptor: &rusb::DeviceDescriptor,
) -> Result<String, String> {
    let handle = device.open().map_err(|error| error.to_string())?;
    if descriptor.serial_number_string_index().is_none() {
        return Err("设备无 USB 串号".to_string());
    }
    let languages = handle
        .read_languages(Duration::from_secs(1))
        .map_err(|error| error.to_string())?;
    let language = *languages
        .first()
        .ok_or_else(|| "设备无 USB 语言描述".to_string())?;
    let serial = handle
        .read_serial_number_string(language, descriptor, Duration::from_secs(1))
        .map_err(|error| error.to_string())?;
    Ok(serial.trim_end_matches('\0').trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 真实 USB 枚举验证（系统需有 libusb；有探针插着时能列出）。
    #[test]
    fn usb_probes_scan_succeeds() {
        let result = list_usb_probes();
        assert!(result.is_ok(), "USB 枚举应成功：{:?}", result.err());
        if let Ok(value) = result {
            let probes = value["probes"].as_array().map(|a| a.len()).unwrap_or(0);
            println!("检测到 {} 个调试器", probes);
            for probe in value["probes"].as_array().unwrap_or(&Vec::new()) {
                let uid = probe["uniqueId"].as_str().unwrap_or("");
                println!(
                    "  {} / {} / uniqueId={}",
                    probe["vendor"].as_str().unwrap_or(""),
                    probe["product"].as_str().unwrap_or(""),
                    uid
                );
                // 串号不得含 NUL 或首尾空白：pyOCD 匹配 unique_id 会因此卡死
                assert!(!uid.contains('\0'), "uniqueId 不应含 NUL：{:?}", uid);
                assert_eq!(uid, uid.trim(), "uniqueId 不应含首尾空白：{:?}", uid);
            }
        }
    }
}
