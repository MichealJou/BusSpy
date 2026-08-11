//! 烧录器模块：管理 Python pyOCD 侧车进程，提供环境自检 / 自动初始化 / 探针枚举。
//!
//! 进程解析优先级：
//!   1. 环境变量 BUSSPY_FLASH_BACKEND（指向后端可执行文件）
//!   2. 打包内置 sidecar（resource_dir/flash-backend，S5 阶段启用）
//!   3. 开发模式：flash-backend/.venv 内的 python（不存在则用系统 python3）

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Sender},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

/// 可选的国内 pip 镜像，用于自动初始化环境（优先清华，避免国外源慢/超时）
pub const PIP_MIRRORS: &[(&str, &str)] = &[
    ("tuna", "https://pypi.tuna.tsinghua.edu.cn/simple"),
    ("aliyun", "https://mirrors.aliyun.com/pypi/simple/"),
    ("ustc", "https://mirrors.ustc.edu.cn/pypi/simple/"),
    ("official", "https://pypi.org/simple"),
];

/// 烧录后端默认依赖
const BACKEND_PACKAGES: &str = "pyocd pyserial";

const BACKEND_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashProbeInfo {
    id: String,
    vendor: String,
    product: String,
    unique_id: String,
    protocols: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashBackendStatus {
    /// 后端进程启动方式：bundled / venv / python3 / missing
    mode: String,
    /// 探测到的 python 可执行文件
    python: String,
    /// 后端是否可启动并能响应 ping
    ready: bool,
    /// pyocd 是否已安装（来自后端 env.status）
    pyocd: Option<Value>,
    /// pyserial 是否已安装
    pyserial: Option<Value>,
    /// 后端自身版本
    backend_version: String,
    /// 可用的 pip 镜像列表（value 为镜像标识）
    mirrors: Vec<String>,
}

struct FlasherBackend {
    child: Mutex<Child>,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<u64, Sender<Result<Value, String>>>>>,
    next_id: Arc<Mutex<u64>>,
    alive: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct FlasherState {
    backend: Mutex<Option<Arc<FlasherBackend>>>,
}

/// 获取（或懒启动）烧录后端；进程已退出时自动重建。
fn get_backend(app: &AppHandle) -> Result<Arc<FlasherBackend>, String> {
    let state = app.state::<FlasherState>();
    let mut guard = state
        .backend
        .lock()
        .map_err(|_| "烧录后端状态锁已损坏".to_string())?;
    if let Some(backend) = guard.as_ref() {
        if backend.alive.load(Ordering::SeqCst) {
            return Ok(Arc::clone(backend));
        }
        *guard = None;
    }
    let backend = Arc::new(FlasherBackend::spawn(app)?);
    *guard = Some(Arc::clone(&backend));
    Ok(backend)
}

impl FlasherBackend {
    fn spawn(app: &AppHandle) -> Result<Self, String> {
        let (program, args, cwd) = resolve_backend_command(app)?;

        let mut child = Command::new(&program)
            .args(&args)
            .current_dir(&cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("启动烧录后端失败：{error}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "烧录后端无 stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "烧录后端无 stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "烧录后端无 stderr".to_string())?;

        let pending: Arc<Mutex<HashMap<u64, Sender<Result<Value, String>>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let alive = Arc::new(AtomicBool::new(true));

        // stdout 读取线程：解析响应分发给等待的请求，异步事件转发给前端
        let reader_pending = Arc::clone(&pending);
        let reader_app = app.clone();
        let reader_alive = Arc::clone(&alive);
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let line = match line {
                    Ok(value) => value,
                    Err(_) => break,
                };
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<Value>(&line) {
                    Ok(payload) => {
                        if let Some(id) = payload.get("id").and_then(|value| value.as_u64()) {
                            let sender = reader_pending
                                .lock()
                                .ok()
                                .and_then(|mut map| map.remove(&id));
                            if let Some(sender) = sender {
                                let message = match payload.get("error") {
                                    Some(error) => {
                                        Err(error.as_str().unwrap_or("未知后端错误").to_string())
                                    }
                                    None => Ok(payload
                                        .get("result")
                                        .cloned()
                                        .unwrap_or(Value::Null)),
                                };
                                let _ = sender.send(message);
                            }
                        } else if let Some(event) = payload
                            .get("event")
                            .and_then(|value| value.as_str())
                        {
                            let data = payload.get("data").cloned().unwrap_or(Value::Null);
                            let _ = reader_app
                                .emit("flash-event", json!({ "event": event, "data": data }));
                        }
                    }
                    Err(_) => {
                        let _ = reader_app.emit("flash-log", format!("后端输出无法解析：{line}"));
                    }
                }
            }
            reader_alive.store(false, Ordering::SeqCst);
            let _ = reader_app.emit("flash-event", json!({ "event": "backend.exit", "data": {} }));
        });

        // stderr 读取线程：转发为日志事件（pip/异常输出可观测）
        let log_app = app.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                let _ = log_app.emit("flash-log", line);
            }
        });

        Ok(FlasherBackend {
            child: Mutex::new(child),
            stdin: Arc::new(Mutex::new(stdin)),
            pending,
            next_id: Arc::new(Mutex::new(1)),
            alive,
        })
    }

    /// 发送 JSON-RPC 请求并等待响应；带超时。
    fn call(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let id = {
            let mut guard = self
                .next_id
                .lock()
                .map_err(|_| "烧录后端序号锁已损坏".to_string())?;
            let value = *guard;
            *guard += 1;
            value
        };
        let (sender, receiver) = mpsc::channel();
        self.pending
            .lock()
            .map_err(|_| "烧录后端请求表锁已损坏".to_string())?
            .insert(id, sender);

        let request = json!({ "id": id, "method": method, "params": params });
        let mut line = serde_json::to_string(&request)
            .map_err(|error| format!("序列化请求失败：{error}"))?;
        line.push('\n');

        let mut stdin = self
            .stdin
            .lock()
            .map_err(|_| "烧录后端 stdin 锁已损坏".to_string())?;
        stdin
            .write_all(line.as_bytes())
            .map_err(|error| format!("写入后端失败：{error}"))?;
        stdin
            .flush()
            .map_err(|error| format!("刷新后端输出失败：{error}"))?;
        drop(stdin);

        receiver
            .recv_timeout(timeout)
            .map_err(|_| format!("后端响应超时：{method}"))?
    }
}

