//! CMSIS DFP Pack 在线搜索 / 下载 / 安装（纯 Rust，不依赖 Python 后端）。
//!
//! 搜索复用 pyOCD / cmsis-pack-manager 维护的 index.json（JSON 器件索引）：
//! 每个器件描述符的 `from_pack` 自带 `{vendor, pack, version, url}`，其中
//! `url` 即 Pack 下载基址。下载时拼出完整地址用 reqwest 拉取 .pack 文件，
//! 写入 `<data_path>/<Vendor>/<Pack>/<version>.pack` 布局，pyOCD 即可自动识别。
//!
//! 数据目录优先使用 Python 端 `pack.list` 返回的 dataPath（与 cmsis-pack-manager
//! 完全一致），缺失时按 dirs 规则计算（macOS: ~/Library/Application Support/...）。

use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Emitter};

/// cmsis-pack-manager 数据目录（从 Python `pack.list` 的 dataPath 顺带缓存）
static CACHED_DATA_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

/// 器件索引缓存（TTL 5s），避免每次搜索/下载都重新读 30MB 的 index.json
static INDEX_CACHE: Mutex<Option<(std::time::Instant, Value)>> = Mutex::new(None);
const INDEX_TTL: Duration = Duration::from_secs(5);

/// 单次下载进度事件的最小间隔（避免高频 emit 刷爆 WebView）
const PROGRESS_INTERVAL: Duration = Duration::from_millis(200);

/// 数据目录（flasher::flash_list_packs 解析 Python 返回值时调用）。
pub fn set_data_dir(dir: PathBuf) {
    if let Ok(mut guard) = CACHED_DATA_DIR.lock() {
        *guard = Some(dir);
    }
}

/// cmsis-pack-manager 数据目录：优先用 Python 端缓存的 dataPath，
/// 缺失时按 dirs 规则计算（与 cmsis-pack-manager 的 Cache 一致）。
pub fn data_dir() -> Result<PathBuf, String> {
    if let Ok(guard) = CACHED_DATA_DIR.lock() {
        if let Some(dir) = guard.as_ref() {
            if dir.is_dir() {
                return Ok(dir.clone());
            }
        }
    }
    let base = dirs::data_dir().ok_or_else(|| "无法确定用户数据目录".to_string())?;
    Ok(base.join("cmsis-pack-manager"))
}

/// 读取（并缓存）器件索引 index.json。
fn load_index() -> Result<Value, String> {
    let dir = data_dir()?;
    let index_path = dir.join("index.json");
    if !index_path.is_file() {
        return Err("器件索引未生成，请先完成烧录页环境自检（会自动生成索引）".to_string());
    }
    if let Ok(guard) = INDEX_CACHE.lock() {
        if let Some((ts, value)) = guard.as_ref() {
            if ts.elapsed() < INDEX_TTL {
                return Ok(value.clone());
            }
        }
    }
    let raw = fs::read_to_string(&index_path).map_err(|error| format!("读取器件索引失败：{error}"))?;
    let value: Value =
        serde_json::from_str(&raw).map_err(|error| format!("解析器件索引失败：{error}"))?;
    if let Ok(mut guard) = INDEX_CACHE.lock() {
        *guard = Some((std::time::Instant::now(), value.clone()));
    }
    Ok(value)
}

/// memory 是否为默认内存（default 字段可能是布尔 true 或字符串 "1"）。
fn is_default_memory(memory: &Value) -> bool {
    match memory.get("default") {
        Some(Value::Bool(true)) => true,
        Some(Value::String(value)) => value == "1",
        _ => false,
    }
}

/// 从器件描述符的 memories 中取 Flash 大小（KB）。
/// 优先取名字含 Flash/IROM/ROM 的默认内存，fallback 任意默认内存。
fn default_flash_kb(descriptor: &Value) -> Option<u64> {
    let memories = descriptor.get("memories")?.as_object()?;
    for (name, memory) in memories {
        let name_lower = name.to_lowercase();
        if (name_lower.contains("flash") || name_lower.contains("irom") || name_lower.contains("rom"))
            && is_default_memory(memory)
        {
            if let Some(size) = memory.get("size").and_then(|value| value.as_u64()) {
                return Some(size / 1024);
            }
        }
    }
    for memory in memories.values() {
        if is_default_memory(memory) {
            if let Some(size) = memory.get("size").and_then(|value| value.as_u64()) {
                return Some(size / 1024);
            }
        }
    }
    None
}

