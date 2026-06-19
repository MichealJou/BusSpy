# BusSpy

BusSpy 是一个基于 Tauri + React 的串口/网络调试助手，面向串口设备、TCP/UDP 调试、HEX 收发、协议帧观察和常用发送内容管理。

## 当前功能

- 连接方式：串口、TCPClient、TCPServer、UDP
- 接收数据：文本/HEX 显示、时间戳、分包显示、自动滚动、复制、清空
- 发送数据：文本/HEX 发送、追加换行、定时发送、文件载入、发送历史、标签命名
- 校验追加：None、SUM、XOR、CRC8、CRC16、Modbus CRC16
- 协议解析：接收帧/发送帧切换、字节视图、字段视图
- 数据导出：保存日志、导出结构化 JSON
- 设置持久化：语言、发送历史、发送标签使用 SQLite 保存

## 平台支持

BusSpy 目标支持：

- macOS
- Windows
- Linux

不同系统的串口名称不同：

```text
macOS: /dev/cu.usbserial-xxx
Windows: COM3、COM4
Linux: /dev/ttyUSB0、/dev/ttyS0
```

Linux 下如果无法打开串口，通常需要把当前用户加入 `dialout` 组，或调整串口设备权限。

## 权限说明

自动发现端口通常不需要额外权限，但打开串口通信可能受系统权限限制：

- macOS：通常可直接使用 USB 串口；首次运行打包应用时可能需要在系统安全设置中允许应用运行。
- Windows：通常可直接访问 `COM` 口；如果端口被其他软件占用，需要先关闭占用程序。
- Linux：常见情况是用户没有 `/dev/ttyUSB0`、`/dev/ttyS0` 等设备权限，需要加入 `dialout` 组。

Linux 权限示例：

```bash
sudo usermod -aG dialout $USER
```

执行后需要重新登录系统。

## 开发命令

```bash
pnpm install
pnpm typecheck
pnpm --filter @busspy/desktop build
pnpm tauri:dev
```

## 使用文档

详细使用说明见：

- [docs/usage.md](docs/usage.md)

## 验证命令

```bash
pnpm typecheck
pnpm --filter @busspy/desktop build
cd apps/desktop/src-tauri
cargo check
cargo test
```