impl Drop for FlasherBackend {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// 解析后端启动命令：优先内置 sidecar / 环境变量，其次开发模式 venv；
/// venv 缺失时不优先回退系统 python3（版本老/无证书），而是尝试更好的候选。
fn resolve_backend_command(app: &AppHandle) -> Result<(String, Vec<String>, PathBuf), String> {
    if let Ok(explicit) = std::env::var("BUSSPY_FLASH_BACKEND") {
        if !explicit.is_empty() {
            return Ok((explicit, Vec::new(), PathBuf::from(".")));
        }
    }

    if let Some(bundled) = bundled_backend(app) {
        return Ok((bundled.to_string_lossy().to_string(), Vec::new(), PathBuf::from(".")));
    }

    let backend_dir = backend_dir();
    let venv = venv_python(&backend_dir);
    if venv.exists() {
        return Ok((
            venv.to_string_lossy().to_string(),
            vec!["-m".to_string(), "flash_backend".to_string()],
            backend_dir,
        ));
    }

    // venv 缺失：从候选列表里选一个可用的 Python（不用 macOS 系统自带 3.9 打头）
    let python = find_python().ok_or_else(|| "未找到可用的 Python，请先初始化烧录环境".to_string())?;
    Ok((
        python.to_string_lossy().to_string(),
        vec!["-m".to_string(), "flash_backend".to_string()],
        backend_dir,
    ))
}

/// Python 候选列表（按优先级）：用户指定 → 项目常用安装 → PATH → 系统自带（最后兜底）。
/// 系统自带 /usr/bin/python3（3.9）缺少 CA 证书且版本老，尽量不用。
fn python_candidates() -> Vec<String> {
    let mut candidates = Vec::new();
    if let Ok(explicit) = std::env::var("BUSSPY_FLASH_PYTHON") {
        if !explicit.is_empty() {
            candidates.push(explicit);
        }
    }
    #[cfg(target_os = "macos")]
    {
        candidates.push("/usr/local/bin/python3".to_string()); // python.org
        candidates.push("/opt/homebrew/bin/python3".to_string()); // Homebrew
        candidates.push("/Library/Frameworks/Python.framework/Versions/Current/bin/python3".to_string());
    }
    candidates.push("python3".to_string()); // PATH
    candidates.push("/usr/bin/python3".to_string()); // macOS 系统自带，最后兜底
    candidates
}

/// 探测第一个可用的 Python（存在且能执行）。
fn find_python() -> Option<std::path::PathBuf> {
    for candidate in python_candidates() {
        let path = std::path::PathBuf::from(&candidate);
        if path.is_file() {
            return Some(path);
        }
        // 非绝对路径（如 PATH 里的 python3）直接返回，交给 Command 解析
        if !candidate.contains('/') {
            return Some(path);
        }
    }
    None
}

/// 打包内置的侧车后端（S5 阶段由 PyInstaller 产物填充）。
/// Tauri externalBin 会重命名为 `flash-backend-<target-triple>`，因此按前缀扫描。
fn bundled_backend(app: &AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let entries = std::fs::read_dir(&resource_dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let executable = if cfg!(windows) {
            name.starts_with("flash-backend") && name.ends_with(".exe")
        } else {
            name.starts_with("flash-backend") && !name.contains('.')
        };
        if executable {
            return Some(entry.path());
        }
    }
    None
}

/// 后端源码目录（开发模式）。
fn backend_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../flash-backend")
}

