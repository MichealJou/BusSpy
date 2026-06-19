use serde::{Deserialize, Serialize};
use serialport::{DataBits, Parity, SerialPort, StopBits};
use std::{
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream, UdpSocket},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
};
use rusqlite::{params, Connection};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerialPortInfo {
    name: String,
    port_type: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SerialOpenOptions {
    name: String,
    baud_rate: u32,
    data_bits: u8,
    stop_bits: String,
    parity: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SerialWriteRequest {
    data: String,
    hex: bool,
    append_newline: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendMemoryRequest {
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommandLabelRequest {
    name: String,
    text: String,
    hex: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandLabel {
    id: i64,
    name: String,
    text: String,
    hex: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppLanguageRequest {
    language: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SerialDataEvent {
    data: Vec<u8>,
    text: String,
    hex: String,
}

struct SerialSession {
    port: Box<dyn SerialPort>,
    running: Arc<AtomicBool>,
    reader: Option<JoinHandle<()>>,
}

#[derive(Default)]
struct SerialState {
    session: Mutex<Option<SerialSession>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NetworkOpenOptions {
    mode: String,
    remote_host: String,
    remote_port: u16,
    local_port: u16,
}

enum NetworkWriter {
    TcpClient(TcpStream),
    TcpServer(Arc<Mutex<Option<TcpStream>>>),
    Udp { socket: UdpSocket, target: SocketAddr },
}

struct NetworkSession {
    writer: NetworkWriter,
    running: Arc<AtomicBool>,
    reader: Option<JoinHandle<()>>,
}

#[derive(Default)]
struct NetworkState {
    session: Mutex<Option<NetworkSession>>,
}

#[tauri::command]
fn list_serial_ports() -> Result<Vec<SerialPortInfo>, String> {
    serialport::available_ports()
        .map_err(|error| error.to_string())
        .map(|ports| {
            ports
                .into_iter()
                .map(|port| SerialPortInfo {
                    name: port.port_name,
                    port_type: format!("{:?}", port.port_type),
                })
                .collect()
        })
}

#[tauri::command]
fn open_serial_port(
    app: AppHandle,
    state: State<'_, SerialState>,
    options: SerialOpenOptions,
) -> Result<(), String> {
    let mut session_guard = state
        .session
        .lock()
        .map_err(|_| "串口状态锁已损坏".to_string())?;

    if session_guard.is_some() {
        close_locked_session(&mut session_guard);
    }

    let data_bits = parse_data_bits(options.data_bits)?;
    let stop_bits = parse_stop_bits(&options.stop_bits)?;
    let parity = parse_parity(&options.parity)?;

    let port = serialport::new(&options.name, options.baud_rate)
        .data_bits(data_bits)
        .stop_bits(stop_bits)
        .parity(parity)
        .timeout(Duration::from_millis(50))
        .open()
        .map_err(|error| format!("打开串口失败：{error}"))?;

    let mut reader_port = port
        .try_clone()
        .map_err(|error| format!("创建串口读通道失败：{error}"))?;
    let running = Arc::new(AtomicBool::new(true));
    let reader_running = Arc::clone(&running);
    let reader_app = app.clone();

    let reader = thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        while reader_running.load(Ordering::SeqCst) {
            match reader_port.read(&mut buffer) {
                Ok(count) if count > 0 => {
                    let bytes = buffer[..count].to_vec();
                    let event = serial_data_event(bytes);
                    let _ = reader_app.emit("serial-data", event);
                }
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {}
                Err(error) => {
                    let _ = reader_app.emit("serial-error", error.to_string());
                    break;
                }
            }
        }
    });

    *session_guard = Some(SerialSession {
        port,
        running,
        reader: Some(reader),
    });

    Ok(())
}

#[tauri::command]
fn close_serial_port(state: State<'_, SerialState>) -> Result<(), String> {
    let mut session_guard = state
        .session
        .lock()
        .map_err(|_| "串口状态锁已损坏".to_string())?;
    close_locked_session(&mut session_guard);
    Ok(())
}

#[tauri::command]
fn write_serial_data(
    state: State<'_, SerialState>,
    request: SerialWriteRequest,
) -> Result<usize, String> {
    let mut session_guard = state
        .session
        .lock()
        .map_err(|_| "串口状态锁已损坏".to_string())?;

    let session = session_guard
        .as_mut()
        .ok_or_else(|| "串口未打开".to_string())?;

    let bytes = request_to_bytes(request)?;

    session
        .port
        .write_all(&bytes)
        .map_err(|error| format!("发送失败：{error}"))?;
    session
        .port
        .flush()
        .map_err(|error| format!("刷新串口输出失败：{error}"))?;

    Ok(bytes.len())
}

#[tauri::command]
fn open_network_transport(
    app: AppHandle,
    state: State<'_, NetworkState>,
    options: NetworkOpenOptions,
) -> Result<(), String> {
    let mut session_guard = state
        .session
        .lock()
        .map_err(|_| "网络连接状态锁已损坏".to_string())?;

    if session_guard.is_some() {
        close_locked_network_session(&mut session_guard);
    }

    let running = Arc::new(AtomicBool::new(true));
    let session = match options.mode.as_str() {
        "tcp-client" => open_tcp_client(app, &options, Arc::clone(&running))?,
        "tcp-server" => open_tcp_server(app, &options, Arc::clone(&running))?,
        "udp" => open_udp(app, &options, Arc::clone(&running))?,
        _ => return Err("不支持的网络连接方式".to_string()),
    };

    *session_guard = Some(session);
    Ok(())
}

#[tauri::command]
fn close_network_transport(state: State<'_, NetworkState>) -> Result<(), String> {
    let mut session_guard = state
        .session
        .lock()
        .map_err(|_| "网络连接状态锁已损坏".to_string())?;
    close_locked_network_session(&mut session_guard);
    Ok(())
}

#[tauri::command]
fn write_network_data(
    state: State<'_, NetworkState>,
    request: SerialWriteRequest,
) -> Result<usize, String> {
    let mut session_guard = state
        .session
        .lock()
        .map_err(|_| "网络连接状态锁已损坏".to_string())?;
    let session = session_guard
        .as_mut()
        .ok_or_else(|| "网络连接未打开".to_string())?;
    let bytes = request_to_bytes(request)?;

    match &mut session.writer {
        NetworkWriter::TcpClient(stream) => {
            stream.write_all(&bytes).map_err(|error| format!("发送失败：{error}"))?;
            stream.flush().map_err(|error| format!("刷新网络输出失败：{error}"))?;
        }
        NetworkWriter::TcpServer(client) => {
            let mut guard = client.lock().map_err(|_| "TCP客户端状态锁已损坏".to_string())?;
            let stream = guard.as_mut().ok_or_else(|| "暂无TCP客户端连接".to_string())?;
            stream.write_all(&bytes).map_err(|error| format!("发送失败：{error}"))?;
            stream.flush().map_err(|error| format!("刷新网络输出失败：{error}"))?;
        }
        NetworkWriter::Udp { socket, target } => {
            socket
                .send_to(&bytes, *target)
                .map_err(|error| format!("UDP发送失败：{error}"))?;
        }
    }

    Ok(bytes.len())
}

#[tauri::command]
fn list_send_memory(app: AppHandle) -> Result<Vec<String>, String> {
    let connection = open_app_database(&app)?;
    let mut statement = connection
        .prepare("SELECT text FROM send_memory ORDER BY updated_at DESC LIMIT 20")
        .map_err(|error| format!("读取发送记忆失败：{error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("读取发送记忆失败：{error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取发送记忆失败：{error}"))
}

#[tauri::command]
fn remember_send_memory(app: AppHandle, request: SendMemoryRequest) -> Result<Vec<String>, String> {
    let text = request.text.trim();
    if text.is_empty() {
        return list_send_memory(app);
    }

    let connection = open_app_database(&app)?;
    connection
        .execute(
            "INSERT INTO send_memory(text, updated_at) VALUES (?1, unixepoch())
             ON CONFLICT(text) DO UPDATE SET updated_at = excluded.updated_at",
            params![text],
        )
        .map_err(|error| format!("保存发送记忆失败：{error}"))?;
    connection
        .execute(
            "DELETE FROM send_memory
             WHERE id NOT IN (SELECT id FROM send_memory ORDER BY updated_at DESC LIMIT 20)",
            [],
        )
        .map_err(|error| format!("清理发送记忆失败：{error}"))?;

    list_send_memory(app)
}

#[tauri::command]
fn clear_send_memory(app: AppHandle) -> Result<(), String> {
    let connection = open_app_database(&app)?;
    connection
        .execute("DELETE FROM send_memory", [])
        .map_err(|error| format!("清空发送记忆失败：{error}"))?;
    Ok(())
}

#[tauri::command]
fn list_command_labels(app: AppHandle) -> Result<Vec<CommandLabel>, String> {
    let connection = open_app_database(&app)?;
    let mut statement = connection
        .prepare("SELECT id, name, text, hex FROM command_labels ORDER BY updated_at DESC, id DESC")
        .map_err(|error| format!("读取命令标签失败：{error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(CommandLabel {
                id: row.get(0)?,
                name: row.get(1)?,
                text: row.get(2)?,
                hex: row.get::<_, i64>(3)? != 0,
            })
        })
        .map_err(|error| format!("读取命令标签失败：{error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取命令标签失败：{error}"))
}

#[tauri::command]
fn save_command_label(app: AppHandle, request: CommandLabelRequest) -> Result<Vec<CommandLabel>, String> {
    let name = request.name.trim();
    let text = request.text.trim();
    if name.is_empty() || text.is_empty() {
        return Err("标签名和编码不能为空".to_string());
    }

    let connection = open_app_database(&app)?;
    connection
        .execute(
            "INSERT INTO command_labels(name, text, hex, updated_at) VALUES (?1, ?2, ?3, unixepoch())
             ON CONFLICT(name) DO UPDATE SET text = excluded.text, hex = excluded.hex, updated_at = excluded.updated_at",
            params![name, text, if request.hex { 1 } else { 0 }],
        )
        .map_err(|error| format!("保存命令标签失败：{error}"))?;
    list_command_labels(app)
}

#[tauri::command]
fn delete_command_label(app: AppHandle, id: i64) -> Result<Vec<CommandLabel>, String> {
    let connection = open_app_database(&app)?;
    connection
        .execute("DELETE FROM command_labels WHERE id = ?1", params![id])
        .map_err(|error| format!("删除命令标签失败：{error}"))?;
    list_command_labels(app)
}

#[tauri::command]
fn get_app_language(app: AppHandle) -> Result<String, String> {
    let connection = open_app_database(&app)?;
    let language = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'language'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "zh".to_string());
    Ok(language)
}

#[tauri::command]
fn set_app_language(app: AppHandle, request: AppLanguageRequest) -> Result<String, String> {
    let language = match request.language.as_str() {
        "zh" | "en" => request.language,
        _ => return Err("不支持的语言".to_string()),
    };
    let connection = open_app_database(&app)?;
    connection
        .execute(
            "INSERT INTO app_settings(key, value) VALUES ('language', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![language],
        )
        .map_err(|error| format!("保存语言设置失败：{error}"))?;
    Ok(language)
}

#[tauri::command]
fn emit_loopback_data(app: AppHandle, request: SerialWriteRequest) -> Result<usize, String> {
    let bytes = request_to_bytes(request)?;
    let byte_count = bytes.len();
    let event = serial_data_event(bytes);
    app.emit("serial-data", event)
        .map_err(|error| format!("回环自测失败：{error}"))?;
    Ok(byte_count)
}

fn open_app_database(app: &AppHandle) -> Result<Connection, String> {
    let db_path = app_database_path(app)?;
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建应用数据目录失败：{error}"))?;
    }
    let connection = Connection::open(db_path).map_err(|error| format!("打开应用数据库失败：{error}"))?;
    initialize_database(&connection)?;
    Ok(connection)
}

fn app_database_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("busspy.sqlite3"))
        .map_err(|error| format!("获取应用数据目录失败：{error}"))
}

fn initialize_database(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS send_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL UNIQUE,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_send_memory_updated_at ON send_memory(updated_at DESC);
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS command_labels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                text TEXT NOT NULL,
                hex INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL
            );",
        )
        .map_err(|error| format!("初始化应用数据库失败：{error}"))
}

fn close_locked_session(session_guard: &mut Option<SerialSession>) {
    if let Some(mut session) = session_guard.take() {
        session.running.store(false, Ordering::SeqCst);
        drop(session.port);
        if let Some(reader) = session.reader.take() {
            let _ = reader.join();
        }
    }
}

fn close_locked_network_session(session_guard: &mut Option<NetworkSession>) {
    if let Some(mut session) = session_guard.take() {
        session.running.store(false, Ordering::SeqCst);
        if let Some(reader) = session.reader.take() {
            let _ = reader.join();
        }
    }
}

fn open_tcp_client(
    app: AppHandle,
    options: &NetworkOpenOptions,
    running: Arc<AtomicBool>,
) -> Result<NetworkSession, String> {
    let address = format!("{}:{}", options.remote_host, options.remote_port);
    let stream = TcpStream::connect(&address).map_err(|error| format!("TCP连接失败：{error}"))?;
    stream
        .set_read_timeout(Some(Duration::from_millis(50)))
        .map_err(|error| format!("设置TCP超时失败：{error}"))?;
    let mut reader_stream = stream
        .try_clone()
        .map_err(|error| format!("创建TCP读通道失败：{error}"))?;
    let writer_stream = stream
        .try_clone()
        .map_err(|error| format!("创建TCP写通道失败：{error}"))?;
    let reader_running = Arc::clone(&running);
    let reader = thread::spawn(move || read_stream_loop(app, &mut reader_stream, reader_running));

    Ok(NetworkSession {
        writer: NetworkWriter::TcpClient(writer_stream),
        running,
        reader: Some(reader),
    })
}

fn open_tcp_server(
    app: AppHandle,
    options: &NetworkOpenOptions,
    running: Arc<AtomicBool>,
) -> Result<NetworkSession, String> {
    let listener = TcpListener::bind(("0.0.0.0", options.local_port))
        .map_err(|error| format!("TCP监听失败：{error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("设置TCP监听失败：{error}"))?;
    let client_writer = Arc::new(Mutex::new(None));
    let reader_client = Arc::clone(&client_writer);
    let reader_running = Arc::clone(&running);
    let reader = thread::spawn(move || {
        while reader_running.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_read_timeout(Some(Duration::from_millis(50)));
                    if let Ok(writer_stream) = stream.try_clone() {
                        if let Ok(mut guard) = reader_client.lock() {
                            *guard = Some(writer_stream);
                        }
                    }
                    read_stream_loop(app.clone(), &mut stream, Arc::clone(&reader_running));
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(50));
                }
                Err(error) => {
                    let _ = app.emit("serial-error", error.to_string());
                    break;
                }
            }
        }
    });

    Ok(NetworkSession {
        writer: NetworkWriter::TcpServer(client_writer),
        running,
        reader: Some(reader),
    })
}