/// 从器件描述符的 memories 中取 RAM 总大小（KB）（SRAM/IRAM/RAM 段累加）。
fn default_ram_kb(descriptor: &Value) -> Option<u64> {
    let memories = descriptor.get("memories")?.as_object()?;
    let mut total: u64 = 0;
    let mut found = false;
    for (name, memory) in memories {
        let name_lower = name.to_lowercase();
        if !(name_lower.contains("ram") || name_lower.contains("sram") || name_lower.contains("iram")) {
            continue;
        }
        if let Some(size) = memory.get("size").and_then(|value| value.as_u64()) {
            total += size / 1024;
            found = true;
        }
    }
    if found { Some(total) } else { None }
}

/// 在索引中按关键字匹配器件（核心逻辑，可脱离文件系统单测）。
/// 返回（截断后的结果、匹配总数、涉及 Pack 列表）。
fn search_in_index(index: &Value, query_lower: &str) -> (Vec<Value>, usize, BTreeSet<String>) {
    let mut results: Vec<Value> = Vec::new();
    let mut seen_packs: BTreeSet<String> = BTreeSet::new();
    if let Value::Object(descriptors) = index {
        for (name, descriptor) in descriptors {
            if !name.to_lowercase().contains(query_lower) {
                continue;
            }
            let from_pack = descriptor.get("from_pack").and_then(|value| value.as_object());
            let pack_name = from_pack
                .map(|fp| {
                    let vendor = fp.get("vendor").and_then(|v| v.as_str()).unwrap_or("");
                    let pack = fp.get("pack").and_then(|v| v.as_str()).unwrap_or("");
                    if vendor.is_empty() || pack.is_empty() {
                        String::new()
                    } else {
                        format!("{vendor}.{pack}")
                    }
                })
                .unwrap_or_default();
            let version = from_pack
                .and_then(|fp| fp.get("version"))
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string();
            if pack_name.is_empty() {
                continue;
            }
            results.push(json!({
                "device": name,
                "pack": pack_name,
                "version": version,
                "flashKb": default_flash_kb(descriptor),
            }));
            seen_packs.insert(pack_name);
        }
    }

    results.sort_by(|a, b| {
        a.get("device")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .cmp(b.get("device").and_then(|value| value.as_str()).unwrap_or(""))
    });
    let total = results.len();
    results.truncate(100);
    (results, total, seen_packs)
}

/// 在线搜索器件：按型号关键字匹配索引，返回器件 + 所属 Pack（最多 100 条）。
pub fn search(query: &str) -> Result<Value, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("缺少搜索关键字".to_string());
    }
    let index = load_index()?;
    let (results, total, seen_packs) = search_in_index(&index, &query.to_lowercase());
    Ok(json!({ "results": results, "total": total, "packs": seen_packs }))
}

/// 版本字符串转数值序列（用于比较，避免 "2.10.0" < "2.9.0" 的字符串比较陷阱）。
fn version_tuple(version: &str) -> Vec<u32> {
    version
        .split('.')
        .filter_map(|part| part.parse::<u32>().ok())
        .collect()
}

/// 按 Pack 名聚合索引（核心逻辑，可脱离文件系统单测），返回 Pack 清单行。
fn aggregate_packs(index: &Value) -> Vec<Value> {
    // pack 名 -> (vendor, pack, 最新版本, 器件数)
    let mut packs: std::collections::BTreeMap<String, (String, String, String, u64)> =
        std::collections::BTreeMap::new();
    if let Value::Object(descriptors) = index {
        for descriptor in descriptors.values() {
            let Some(from_pack) = descriptor.get("from_pack").and_then(|value| value.as_object()) else {
                continue;
            };
            let vendor = from_pack.get("vendor").and_then(|v| v.as_str()).unwrap_or("");
            let pack = from_pack.get("pack").and_then(|v| v.as_str()).unwrap_or("");
            let version = from_pack.get("version").and_then(|v| v.as_str()).unwrap_or("");
            if vendor.is_empty() || pack.is_empty() {
                continue;
            }
            let key = format!("{vendor}.{pack}");
            let entry = packs
                .entry(key)
                .or_insert_with(|| (vendor.to_string(), pack.to_string(), String::new(), 0));
            entry.3 += 1;
            if version_tuple(version) > version_tuple(&entry.2) {
                entry.2 = version.to_string();
            }
        }
    }

    packs
        .into_values()
        .map(|(vendor, pack, version, device_count)| {
            json!({
                "device": vendor,
                "pack": format!("{vendor}.{pack}"),
                "version": version,
                "flashKb": null,
                "deviceCount": device_count,
            })
        })
        .collect()
}