/// venv 内的 python 可执行文件。
fn venv_python(backend_dir: &std::path::Path) -> PathBuf {
    if cfg!(windows) {
        backend_dir.join(".venv/Scripts/python.exe")
    } else {
        backend_dir.join(".venv/bin/python")
    }
}

/// 当前后端启动方式标识（供前端展示）。
fn backend_mode(app: &AppHandle) -> String {
    if bundled_backend(app).is_some() {
        return "bundled".to_string();
    }
    if std::env::var("BUSSPY_FLASH_BACKEND")
        .map(|value| !value.is_empty())
        .unwrap_or(false)
    {
        return "custom".to_string();
    }
    if venv_python(&backend_dir()).exists() {
        return "venv".to_string();
    }
    "python3".to_string()
}

#[tauri::command]
pub fn flash_backend_status(app: AppHandle) -> Result<FlashBackendStatus, String> {
    let mut status = FlashBackendStatus {
        mode: backend_mode(&app),
        python: String::new(),
        ready: false,
        pyocd: None,
        pyserial: None,
        backend_version: String::new(),
        mirrors: PIP_MIRRORS.iter().map(|(name, _)| name.to_string()).collect(),
    };
    if let Ok((program, _, _)) = resolve_backend_command(&app) {
        status.python = program;
    }

    // 尝试启动并 ping 后端，收集 pyocd/pyserial 状态
    if let Ok(backend) = get_backend(&app) {
        // 后端进程冷启动（Python + pyOCD 导入）可能较慢，ping 失败重试几次
        let mut pong: Option<Value> = None;
        for attempt in 0..5 {
            if let Ok(Value::Object(value)) = backend.call("ping", Value::Null, Duration::from_secs(10)) {
                pong = Some(Value::Object(value));
                break;
            }
            if attempt < 4 {
                thread::sleep(Duration::from_millis(500 * (attempt as u64 + 1)));
            }
        }
        if let Some(Value::Object(pong)) = pong {
            status.ready = true;
            status.backend_version = pong
                .get("version")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string();
        }
        if let Ok(Value::Object(env_status)) =
            backend.call("env.status", Value::Null, BACKEND_TIMEOUT)
        {
            status.pyocd = env_status.get("pyocd").cloned();
            status.pyserial = env_status.get("pyserial").cloned();
        }
    }
    Ok(status)
}

#[tauri::command]
pub fn flash_list_probes(app: AppHandle) -> Result<Vec<FlashProbeInfo>, String> {
    let backend = get_backend(&app)?;
    let result = backend.call("probe.list", Value::Null, BACKEND_TIMEOUT)?;
    let probes = result
        .get("probes")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "后端返回的探针列表格式错误".to_string())?;
    probes
        .iter()
        .map(|probe| {
            let get = |key: &str| probe.get(key).and_then(|v| v.as_str()).unwrap_or("").to_string();
            Ok(FlashProbeInfo {
                id: get("id"),
                vendor: get("vendor"),
                product: get("product"),
                unique_id: get("uniqueId"),
                protocols: probe
                    .get("protocols")
                    .and_then(|value| value.as_array())
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(|item| item.as_str())
                            .map(|item| item.to_string())
                            .collect()
                    })
                    .unwrap_or_default(),
            })
        })
        .collect()
}

