//! 烧录器模块：管理 Python pyOCD 侧车进程，提供环境自检 / 自动初始化 / 探针枚举。
//!
//! 进程解析优先级：
//!   1. 环境变量 BUSSPY_FLASH_BACKEND（指向后端可执行文件）
//!   2. 打包内置 sidecar（resource_dir/flash-backend，S5 阶段启用）
//!   3. 开发模式：flash-backend/.venv 内的 python（不存在则用系统 python3）

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
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
    /// probe-rs 打不开的探针 ID（回退 pyOCD，避免每次烧录都重复尝试并残留句柄）
    probe_rs_incompatible: Mutex<HashSet<String>>,
}

/// 尝试用 probe-rs 打开探针做快速烧录。
/// 失败（探针不兼容 / 不在白名单）则记录到缓存并返回 None，调用方回退 pyOCD。
fn try_probe_rs_open(app: &AppHandle, target: &str, probe_id: &str) -> Option<probe_rs::Session> {
    let state = app.state::<FlasherState>();
    // 已判定为不兼容：直接回退，不再尝试
    if let Ok(cache) = state.probe_rs_incompatible.lock() {
        if cache.contains(probe_id) {
            return None;
        }
    }
    match crate::probe_flash::try_open(target, probe_id) {
        Ok(session) => Some(session),
        Err(_) => {
            // 记住这个探针不走 probe-rs，后续直接 pyOCD
            if let Ok(mut cache) = state.probe_rs_incompatible.lock() {
                cache.insert(probe_id.to_string());
            }
            None
        }
    }
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

    // debug 构建（tauri dev）：优先用开发目录 .venv 的 Python，加载最新源码。
    // 不能先走 bundled_backend —— 它会在 build/dist 找到旧 sidecar（Tauri dev 也复制），
    // 导致烧录永远跑旧后端，改的代码不生效（表现为同样的错误一直复现）。
    #[cfg(debug_assertions)]
    {
        let backend_dir = backend_dir();
        let venv = venv_python(&backend_dir);
        if venv.exists() {
            return Ok((
                venv.to_string_lossy().to_string(),
                vec!["-m".to_string(), "flash_backend".to_string()],
                backend_dir,
            ));
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

/// 打包内置的侧车后端（应用自带 Python 环境，用户机器无需安装 Python）。
/// Tauri externalBin 会重命名为 `flash-backend-<target-triple>`，因此按前缀扫描。
/// 查找顺序：发布版资源目录（.app/Contents/Resources）→ 开发版构建产物。
fn bundled_backend(app: &AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    if let Some(found) = scan_sidecar_dir(&resource_dir) {
        return Some(found);
    }
    scan_sidecar_dir(&backend_dir().join("build/dist"))
}

fn scan_sidecar_dir(dir: &std::path::Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
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
    if std::env::var("BUSSPY_FLASH_BACKEND")
        .map(|value| !value.is_empty())
        .unwrap_or(false)
    {
        return "custom".to_string();
    }
    // debug 构建（tauri dev）强制用开发目录 venv（见 resolve_backend_command）
    #[cfg(debug_assertions)]
    {
        if venv_python(&backend_dir()).exists() {
            return "venv".to_string();
        }
    }
    if bundled_backend(app).is_some() {
        return "bundled".to_string();
    }
    if venv_python(&backend_dir()).exists() {
        return "venv".to_string();
    }
    "python3".to_string()
}

/// 在 Tauri 的 blocking 线程池中执行阻塞任务。
///
/// Tauri v2 的非 async 命令在主线程执行：一个长阻塞命令会冻结整个 UI 并
/// 阻塞所有其他命令。烧录后端的每次调用都可能耗时数秒到数分钟（探针枚举、
/// 在线下载等），因此所有命令都必须是 async，并把阻塞调用丢到这里。
async fn spawn_blocking_task<F, T>(task: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("烧录后端任务执行失败：{error}"))?
}

#[tauri::command]
pub async fn flash_backend_status(app: AppHandle) -> Result<FlashBackendStatus, String> {
    spawn_blocking_task(move || {
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
            // 后端进程冷启动（Python + pyOCD 导入）可能较慢，ping 失败重试几次；
            // 总预算控制在 ~15s，避免环境异常时自检长时间挂起
            let mut pong: Option<Value> = None;
            for attempt in 0..3 {
                if let Ok(Value::Object(value)) =
                    backend.call("ping", Value::Null, Duration::from_secs(5))
                {
                    pong = Some(Value::Object(value));
                    break;
                }
                if attempt < 2 {
                    thread::sleep(Duration::from_millis(1000));
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
                backend.call("env.status", Value::Null, Duration::from_secs(15))
            {
                status.pyocd = env_status.get("pyocd").cloned();
                status.pyserial = env_status.get("pyserial").cloned();
            }
        }
        Ok(status)
    })
    .await
}

/// 把后端/rusb 返回的探针 JSON 解析为结构体。
fn parse_probes(result: &Value) -> Result<Vec<FlashProbeInfo>, String> {
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

#[tauri::command]
pub async fn flash_list_probes(app: AppHandle, _force: Option<bool>) -> Result<Vec<FlashProbeInfo>, String> {
    spawn_blocking_task(move || {
        // 优先 Rust 原生 USB 快速识别（毫秒级，不启动 Python 后端，和串口列表一样快）
        match crate::probe_scan::list_usb_probes() {
            Ok(result) => parse_probes(&result),
            Err(usb_error) => {
                // 系统无 libusb / 权限不足 → 回退 pyOCD 后端枚举
                let backend = get_backend(&app)?;
                let result = backend
                    .call("probe.list", json!({ "force": true }), BACKEND_TIMEOUT)
                    .map_err(|error| format!("探针扫描失败（{usb_error}；回退 pyOCD 也失败）：{error}"))?;
                if let Some(error) = result.get("error").and_then(|value| value.as_str()) {
                    if !error.is_empty() {
                        return Err(format!("探针扫描失败：{error}"));
                    }
                }
                if result.get("timeout").and_then(|value| value.as_bool()).unwrap_or(false) {
                    return Err("探针扫描超时（10s），请检查调试器连接后重试".to_string());
                }
                parse_probes(&result)
            }
        }
    })
    .await
}

/// 自动初始化后端环境：创建 venv + 从（国内）镜像安装 pyocd/pyserial。
///
/// 该命令立即返回，安装过程在后台线程执行，通过事件推送到前端：
///   - "flash-bootstrap-log"   （String，安装日志行）
///   - "flash-bootstrap-done"  （{ success, message }）
#[tauri::command]
pub async fn flash_bootstrap(app: AppHandle, mirror: Option<String>) -> Result<(), String> {
    spawn_blocking_task(move || {
        let mirror = mirror.unwrap_or_else(|| "tuna".to_string());
        let index_url = PIP_MIRRORS
            .iter()
            .find(|(name, _)| name == &mirror)
            .map(|(_, url)| url.to_string())
            .ok_or_else(|| format!("不支持的镜像：{mirror}"))?;

        let backend_dir_path = backend_dir();
        let venv_path = venv_python(&backend_dir_path);
        // venv_path = <backend>/.venv/bin/python（或 .venv/Scripts/python.exe）
        // venv 根目录要再往上走一级：<backend>/.venv
        let venv_dir = venv_path
            .parent()
            .and_then(|p| p.parent())
            .unwrap_or(&backend_dir_path)
            .to_path_buf();
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
            // 按 requirements.txt 安装：新增依赖只需改后端目录里的清单文件，无需改代码
            let requirements_path = backend_dir_path.join("requirements.txt");
            install_args.push("-r".to_string());
            install_args.push(requirements_path.to_string_lossy().to_string());

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
    })
    .await
}

/// 关闭并重建后端（用于环境初始化完成后切换 venv 解释器）。
#[tauri::command]
pub async fn flash_backend_restart(app: AppHandle) -> Result<(), String> {
    spawn_blocking_task(move || {
        let state = app.state::<FlasherState>();
        let mut guard = state
            .backend
            .lock()
            .map_err(|_| "烧录后端状态锁已损坏".to_string())?;
        *guard = None;
        drop(guard); // 先释放锁，避免 get_backend 内部再次加锁导致死锁
        let _ = get_backend(&app)?;
        Ok(())
    })
    .await
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
pub async fn flash_list_targets(app: AppHandle) -> Result<Vec<FlashTargetInfo>, String> {
    spawn_blocking_task(move || {
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
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashPackInfo {
    name: String,
    version: String,
    device_count: u32,
}

#[tauri::command]
pub async fn flash_list_packs(app: AppHandle) -> Result<Vec<FlashPackInfo>, String> {
    spawn_blocking_task(move || {
        let backend = get_backend(&app)?;
        let result = backend.call("pack.list", Value::Null, BACKEND_TIMEOUT)?;
        // 顺带缓存 cmsis-pack-manager 数据目录，供 Rust 下载器（pack_downloader）复用
        if let Some(path) = result
            .get("dataPath")
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
        {
            crate::pack_downloader::set_data_dir(std::path::PathBuf::from(path));
        }
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
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn flash_import_pack(app: AppHandle, pack_path: String) -> Result<Value, String> {
    spawn_blocking_task(move || {
        let backend = get_backend(&app)?;
        let params = json!({ "path": pack_path });
        backend.call("pack.import", params, Duration::from_secs(600))
    })
    .await
}

#[tauri::command]
pub async fn flash_search_packs(_app: AppHandle, query: String) -> Result<Value, String> {
    spawn_blocking_task(move || crate::pack_downloader::search(&query)).await
}

/// 器件包分类清单（Keil 风格层级：STM32 / 51 / GD32 / 其他厂商 → Pack）。
#[tauri::command]
pub async fn flash_list_pack_categories(_app: AppHandle) -> Result<Value, String> {
    spawn_blocking_task(crate::pack_downloader::list_all).await
}

/// 器件树（Keil Devices 风格：厂商 → 系列 → 器件），供下载器左侧导航。
#[tauri::command]
pub async fn flash_device_tree(_app: AppHandle) -> Result<Value, String> {
    spawn_blocking_task(crate::pack_downloader::device_tree).await
}

/// 搜索器件（统一索引，限量扁平结果，避免前端大树渲染卡顿）。
#[tauri::command]
pub async fn flash_search_devices(_app: AppHandle, query: String) -> Result<Value, String> {
    spawn_blocking_task(move || crate::pack_downloader::search_devices(&query)).await
}

#[tauri::command]
pub async fn flash_download_pack(app: AppHandle, pack: String) -> Result<Value, String> {
    spawn_blocking_task(move || crate::pack_downloader::download(&app, &pack)).await
}

/// 查询器件的烧录算法列表（Keil Programming Algorithm 同源，来自已装 DFP）。
#[tauri::command]
pub async fn flash_list_algorithms(app: AppHandle, device: String) -> Result<Value, String> {
    spawn_blocking_task(move || {
        let backend = get_backend(&app)?;
        backend.call("pack.algorithms", json!({ "device": device }), BACKEND_TIMEOUT)
    })
    .await
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
    frequency: Option<u32>,
    algorithm: Option<String>,
}

#[tauri::command]
pub async fn flash_program(app: AppHandle, options: FlashProgramOptions) -> Result<Value, String> {
    spawn_blocking_task(move || {
        // target 非空时优先走 probe-rs 快速通道（Rust 单进程，快）
        if !options.target.is_empty() {
            if let Some(mut session) = try_probe_rs_open(&app, &options.target, &options.probe_id) {
                crate::probe_flash::program(
                    &mut session,
                    &options.file_path,
                    &options.erase_mode,
                    options.verify,
                )?;
                return Ok(json!({ "ok": true, "verified": options.verify }));
            }
        }
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
        if let Some(frequency) = options.frequency {
            params["frequency"] = json!(frequency);
        }
        if let Some(algorithm) = options.algorithm {
            if !algorithm.is_empty() {
                params["algorithm"] = json!(algorithm);
            }
        }
        backend.call("flash.program", params, Duration::from_secs(600))
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn flash_erase(
    app: AppHandle,
    probe_id: String,
    target: String,
    pack: Option<String>,
) -> Result<Value, String> {
    spawn_blocking_task(move || {
        // target 非空时优先 probe-rs 快速通道
        if !target.is_empty() {
            if let Some(mut session) = try_probe_rs_open(&app, &target, &probe_id) {
                crate::probe_flash::erase(&mut session)?;
                return Ok(json!({ "ok": true }));
            }
        }
        let backend = get_backend(&app)?;
        let mut params = json!({ "probeId": probe_id, "target": target });
        if let Some(pack) = pack {
            params["pack"] = json!(pack);
        }
        backend.call("flash.erase", params, Duration::from_secs(300))
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn flash_read_chip_info(
    app: AppHandle,
    probe_id: String,
    target: String,
    pack: Option<String>,
) -> Result<Value, String> {
    spawn_blocking_task(move || {
        // target 非空时优先 probe-rs 快速通道
        if !target.is_empty() {
            if let Some(mut session) = try_probe_rs_open(&app, &target, &probe_id) {
                return crate::probe_flash::read_chip_info(&mut session, &target);
            }
        }
        let backend = get_backend(&app)?;
        let mut params = json!({ "probeId": probe_id, "target": target });
        if let Some(pack) = pack {
            params["pack"] = json!(pack);
        }
        backend.call("flash.chipInfo", params, BACKEND_TIMEOUT)
    })
    .await
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
pub async fn flash_read_sn(app: AppHandle, options: SnOptions) -> Result<Value, String> {
    spawn_blocking_task(move || {
        let backend = get_backend(&app)?;
        backend.call("sn.read", sn_params(&options), BACKEND_TIMEOUT)
    })
    .await
}

#[tauri::command]
pub async fn flash_write_sn(app: AppHandle, options: SnOptions) -> Result<Value, String> {
    spawn_blocking_task(move || {
        let backend = get_backend(&app)?;
        backend.call("sn.write", sn_params(&options), Duration::from_secs(300))
    })
    .await
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
pub async fn isp_program(app: AppHandle, options: IspProgramOptions) -> Result<Value, String> {
    spawn_blocking_task(move || {
        let backend = get_backend(&app)?;
        let params = json!({
            "port": options.port,
            "baudRate": options.baud_rate,
            "filePath": options.file_path,
            "address": options.address,
            "verify": options.verify,
        });
        backend.call("isp.program", params, Duration::from_secs(600))
    })
    .await
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
pub async fn production_start(app: AppHandle, options: ProductionStartOptions) -> Result<Value, String> {
    spawn_blocking_task(move || {
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
    })
    .await
}

#[tauri::command]
pub async fn production_stop(app: AppHandle) -> Result<Value, String> {
    spawn_blocking_task(move || {
        let backend = get_backend(&app)?;
        backend.call("production.stop", Value::Null, BACKEND_TIMEOUT)
    })
    .await
}

#[tauri::command]
pub async fn production_stats(app: AppHandle) -> Result<Value, String> {
    spawn_blocking_task(move || {
        let backend = get_backend(&app)?;
        backend.call("production.stats", Value::Null, BACKEND_TIMEOUT)
    })
    .await
}

#[tauri::command]
pub async fn production_records(app: AppHandle) -> Result<Value, String> {
    spawn_blocking_task(move || {
        let backend = get_backend(&app)?;
        backend.call("production.records", Value::Null, BACKEND_TIMEOUT)
    })
    .await
}

#[cfg(test)]
mod flasher_tests {
    use super::*;

    /// debug 构建下：venv 存在时后端命令应为 venv Python（而非 build/dist 旧 sidecar）。
    /// 防止 dev 模式误用旧打包后端导致改动不生效。
    #[test]
    fn debug_build_prefers_venv_over_sidecar() {
        let venv = venv_python(&backend_dir());
        let sidecar = backend_dir().join("build/dist/flash-backend");
        // 前提：开发目录 venv 存在（CI/无 venv 环境跳过）
        if !venv.exists() {
            eprintln!("skip: venv 不存在");
            return;
        }
        // debug_assertions 分支应命中 venv
        #[cfg(debug_assertions)]
        {
            assert!(venv.exists(), "venv 应存在");
            assert!(venv.to_string_lossy().ends_with(".venv/bin/python")
                    || venv.to_string_lossy().ends_with(".venv/Scripts/python.exe"));
        }
        // sidecar 存在与否不影响 debug 选择（venv 优先）
        let _ = sidecar.exists();
    }

    /// venv_python 路径指向 flash-backend/.venv 下。
    #[test]
    fn venv_python_points_inside_backend_dir() {
        let venv = venv_python(&backend_dir());
        let text = venv.to_string_lossy();
        assert!(text.contains("flash-backend/.venv"), "venv 路径应在 flash-backend/.venv 下: {text}");
    }
}