fn open_udp(
    app: AppHandle,
    options: &NetworkOpenOptions,
    running: Arc<AtomicBool>,
) -> Result<NetworkSession, String> {
    let socket = UdpSocket::bind(("0.0.0.0", options.local_port))
        .map_err(|error| format!("UDP绑定失败：{error}"))?;
    socket
        .set_read_timeout(Some(Duration::from_millis(50)))
        .map_err(|error| format!("设置UDP超时失败：{error}"))?;
    let target: SocketAddr = format!("{}:{}", options.remote_host, options.remote_port)
        .parse()
        .map_err(|error| format!("UDP目标地址无效：{error}"))?;
    let reader_socket = socket
        .try_clone()
        .map_err(|error| format!("创建UDP读通道失败：{error}"))?;
    let writer_socket = socket
        .try_clone()
        .map_err(|error| format!("创建UDP写通道失败：{error}"))?;
    let reader_running = Arc::clone(&running);
    let reader = thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        while reader_running.load(Ordering::SeqCst) {
            match reader_socket.recv_from(&mut buffer) {
                Ok((count, _)) if count > 0 => {
                    let _ = app.emit("serial-data", serial_data_event(buffer[..count].to_vec()));
                }
                Ok(_) => {}
                Err(error)
                    if error.kind() == std::io::ErrorKind::TimedOut
                        || error.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(error) => {
                    let _ = app.emit("serial-error", error.to_string());
                    break;
                }
            }
        }
    });

    Ok(NetworkSession {
        writer: NetworkWriter::Udp {
            socket: writer_socket,
            target,
        },
        running,
        reader: Some(reader),
    })
}