/// 自动初始化后端环境：创建 venv + 从（国内）镜像安装 pyocd/pyserial。
///
/// 该命令立即返回，安装过程在后台线程执行，通过事件推送到前端：
///   - "flash-bootstrap-log"   （String，安装日志行）
///   - "flash-bootstrap-done"  （{ success, message }）
#[tauri::command]
pub fn flash_bootstrap(app: AppHandle, mirror: Option<String>) -> Result<(), String> {
    let mirror = mirror.unwrap_or_else(|| "tuna".to_string());
    let index_url = PIP_MIRRORS
        .iter()
        .find(|(name, _)| name == &mirror)
        .map(|(_, url)| url.to_string())
        .ok_or_else(|| format!("不支持的镜像：{mirror}"))?;

    let backend_dir_path = backend_dir();
    let venv_path = venv_python(&backend_dir_path);
    let venv_dir = venv_path.parent().unwrap_or(&backend_dir_path).to_path_buf();
    // 创建 venv 的 Python：用候选白名单（避免 macOS 系统自带 3.9）
    let python = find_python()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| "python3".to_string());

    thread::spawn(move || {
        let emit_log = |line: &str| {
            let _ = app.emit("flash-bootstrap-log", line);
        };
        emit_log(&format!("[1/3] 创建虚拟环境：{venv_dir:?}"));
        let venv_result = Command::new(&python)
            .args(["-m", "venv"])
            .arg(&venv_dir)
            .output();
        match venv_result {
            Ok(output) if output.status.success() => {}
            Ok(output) => {
                let message = String::from_utf8_lossy(&output.stderr).to_string();
                let _ = app.emit(
                    "flash-bootstrap-done",
                    json!({ "success": false, "message": format!("创建虚拟环境失败：{message}") }),
                );
                return;
            }
            Err(error) => {
                let _ = app.emit(
                    "flash-bootstrap-done",
                    json!({ "success": false, "message": format!("创建虚拟环境失败：{error}") }),
                );
                return;
            }
        }

        emit_log(&format!("[2/3] 使用镜像安装依赖：{index_url}"));

        // 镜像源是 HTTP 直连/自签证书，系统 Python 可能缺 CA 证书导致 SSL 校验失败，
        // 对镜像主机显式加 --trusted-host 跳过校验（仅用于安装依赖这一环）。
        let mut install_args = vec!["install".to_string(), "--index-url".to_string(), index_url.clone()];
        let mirror_host = index_url
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .split('/')
            .next()
            .unwrap_or("")
            .to_string();
        if !mirror_host.is_empty() && mirror != "official" {
            install_args.push("--trusted-host".to_string());
            install_args.push(mirror_host);
        }
        install_args.push(BACKEND_PACKAGES.to_string());

        let pip = venv_path
            .parent()
            .map(|dir| dir.join(if cfg!(windows) { "pip.exe" } else { "pip" }))
            .unwrap_or_else(|| venv_path.clone());
        let install_result = Command::new(&pip).args(&install_args).output();
        match install_result {
            Ok(output) if output.status.success() => {
                emit_log("[3/3] 环境初始化完成");
                let _ = app.emit(
                    "flash-bootstrap-done",
                    json!({ "success": true, "message": "环境初始化完成" }),
                );
            }
            Ok(output) => {
                let message = String::from_utf8_lossy(&output.stderr).to_string();
                let _ = app.emit(
                    "flash-bootstrap-done",
                    json!({ "success": false, "message": format!("安装依赖失败：{message}") }),
                );
            }
            Err(error) => {
                let _ = app.emit(
                    "flash-bootstrap-done",
                    json!({ "success": false, "message": format!("安装依赖失败：{error}") }),
                );
            }
        }
    });
    Ok(())
}