/// 内置 51（8051）系列常用器件。
///
/// CMSIS-Pack 索引只覆盖 ARM 核，8051 不在其中；且 pyOCD / 串口 ISP 均
/// 不支持 8051 烧录。这里内置常见型号供器件清单分类展示（标记 builtin，
/// 不做在线下载）。后续接入 51 ISP 协议时作为器件库基础。
const BUILTIN_MCS51: &[(&str, &str)] = &[
    ("STC89C52RC", "STC"),
    ("STC89C516RD+", "STC"),
    ("STC12C5A60S2", "STC"),
    ("STC15F2K60S2", "STC"),
    ("STC8A8K64S4A12", "STC"),
    ("IAP15F2K61S2", "STC"),
    ("AT89C51", "Atmel"),
    ("AT89S51", "Atmel"),
    ("AT89S52", "Atmel"),
    ("C8051F340", "Silicon Labs"),
    ("N76E003", "Nuvoton"),
];

/// 分类名称（供前端映射显示名）：
/// - stm32：Keil.STM32*_DFP / STMicroelectronics.stm32*（可在线下载）
/// - mcs51：内置 8051 清单（不可下载）
/// - gd32：GigaDevice.GD32*_DFP（可在线下载）
/// - other：其余厂商 Pack
fn classify_pack(pack_name: &str) -> &'static str {
    let lower = pack_name.to_lowercase();
    if lower.contains("stm32") {
        "stm32"
    } else if lower.contains("gd32") || lower.starts_with("gigadevice.") {
        "gd32"
    } else {
        "other"
    }
}

/// 列出索引中的全部 Pack，按用户关注的分类组织（Keil Pack Installer 风格层级）：
/// 分类（STM32 / 51 / GD32 / 其他厂商）→ Pack。返回：
/// { "categories": [ { key, builtin?, packs: [...] }, ... ] }
pub fn list_all() -> Result<Value, String> {
    let index = load_index()?;
    let all = aggregate_packs(&index);

    let mut stm32: Vec<Value> = Vec::new();
    let mut gd32: Vec<Value> = Vec::new();
    let mut other: Vec<Value> = Vec::new();
    for pack in all {
        match classify_pack(pack.get("pack").and_then(|v| v.as_str()).unwrap_or("")) {
            "stm32" => stm32.push(pack),
            "gd32" => gd32.push(pack),
            _ => other.push(pack),
        }
    }

    let mcs51: Vec<Value> = BUILTIN_MCS51
        .iter()
        .map(|(name, vendor)| {
            json!({
                "device": name,
                "pack": name,
                "vendor": vendor,
                "version": "",
                "flashKb": null,
                "deviceCount": 1,
                "builtin": true,
            })
        })
        .collect();

    Ok(json!({
        "categories": [
            { "key": "stm32", "packs": stm32 },
            { "key": "mcs51", "builtin": true, "packs": mcs51 },
            { "key": "gd32", "packs": gd32 },
            { "key": "other", "packs": other },
        ]
    }))
}