fn read_stream_loop(app: AppHandle, stream: &mut TcpStream, running: Arc<AtomicBool>) {
    let mut buffer = [0_u8; 4096];
    while running.load(Ordering::SeqCst) {
        match stream.read(&mut buffer) {
            Ok(count) if count > 0 => {
                let _ = app.emit("serial-data", serial_data_event(buffer[..count].to_vec()));
            }
            Ok(_) => break,
            Err(error)
                if error.kind() == std::io::ErrorKind::TimedOut
                    || error.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(error) => {
                let _ = app.emit("serial-error", error.to_string());
                break;
            }
        }
    }
}

fn request_to_bytes(request: SerialWriteRequest) -> Result<Vec<u8>, String> {
    if request.hex {
        parse_hex_bytes(&request.data)
    } else {
        let mut bytes = request.data.into_bytes();
        if request.append_newline {
            bytes.extend_from_slice(b"\r\n");
        }
        Ok(bytes)
    }
}

fn serial_data_event(bytes: Vec<u8>) -> SerialDataEvent {
    SerialDataEvent {
        text: String::from_utf8_lossy(&bytes).to_string(),
        hex: bytes_to_hex(&bytes),
        data: bytes,
    }
}

fn parse_data_bits(value: u8) -> Result<DataBits, String> {
    match value {
        5 => Ok(DataBits::Five),
        6 => Ok(DataBits::Six),
        7 => Ok(DataBits::Seven),
        8 => Ok(DataBits::Eight),
        _ => Err(format!("不支持的数据位：{value}")),
    }
}