/// 关闭并重建后端（用于环境初始化完成后切换 venv 解释器）。
#[tauri::command]
pub fn flash_backend_restart(app: AppHandle) -> Result<(), String> {
    let state = app.state::<FlasherState>();
    let mut guard = state
        .backend
        .lock()
        .map_err(|_| "烧录后端状态锁已损坏".to_string())?;
    *guard = None;
    let _ = get_backend(&app)?;
    Ok(())
}

// ── 器件 / Pack ─────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashTargetInfo {
    name: String,
    target: String,
    family: String,
    flash_kb: u32,
    ram_kb: u32,
    builtin: bool,
}

#[tauri::command]
pub fn flash_list_targets(app: AppHandle) -> Result<Vec<FlashTargetInfo>, String> {
    let backend = get_backend(&app)?;
    let result = backend.call("target.list", Value::Null, BACKEND_TIMEOUT)?;
    let targets = result
        .get("targets")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "器件列表格式错误".to_string())?;
    targets
        .iter()
        .map(|item| {
            Ok(FlashTargetInfo {
                name: item.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                target: item.get("target").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                family: item.get("family").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                flash_kb: item.get("flashKb").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                ram_kb: item.get("ramKb").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                builtin: item.get("builtin").and_then(|v| v.as_bool()).unwrap_or(false),
            })
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashPackInfo {
    name: String,
    version: String,
    device_count: u32,
}

#[tauri::command]
pub fn flash_list_packs(app: AppHandle) -> Result<Vec<FlashPackInfo>, String> {
    let backend = get_backend(&app)?;
    let result = backend.call("pack.list", Value::Null, BACKEND_TIMEOUT)?;
    let packs = result
        .get("packs")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "Pack 列表格式错误".to_string())?;
    packs
        .iter()
        .map(|item| {
            Ok(FlashPackInfo {
                name: item.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                version: item.get("version").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                device_count: item.get("deviceCount").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
            })
        })
        .collect()
}

#[tauri::command]
pub fn flash_import_pack(app: AppHandle, pack_path: String) -> Result<Value, String> {
    let backend = get_backend(&app)?;
    let params = json!({ "path": pack_path });
    backend.call("pack.import", params, Duration::from_secs(600))
}

#[tauri::command]
pub fn flash_search_packs(app: AppHandle, query: String) -> Result<Value, String> {
    let backend = get_backend(&app)?;
    let params = json!({ "query": query });
    backend.call("pack.search", params, Duration::from_secs(60))
}

#[tauri::command]
pub fn flash_download_pack(app: AppHandle, pack: String) -> Result<Value, String> {
    let backend = get_backend(&app)?;
    let params = json!({ "pack": pack });
    backend.call("pack.download", params, Duration::from_secs(600))
}

// ── 烧录 / 芯片信息 / SN ────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashProgramOptions {
    probe_id: String,
    target: String,
    file_path: String,
    erase_mode: String,
    verify: bool,
    pack: Option<String>,
    address: Option<u64>,
}

#[tauri::command]
pub fn flash_program(app: AppHandle, options: FlashProgramOptions) -> Result<Value, String> {
    let backend = get_backend(&app)?;
    let mut params = json!({
        "probeId": options.probe_id,
        "target": options.target,
        "filePath": options.file_path,
        "eraseMode": options.erase_mode,
        "verify": options.verify,
    });
    if let Some(pack) = options.pack {
        params["pack"] = json!(pack);
    }
    if let Some(address) = options.address {
        params["address"] = json!(address);
    }
    backend.call("flash.program", params, Duration::from_secs(600))
}

#[tauri::command]
pub fn flash_erase(app: AppHandle, probe_id: String, target: String, pack: Option<String>) -> Result<Value, String> {
    let backend = get_backend(&app)?;
    let mut params = json!({ "probeId": probe_id, "target": target });
    if let Some(pack) = pack {
        params["pack"] = json!(pack);
    }
    backend.call("flash.erase", params, Duration::from_secs(300))
}