/// 器件树（Keil Pack Installer Devices 风格）：厂商 → 系列 → 器件。
///
/// 供下载器左侧树形导航；右侧详情从选中器件取 Pack / 版本 / Flash / RAM。
/// 8051 内置器件归入独立厂商节点（builtin 标记，不可下载）。
pub fn device_tree() -> Result<Value, String> {
    let index = load_index()?;
    let mut vendors: BTreeMap<String, BTreeMap<String, Vec<Value>>> = BTreeMap::new();
    if let Value::Object(descriptors) = &index {
        for (name, descriptor) in descriptors {
            let Some(from_pack) = descriptor.get("from_pack").and_then(|value| value.as_object())
            else {
                continue;
            };
            let pack = from_pack.get("pack").and_then(|v| v.as_str()).unwrap_or("");
            let version = from_pack.get("version").and_then(|v| v.as_str()).unwrap_or("");
            if pack.is_empty() {
                continue;
            }
            // 按芯片厂商分组（descriptor.vendor 形如 "STMicroelectronics:1"，去掉冒号后缀），
            // 而非 from_pack.vendor（形如 "Keil"，会把 STM32 全归到 Keil 下）
            let chip_vendor = descriptor
                .get("vendor")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .split(':')
                .next()
                .unwrap_or("")
                .to_string();
            let vendor = if chip_vendor.is_empty() {
                from_pack.get("vendor").and_then(|v| v.as_str()).unwrap_or("").to_string()
            } else {
                chip_vendor
            };
            if vendor.is_empty() {
                continue;
            }
            let family = descriptor
                .get("family")
                .and_then(|v| v.as_str())
                .unwrap_or("Other Series")
                .to_string();
            // pack 名用 from_pack.vendor.pack（下载器按此匹配下载地址）
            let pack_vendor = from_pack.get("vendor").and_then(|v| v.as_str()).unwrap_or("");
            let device = json!({
                "name": name,
                "target": name, // 在线器件：DFP 器件名即 pyOCD target 名（装 DFP 后可解析）
                "vendor": vendor,
                "family": family,
                "flashKb": default_flash_kb(descriptor),
                "ramKb": default_ram_kb(descriptor),
                "pack": format!("{pack_vendor}.{pack}"),
                "version": version,
                "builtin": false,
            });
            vendors
                .entry(vendor.clone())
                .or_default()
                .entry(family)
                .or_default()
                .push(device);
        }
    }

    // 内置 8051 器件：独立厂商节点
    let mcs51: Vec<Value> = BUILTIN_MCS51
        .iter()
        .map(|(name, _)| {
            json!({
                "name": name,
                "target": name,
                "vendor": "8051",
                "family": "8051 Series",
                "flashKb": 8,
                "ramKb": 0,
                "pack": name,
                "version": "",
                "builtin": true,
            })
        })
        .collect();
    if !mcs51.is_empty() {
        vendors
            .entry("8051".to_string())
            .or_default()
            .insert("8051 Series".to_string(), mcs51);
    }

    // 内置 STM32 / GD32 器件库：合并进对应厂商节点（内置 target 直接可烧，无需 DFP）
    let mut builtin_by_vendor: BTreeMap<String, BTreeMap<String, Vec<Value>>> = BTreeMap::new();
    for mut device in builtin_devices() {
        let vendor = device
            .get("vendor")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let family = device
            .get("family")
            .and_then(|v| v.as_str())
            .unwrap_or("Other Series")
            .to_string();
        device["builtin"] = json!(true);
        builtin_by_vendor
            .entry(vendor)
            .or_default()
            .entry(family)
            .or_default()
            .push(device);
    }
    // 内置器件合并进已有厂商节点（同一 family 下：内置排前，避免和在线同名器件混淆）
    for (vendor, families) in builtin_by_vendor {
        let target_families = vendors.entry(vendor.clone()).or_default();
        for (family, mut devices) in families {
            let slot = target_families.entry(family).or_default();
            for device in &devices {
                slot.retain(|existing| {
                    existing.get("name").and_then(|v| v.as_str()) != device.get("name").and_then(|v| v.as_str())
                });
            }
            slot.splice(0..0, devices.drain(..));
        }
    }

    let vendors_json: Vec<Value> = vendors
        .into_iter()
        .map(|(vendor, families)| {
            let families_json: Vec<Value> = families
                .into_iter()
                .map(|(family, mut devices)| {
                    devices.sort_by_key(|d| d["name"].as_str().unwrap_or("").to_lowercase());
                    json!({ "name": family, "devices": devices })
                })
                .collect();
            json!({ "name": vendor, "families": families_json })
        })
        .collect();

    Ok(json!({ "vendors": vendors_json }))
}