fn parse_stop_bits(value: &str) -> Result<StopBits, String> {
    match value {
        "1" => Ok(StopBits::One),
        "2" => Ok(StopBits::Two),
        _ => Err(format!("不支持的停止位：{value}")),
    }
}

fn parse_parity(value: &str) -> Result<Parity, String> {
    match value {
        "None" => Ok(Parity::None),
        "Odd" => Ok(Parity::Odd),
        "Even" => Ok(Parity::Even),
        _ => Err(format!("不支持的校验位：{value}")),
    }
}

fn parse_hex_bytes(input: &str) -> Result<Vec<u8>, String> {
    let compact: String = input.chars().filter(|ch| !ch.is_whitespace()).collect();
    if compact.is_empty() {
        return Ok(Vec::new());
    }
    if compact.len() % 2 != 0 {
        return Err("HEX 数据长度必须是偶数".to_string());
    }

    (0..compact.len())
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&compact[index..index + 2], 16)
                .map_err(|_| format!("非法 HEX 字节：{}", &compact[index..index + 2]))
        })
        .collect()
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::{Read, Write}, time::Duration};

    #[test]
    fn parses_hex_with_spaces() {
        assert_eq!(parse_hex_bytes("55 AA 01 00").unwrap(), vec![0x55, 0xAA, 0x01, 0x00]);
    }

    #[test]
    fn rejects_odd_hex_length() {
        assert!(parse_hex_bytes("55 A").is_err());
    }

    #[test]
    fn rejects_invalid_hex_byte() {
        assert!(parse_hex_bytes("55 ZZ").is_err());
    }

    #[test]
    fn formats_bytes_as_uppercase_hex() {
        assert_eq!(bytes_to_hex(&[0x00, 0x0f, 0xa5]), "00 0F A5");
    }

    #[test]
    fn converts_text_request_with_newline() {
        let bytes = request_to_bytes(SerialWriteRequest {
            data: "AT".to_string(),
            hex: false,
            append_newline: true,
        })
        .unwrap();
        assert_eq!(bytes, b"AT\r\n");
    }

    #[test]
    fn converts_hex_request_without_newline() {
        let bytes = request_to_bytes(SerialWriteRequest {
            data: "55 AA".to_string(),
            hex: true,
            append_newline: true,
        })
        .unwrap();
        assert_eq!(bytes, vec![0x55, 0xAA]);
    }

    #[test]
    fn creates_serial_data_event_payload() {
        let event = serial_data_event(vec![0x41, 0x42]);
        assert_eq!(event.text, "AB");
        assert_eq!(event.hex, "41 42");
        assert_eq!(event.data, vec![0x41, 0x42]);
    }

    #[cfg(unix)]
    #[test]
    #[ignore = "macOS PTY may be rejected by serialport as Not a typewriter; use with a real tty pair when available"]
    fn serialport_reads_and_writes_via_virtual_pty() {
        use std::{
            ffi::CStr,
            fs::File,
            os::fd::FromRawFd,
            ptr,
        };

        let mut master_fd = 0;
        let mut slave_fd = 0;

        let result = unsafe {
            libc::openpty(
                &mut master_fd,
                &mut slave_fd,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
            )
        };
        assert_eq!(result, 0);

        let tty_name = unsafe { libc::ttyname(slave_fd) };
        assert!(!tty_name.is_null());
        let slave_path = unsafe { CStr::from_ptr(tty_name) }
            .to_string_lossy()
            .to_string();
        unsafe {
            libc::close(slave_fd);
        }

        let mut master = unsafe { File::from_raw_fd(master_fd) };
        let mut port = serialport::new(slave_path, 115_200)
            .timeout(Duration::from_millis(500))
            .open()
            .unwrap();

        master.write_all(b"PING").unwrap();
        let mut read_from_port = [0_u8; 4];
        port.read_exact(&mut read_from_port).unwrap();
        assert_eq!(&read_from_port, b"PING");

        port.write_all(b"PONG").unwrap();
        port.flush().unwrap();
        let mut read_from_master = [0_u8; 4];
        master.read_exact(&mut read_from_master).unwrap();
        assert_eq!(&read_from_master, b"PONG");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SerialState::default())
        .manage(NetworkState::default())
        .invoke_handler(tauri::generate_handler![
            list_serial_ports,
            open_serial_port,
            close_serial_port,
            write_serial_data,
            open_network_transport,
            close_network_transport,
            write_network_data,
            list_send_memory,
            remember_send_memory,
            clear_send_memory,
            list_command_labels,
            save_command_label,
            delete_command_label,
            get_app_language,
            set_app_language,
            emit_loopback_data
        ])
        .run(tauri::generate_context!())
        .expect("error while running BusSpy");
}