#[tauri::command]
pub fn flash_read_chip_info(app: AppHandle, probe_id: String, target: String, pack: Option<String>) -> Result<Value, String> {
    let backend = get_backend(&app)?;
    let mut params = json!({ "probeId": probe_id, "target": target });
    if let Some(pack) = pack {
        params["pack"] = json!(pack);
    }
    backend.call("flash.chipInfo", params, BACKEND_TIMEOUT)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnOptions {
    probe_id: String,
    target: String,
    address: u64,
    format: String,
    endian: Option<String>,
    checksum: Option<String>,
    length: Option<u32>,
    value: Option<String>,
    pack: Option<String>,
}

fn sn_params(options: &SnOptions) -> Value {
    json!({
        "probeId": options.probe_id,
        "target": options.target,
        "address": options.address,
        "format": options.format,
        "endian": options.endian.clone().unwrap_or_else(|| "little".to_string()),
        "checksum": options.checksum.clone().unwrap_or_else(|| "none".to_string()),
        "length": options.length,
        "value": options.value.clone().unwrap_or_default(),
        "pack": options.pack.clone(),
    })
}

#[tauri::command]
pub fn flash_read_sn(app: AppHandle, options: SnOptions) -> Result<Value, String> {
    let backend = get_backend(&app)?;
    backend.call("sn.read", sn_params(&options), BACKEND_TIMEOUT)
}

#[tauri::command]
pub fn flash_write_sn(app: AppHandle, options: SnOptions) -> Result<Value, String> {
    let backend = get_backend(&app)?;
    backend.call("sn.write", sn_params(&options), Duration::from_secs(300))
}

// ── 串口 ISP ────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IspProgramOptions {
    port: String,
    baud_rate: u32,
    file_path: String,
    address: u64,
    verify: bool,
}

#[tauri::command]
pub fn isp_program(app: AppHandle, options: IspProgramOptions) -> Result<Value, String> {
    let backend = get_backend(&app)?;
    let params = json!({
        "port": options.port,
        "baudRate": options.baud_rate,
        "filePath": options.file_path,
        "address": options.address,
        "verify": options.verify,
    });
    backend.call("isp.program", params, Duration::from_secs(600))
}

// ── 量产模式 ────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductionStartOptions {
    target: String,
    firmware_path: String,
    erase_mode: Option<String>,
    verify: Option<bool>,
    pack: Option<String>,
    sn_enabled: Option<bool>,
    sn_address: Option<u64>,
    sn_format: Option<String>,
    sn_length: Option<u32>,
    sn_checksum: Option<String>,
    sn_endian: Option<String>,
    sn_start: Option<u64>,
    sn_step: Option<u64>,
    sn_prefix: Option<String>,
}

#[tauri::command]
pub fn production_start(app: AppHandle, options: ProductionStartOptions) -> Result<Value, String> {
    let backend = get_backend(&app)?;
    let params = json!({
        "target": options.target,
        "firmwarePath": options.firmware_path,
        "eraseMode": options.erase_mode.clone().unwrap_or_else(|| "auto".to_string()),
        "verify": options.verify.unwrap_or(true),
        "pack": options.pack.clone(),
        "snEnabled": options.sn_enabled.unwrap_or(false),
        "snAddress": options.sn_address.unwrap_or(0),
        "snFormat": options.sn_format.clone().unwrap_or_else(|| "ascii".to_string()),
        "snLength": options.sn_length,
        "snChecksum": options.sn_checksum.clone().unwrap_or_else(|| "none".to_string()),
        "snEndian": options.sn_endian.clone().unwrap_or_else(|| "little".to_string()),
        "snStart": options.sn_start.unwrap_or(1),
        "snStep": options.sn_step.unwrap_or(1),
        "snPrefix": options.sn_prefix.clone().unwrap_or_default(),
    });
    backend.call("production.start", params, BACKEND_TIMEOUT)
}

#[tauri::command]
pub fn production_stop(app: AppHandle) -> Result<Value, String> {
    let backend = get_backend(&app)?;
    backend.call("production.stop", Value::Null, BACKEND_TIMEOUT)
}

#[tauri::command]
pub fn production_stats(app: AppHandle) -> Result<Value, String> {
    let backend = get_backend(&app)?;
    backend.call("production.stats", Value::Null, BACKEND_TIMEOUT)
}

#[tauri::command]
pub fn production_records(app: AppHandle) -> Result<Value, String> {
    let backend = get_backend(&app)?;
    backend.call("production.records", Value::Null, BACKEND_TIMEOUT)
}