/// GitHub 加速代理（国内网络访问 GitHub 不通时的 fallback）。
/// 均为公共加速服务，主地址失败才尝试；不保证长期可用。
const GITHUB_PROXIES: &[&str] = &[
    "https://gh-proxy.com/",
    "https://ghfast.top/",
    "https://mirror.ghproxy.com/",
];

/// 内置器件库路径（与 Python 端 targets.py 同源）：
/// `<flash-backend>/devices/devices.json`
fn builtin_devices_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../flash-backend")
        .join("devices")
        .join("devices.json")
}

/// 读取内置器件库（devices.json，常用 STM32 / GD32，target 名 pyOCD 内置可解析）。
/// 读取失败返回空列表（不影响在线索引搜索）。
fn builtin_devices() -> Vec<Value> {
    let Ok(raw) = fs::read_to_string(builtin_devices_path()) else {
        return Vec::new();
    };
    let devices: Vec<Value> = serde_json::from_str(&raw).unwrap_or_default();
    devices
        .into_iter()
        .map(|mut device| {
            // 内置器件无 pack / version / vendor：补占位字段，前端 DeviceInfo 不缺字段
            if device.get("vendor").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
                let name = device.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let vendor = if name.to_uppercase().starts_with("GD") {
                    "GigaDevice"
                } else {
                    "STMicroelectronics"
                };
                device["vendor"] = json!(vendor);
            }
            if !device.get("pack").is_some() {
                device["pack"] = device.get("name").cloned().unwrap_or(Value::Null);
            }
            if !device.get("version").is_some() {
                device["version"] = Value::Null;
            }
            device
        })
        .collect()
}

/// 搜索器件（统一索引查询 + 内置器件库合并，毫秒级）。
///
/// 在内存缓存的 index.json 索引上按器件名匹配，返回**限量**扁平结果
/// （最多 100 条），避免前端展开整棵大树的 DOM 爆炸卡顿。
/// 内置 devices.json（STM32 / GD32 常用型号，target 名 pyOCD 内置可解析）优先返回，
/// 保证"不用装 DFP 也能选到直接可烧的器件"。
pub fn search_devices(query: &str) -> Result<Value, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("缺少搜索关键字".to_string());
    }
    let index = load_index()?;
    let q = query.to_lowercase();

    let mut results: Vec<Value> = Vec::new();
    let mut total: usize = 0;

    // 1) 内置器件库优先（离线可用，target 直接可烧）
    let mut seen_names: BTreeSet<String> = BTreeSet::new();
    for device in builtin_devices() {
        let name = device.get("name").and_then(|v| v.as_str()).unwrap_or("");
        if name.is_empty() || !name.to_lowercase().contains(&q) {
            continue;
        }
        total += 1;
        seen_names.insert(name.to_string());
        if results.len() < 100 {
            results.push(device);
        }
    }

    // 2) 在线索引（DFP 器件，需装 Pack 后 pyOCD 才可解析）
    if let Value::Object(descriptors) = &index {
        for (name, descriptor) in descriptors {
            if seen_names.contains(name) {
                continue; // 内置已有同名器件（如 STM32F407ZGT6），不重复
            }
            if !name.to_lowercase().contains(&q) {
                continue;
            }
            total += 1;
            if results.len() >= 100 {
                continue;
            }
            let from_pack = descriptor.get("from_pack").and_then(|value| value.as_object());
            let pack_vendor = from_pack
                .and_then(|fp| fp.get("vendor"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let pack = from_pack
                .and_then(|fp| fp.get("pack"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let version = from_pack
                .and_then(|fp| fp.get("version"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if pack.is_empty() {
                continue;
            }
            // 芯片厂商（descriptor.vendor 去掉冒号后缀），fallback from_pack.vendor
            let chip_vendor = descriptor
                .get("vendor")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .split(':')
                .next()
                .unwrap_or("");
            let vendor = if chip_vendor.is_empty() { pack_vendor } else { chip_vendor };
            results.push(json!({
                "name": name,
                "target": name, // 在线器件：DFP 器件名即 pyOCD target 名（装 DFP 后可解析）
                "vendor": vendor,
                "family": descriptor.get("family").and_then(|v| v.as_str()).unwrap_or(""),
                "flashKb": default_flash_kb(descriptor),
                "ramKb": default_ram_kb(descriptor),
                "pack": format!("{pack_vendor}.{pack}"),
                "version": version,
                "builtin": false,
            }));
        }
    }
    Ok(json!({ "results": results, "total": total }))
}

/// 生成候选下载地址：原始地址在前，GitHub 地址追加国内加速代理。
fn candidate_urls(download_url: &str) -> Vec<String> {
    let mut urls = vec![download_url.to_string()];
    if download_url.contains("github.com") || download_url.contains("raw.githubusercontent.com") {
        for proxy in GITHUB_PROXIES {
            urls.push(format!("{proxy}{download_url}"));
        }
    }
    urls
}

/// 在线下载并安装指定 Pack：按索引里 from_pack 的 url 拼下载地址，
/// 拉取 .pack 写入数据目录，pyOCD 下次扫描即可识别。
pub fn download(app: &AppHandle, pack_name: &str) -> Result<Value, String> {
    let index = load_index()?;

    // 在索引里找 from_pack.vendor.pack == pack_name 的条目
    let mut found: Option<(String, String, String, String)> = None; // url, vendor, pack, version
    if let Value::Object(descriptors) = &index {
        for descriptor in descriptors.values() {
            let Some(from_pack) = descriptor.get("from_pack").and_then(|value| value.as_object()) else {
                continue;
            };
            let vendor = from_pack.get("vendor").and_then(|v| v.as_str()).unwrap_or("");
            let pack = from_pack.get("pack").and_then(|v| v.as_str()).unwrap_or("");
            if vendor.is_empty() || pack.is_empty() || format!("{vendor}.{pack}") != pack_name {
                continue;
            }
            let version = from_pack.get("version").and_then(|v| v.as_str()).unwrap_or("");
            let url = from_pack.get("url").and_then(|v| v.as_str()).unwrap_or("");
            if url.is_empty() {
                return Err(format!("索引中 Pack 缺少下载地址：{pack_name}"));
            }
            found = Some((
                url.to_string(),
                vendor.to_string(),
                pack.to_string(),
                version.to_string(),
            ));
            break;
        }
    }
    let (url, vendor, pack, version) =
        found.ok_or_else(|| format!("索引中未找到 Pack：{pack_name}"))?;

    let file_name = format!("{vendor}.{pack}.{version}.pack");
    let download_url = format!("{}/{}", url.trim_end_matches('/'), file_name);

    let client = reqwest::blocking::Client::builder()
        // 大 Pack（如 84MB）在国内网络下载慢，超时放宽到 5 分钟，避免大包中途超时失败
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|error| format!("创建下载客户端失败：{error}"))?;

    // 候选下载地址：原始地址 + GitHub 加速代理（国内网络访问 GitHub 不通时自动 fallback）
    // 整体重试 2 轮：网络抖动/服务器偶发失败时自动重试
    let candidates = candidate_urls(&download_url);
    let mut response: Option<reqwest::blocking::Response> = None;
    let mut last_error = String::new();
    for _attempt in 0..2 {
        for candidate in &candidates {
            match client.get(candidate).send() {
                Ok(resp) if resp.status().is_success() => {
                    response = Some(resp);
                    break;
                }
                Ok(resp) => last_error = format!("HTTP {}", resp.status()),
                Err(error) => last_error = error.to_string(),
            }
        }
        if response.is_some() {
            break;
        }
    }
    let mut response = response.ok_or_else(|| {
        if last_error.contains("404") {
            format!(
                "该器件包在官方仓库不存在（HTTP 404，可能已下架或版本更新）：{download_url}"
            )
        } else {
            format!("下载失败（{download_url}）：{last_error}；重试与 GitHub 加速均失败")
        }
    })?;
    let total = response.content_length().unwrap_or(0);

    let data_dir = data_dir()?;
    let target_dir = data_dir.join(&vendor).join(&pack);
    fs::create_dir_all(&target_dir)
        .map_err(|error| format!("创建 Pack 目录失败：{error}"))?;
    // 清理上次崩溃残留的临时文件
    clean_stale_tmp(&target_dir);
    let target_file = target_dir.join(format!("{version}.pack"));
    let tmp_file = target_dir.join(format!("{version}.pack.download"));

    let emit_progress = |done: u64, total: u64, pct: u32| {
        let _ = app.emit(
            "flash-event",
            json!({
                "event": "pack.progress",
                "data": { "pack": pack_name, "downloadedBytes": done, "totalBytes": total, "pct": pct }
            }),
        );
    };

    let result = (|| -> Result<u64, String> {
        let mut out = fs::File::create(&tmp_file)
            .map_err(|error| format!("创建临时文件失败：{error}"))?;
        let mut buffer = [0_u8; 64 * 1024];
        let mut done: u64 = 0;
        let mut last_emit = std::time::Instant::now();
        loop {
            let count = response
                .read(&mut buffer)
                .map_err(|error| format!("读取下载内容失败：{error}"))?;
            if count == 0 {
                break;
            }
            out.write_all(&buffer[..count])
                .map_err(|error| format!("写入文件失败：{error}"))?;
            done += count as u64;
            if last_emit.elapsed() >= PROGRESS_INTERVAL {
                let pct = if total > 0 {
                    (done as f64 / total as f64 * 100.0).round() as u32
                } else {
                    0
                };
                emit_progress(done, total, pct);
                last_emit = std::time::Instant::now();
            }
        }
        out.flush().map_err(|error| format!("刷新文件失败：{error}"))?;
        Ok(done)
    })();

    match result {
        Ok(done) => {
            fs::rename(&tmp_file, &target_file)
                .map_err(|error| format!("安装 Pack 失败：{error}"))?;
            emit_progress(done, total, 100);
            Ok(json!({
                "installed": true,
                "pack": pack_name,
                "version": version,
                "path": target_file.to_string_lossy(),
            }))
        }
        Err(error) => {
            let _ = fs::remove_file(&tmp_file);
            Err(error)
        }
    }
}

/// 清理目录下残留的 .pack.download 临时文件（崩溃残留）。
pub fn clean_stale_tmp(dir: &Path) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".pack.download") {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_index() -> Value {
        json!({
            "GD32F303RCT6": {
                "name": "GD32F303RCT6",
                "memories": { "IROM1": { "default": "1", "size": 262144 } },
                "from_pack": {
                    "vendor": "GigaDevice",
                    "pack": "GD32F30x_DFP",
                    "version": "2.2.1",
                    "url": "https://gd32mcu.com/data/documents/pack/"
                }
            },
            "STM32F103C8T6": {
                "name": "STM32F103C8T6",
                "memories": { "IROM1": { "default": "1", "size": 65536 } },
                "from_pack": {
                    "vendor": "Keil",
                    "pack": "STM32F1xx_DFP",
                    "version": "2.4.0",
                    "url": "https://keil.com/pack/"
                }
            }
        })
    }

    #[test]
    fn search_matches_case_insensitive_with_flash_kb() {
        let index = fixture_index();
        let (results, total, packs) = search_in_index(&index, "gd32f303");
        assert_eq!(total, 1);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0]["device"], "GD32F303RCT6");
        assert_eq!(results[0]["pack"], "GigaDevice.GD32F30x_DFP");
        assert_eq!(results[0]["version"], "2.2.1");
        assert_eq!(results[0]["flashKb"], 256);
        assert!(packs.contains("GigaDevice.GD32F30x_DFP"));
    }

    #[test]
    fn search_returns_multiple_devices_in_sorted_order() {
        let index = fixture_index();
        let (results, total, _) = search_in_index(&index, "32f"); // 命中 GD32F303 与 STM32F103
        assert_eq!(total, 2);
        assert_eq!(results[0]["device"], "GD32F303RCT6"); // 字典序：G < S
        assert_eq!(results[1]["device"], "STM32F103C8T6");
    }

    #[test]
    fn search_miss_returns_empty() {
        let index = fixture_index();
        let (results, total, packs) = search_in_index(&index, "esp32");
        assert_eq!(total, 0);
        assert!(results.is_empty());
        assert!(packs.is_empty());
    }

    #[test]
    fn builtin_devices_merge_provides_target() {
        // 内置库读取成功（devices.json 存在）
        let builtin = builtin_devices();
        assert!(!builtin.is_empty(), "内置器件库不应为空");
        let f407 = builtin
            .iter()
            .find(|d| d["name"] == "STM32F407ZGT6")
            .expect("内置库应包含 STM32F407ZGT6");
        assert_eq!(f407["target"], "STM32F407ZG", "内置 target 应为 pyOCD 可解析名");
        assert_eq!(f407["builtin"], true);
        assert!(!f407["pack"].is_null(), "内置器件需补 pack 占位字段");
    }

    #[test]
    fn search_merges_builtin_first_with_target() {
        // 真实索引 + 内置库合并：搜 STM32F407 应命中内置 STM32F407ZGT6 且排前
        let value = search_devices("STM32F407").unwrap_or_else(|e| panic!("搜索失败: {e}"));
        let results = value["results"].as_array().expect("results 应为数组");
        let f407_builtin = results.iter().find(|d| d["name"] == "STM32F407ZGT6");
        assert!(f407_builtin.is_some(), "搜索应命中内置 STM32F407ZGT6");
        let item = f407_builtin.expect("存在");
        assert_eq!(item["target"], "STM32F407ZG", "内置器件 target 应可解析");
        assert_eq!(item["builtin"], true);
        // 在线器件应带 target=器件名
        if let Some(first) = results.first() {
            assert!(!first["target"].as_str().unwrap_or("").is_empty(), "每条结果都应有 target");
        }
    }

    #[test]
    fn list_all_aggregates_by_pack_name() {
        let index = fixture_index();
        let results = aggregate_packs(&index);
        assert_eq!(results.len(), 2);

        let gd = results
            .iter()
            .find(|r| r["pack"] == "GigaDevice.GD32F30x_DFP")
            .expect("应包含 GigaDevice.GD32F30x_DFP");
        assert_eq!(gd["device"], "GigaDevice");
        assert_eq!(gd["version"], "2.2.1");
        assert_eq!(gd["deviceCount"], 1);
        assert!(gd["flashKb"].is_null());

        let keil = results
            .iter()
            .find(|r| r["pack"] == "Keil.STM32F1xx_DFP")
            .expect("应包含 Keil.STM32F1xx_DFP");
        assert_eq!(keil["version"], "2.4.0");
        assert_eq!(keil["deviceCount"], 1);
    }

    #[test]
    fn classify_pack_routes_to_expected_category() {
        assert_eq!(classify_pack("Keil.STM32F1xx_DFP"), "stm32");
        assert_eq!(classify_pack("STMicroelectronics.stm32c5xx_dfp"), "stm32");
        assert_eq!(classify_pack("GigaDevice.GD32F30x_DFP"), "gd32");
        assert_eq!(classify_pack("Keil.GD32F4xx_DFP"), "gd32"); // 含 gd32 关键字
        assert_eq!(classify_pack("NXP.MIMXRT1052_DFP"), "other");
        assert_eq!(classify_pack("SiliconLabs.EF32x1_DFP"), "other");
    }

    #[test]
    fn download_url_joins_with_trailing_slash_base() {
        let base = "https://gd32mcu.com/data/documents/pack/";
        let joined = format!("{}/{}", base.trim_end_matches('/'), "GigaDevice.GD32F30x_DFP.2.2.1.pack");
        assert_eq!(
            joined,
            "https://gd32mcu.com/data/documents/pack/GigaDevice.GD32F30x_DFP.2.2.1.pack"
        );
    }

    #[test]
    fn default_flash_kb_reads_default_memory() {
        let descriptor = json!({
            "memories": {
                "IRAM1": { "default": "0", "size": 8192 },
                "IROM1": { "default": "1", "size": 262144 }
            }
        });
        assert_eq!(default_flash_kb(&descriptor), Some(256));
    }

    #[test]
    fn flash_ram_parse_real_index_format() {
        // 真实 index.json 格式：default 是布尔，内存名 Flash/SRAM1
        let descriptor = json!({
            "memories": {
                "SRAM2": { "default": false, "size": 65536 },
                "Flash": { "default": true, "size": 524288 },
                "SRAM1": { "default": true, "size": 131072 }
            }
        });
        assert_eq!(default_flash_kb(&descriptor), Some(512));
        assert_eq!(default_ram_kb(&descriptor), Some(192));
    }
}
