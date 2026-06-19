# BusSpy 使用说明

## 1. 下载与安装

BusSpy 后续发布时建议放在 GitHub Releases，用户可以直接下载对应系统的安装包。

推荐发布文件：

- Windows：`BusSpy_x64.msi`、`BusSpy_x64-setup.exe` 或 `BusSpy_windows_x64.zip`
- macOS：`BusSpy_aarch64.dmg`、`BusSpy_x64.dmg` 或 `BusSpy.app.zip`
- Linux：`BusSpy.AppImage`、`BusSpy_amd64.deb`、`BusSpy_x86_64.rpm`

### Windows 安装

普通用户建议下载 `.msi` 或 `.exe` 后双击安装。

如果没有购买代码签名证书，Windows 可能提示“未知发布者”或 SmartScreen 拦截。处理方式：

1. 点击“更多信息”
2. 点击“仍要运行”
3. 按安装向导完成安装

如果不想安装，也可以下载 `.zip` 免安装版，解压后运行 BusSpy。

### macOS 安装

普通用户建议下载 `.dmg`：

1. 打开 `.dmg`
2. 将 BusSpy 拖到 `Applications`
3. 从应用程序中打开 BusSpy

如果没有 Apple Developer 签名和公证，macOS 可能提示无法验证开发者。处理方式：

- 右键 BusSpy，选择“打开”，再确认打开
- 或进入“系统设置 -> 隐私与安全性”，允许 BusSpy 运行

命令行安装示例：

```bash
curl -L -o BusSpy.dmg https://github.com/MichealJou/BusSpy/releases/latest/download/BusSpy_aarch64.dmg
open BusSpy.dmg
```

如果下载的是 `.app.zip`：

```bash
curl -L -o BusSpy.app.zip https://github.com/MichealJou/BusSpy/releases/latest/download/BusSpy.app.zip
unzip BusSpy.app.zip
mv BusSpy.app /Applications/
open /Applications/BusSpy.app
```

### Linux 安装

推荐优先提供 `AppImage`，它不依赖具体发行版安装器。

AppImage 命令行运行：

```bash
curl -L -o BusSpy.AppImage https://github.com/MichealJou/BusSpy/releases/latest/download/BusSpy.AppImage
chmod +x BusSpy.AppImage
./BusSpy.AppImage
```

Debian / Ubuntu 可以使用 `.deb`：

```bash
curl -L -o BusSpy.deb https://github.com/MichealJou/BusSpy/releases/latest/download/BusSpy_amd64.deb
sudo apt install ./BusSpy.deb
busspy
```

Fedora / RHEL 可以使用 `.rpm`：

```bash
curl -L -o BusSpy.rpm https://github.com/MichealJou/BusSpy/releases/latest/download/BusSpy_x86_64.rpm
sudo dnf install ./BusSpy.rpm
busspy
```

Linux 下如果无法打开串口，通常是当前用户没有串口设备权限：

```bash
sudo usermod -aG dialout $USER
```

执行后需要退出登录再进入系统，或者重启。

### 无证书发布说明

BusSpy 可以不购买代码签名证书直接分发。影响主要是首次运行体验：

- Windows：可能提示未知发布者或 SmartScreen，需要用户手动选择仍要运行。
- macOS：可能提示无法验证开发者，需要用户手动允许。
- Linux：通常没有证书限制，但可能需要给 AppImage 添加执行权限。

公开发布时建议把安装包放到 GitHub Releases，并在 Release 说明里写清楚首次运行提示和串口权限处理方式。

## 2. 启动应用

BusSpy 支持 macOS、Windows、Linux。

不同系统下端口名称不同：

```text
macOS: /dev/cu.usbserial-xxx
Windows: COM3、COM4
Linux: /dev/ttyUSB0、/dev/ttyS0
```

注意事项：

- Windows 下 TCP/UDP 和 COM 口都正常支持。
- macOS 下真实 USB 串口通常正常，部分虚拟串口测试可能受系统限制。
- 自动发现端口通常不需要额外权限。
- 打开串口通信时，如果系统拒绝访问，就需要检查权限或端口占用。
- Linux 下串口可能需要权限，例如加入 `dialout` 组：

```bash
sudo usermod -aG dialout $USER
```

执行后需要重新登录系统。

Windows 常见权限/占用问题：

- 如果 `COM3` 被其他串口助手、IDE、烧录工具占用，BusSpy 无法打开。
- 关闭占用程序后重新连接即可。

macOS 常见权限/占用问题：

- 串口设备通常是 `/dev/cu.*`。
- 如果是未签名的开发版应用，首次运行可能需要在系统安全设置中允许。
- 如果端口被其他程序占用，需要关闭占用程序。

开发环境启动：

```bash
pnpm tauri:dev
```

只检查前端构建：

```bash
pnpm typecheck
pnpm --filter @busspy/desktop build
```

## 3. 连接设置

左侧 `连接设置` 用来选择当前通信方式。

`端口` 下拉中包含：

- 真实串口设备，例如 `cu.usbserial-310`
- `TCPClient`
- `TCPServer`
- `UDP`

选择不同项后，下方会显示对应配置。

### 串口

用于连接 USB 转串口、CH340、RS232、RS485 等设备。

需要配置：

- 端口
- 波特率
- 校验位
- 数据位
- 停止位
- RTS / DTR

点击 `连接` 打开串口，点击 `断开` 关闭串口。

### TCPClient

应用作为 TCP 客户端，主动连接远端服务。

需要配置：

- 目标地址
- 目标端口

### TCPServer

应用作为 TCP 服务端，监听本地端口，等待客户端连接。

需要配置：

- 监听端口

### UDP

应用绑定本地端口，并向目标地址发送 UDP 数据。

需要配置：

- 本地端口
- 目标地址
- 目标端口

## 4. 接收数据

接收区显示当前连接收到的数据。

可用操作：

- 暂停/继续：只暂停界面追加显示，不关闭连接
- 清空窗口：清空当前日志和统计
- 复制内容：复制当前日志文本
- HEX：按 HEX 显示接收数据
- 时间戳：显示或隐藏每条日志时间
- 分包：按接收间隔分包
- 超时：分包超时时间，单位 ms
- 写文件：预留给实时保存接收数据
- 滚动：自动滚动到最新数据

说明：`分包` 的目标是把连续字节按时间间隔归为一帧。当前界面已有控制项，后续可继续增强为完整接收帧历史列表。

## 5. 发送数据

发送区用于通过当前连接发送文本、HEX 或文件内容。

### 文本/HEX 模式

- `文本`：输入内容按字符串发送
- `HEX`：输入内容按 HEX 字节发送，例如：

```text
23 01 1D 04 01 09
```

HEX 模式要求字节长度为偶数。

### 追加换行

文本模式可开启 `追加换行`，发送时追加 `\r\n`。

HEX 模式下不会追加换行。

### 定时发送

开启 `定时发送` 后，会按右侧间隔重复发送当前输入内容。

### 发送文件

点击 `发送文件` 选择文件。

- 文本模式：按文本读入输入框
- HEX 模式：按二进制读取，并转换为 HEX 填入输入框

当前流程是“先载入输入框，再点击发送”。

### 标签命名

发送输入框右侧有编辑图标。

用法：

1. 在输入框输入一段常用内容
2. 点击编辑图标
3. 输入标签名，例如 `读取温度`
4. 保存

保存后，输入框下拉中会显示标签名。选择标签后，会自动填入对应内容，并恢复保存时的文本/HEX 模式。

输入时会自动筛选：

- 输入标签名可匹配标签
- 输入原始编码可匹配历史值

## 6. 校验

发送区支持 HEX 发送时自动追加校验。

支持类型：

- None
- SUM
- XOR
- CRC8
- CRC16
- Modbus CRC16

`校验范围` 用来指定参与校验的字节范围：

- `1` 表示第 1 个字节
- `end` 表示最后一个字节

例如：

```text
校验范围：1 - end
```

表示从第 1 字节到最后 1 字节都参与校验。

## 7. 协议解析

下方 `协议解析` 页签用于查看帧结构。

支持来源：

- 接收帧：最近一条 RX 数据
- 发送帧：当前发送输入框内容

支持视图：

- 字节视图：一行横向表格，按字节位显示
- 字段视图：逐字节明细表

默认字段识别按常见 Modbus RTU 风格：

- 第 0 字节：地址
- 第 1 字节：功能码
- 第 2-3 字节：起始位
- 第 4-5 字节：数量
- 最后 2 字节：校验
- 中间其他：数据

## 8. 顶部工具栏

顶部工具栏保留全局操作：

- 串口助手：当前功能模块
- 保存日志：下载文本日志
- 导出数据：导出 JSON 数据
- 复制数据：复制当前日志
- 清空：清空日志和统计
- 语言切换：中文 / English

没有日志时，保存、导出、复制会禁用。

## 9. 常见问题

### 为什么发送后没有接收？

发送只代表数据已经写出。只有设备真实返回数据时，接收区才会显示 RX。

如果没有接收，常见原因是：

- 下位机没有回包
- 发送格式不对，文本/HEX 模式选错
- 协议内容不对
- 串口参数不对
- TCP/UDP 目标没有响应

### 为什么协议解析没有接收内容？

协议解析默认看最近接收帧。如果没有接收到 RX，就不会有接收帧可解析。

可以切换到 `发送帧` 查看当前发送输入框内容。

### 写文件现在能直接保存吗？

当前已有 `写文件` 开关入口，但实时写文件流程还需要继续接文件路径选择和持续写入。

### 发送文件是不是直接发送？

当前不是直接发送。它会先把文件内容读入发送输入框，再由用户点击 `发送`。

## 10. 已知后续任务

- 接收数据实时写文件
- 发送文件分包发送、进度、取消
- 接收分包后的帧历史列表
- 自定义协议模板
- 字段范围标签持久化
- 后端错误码国际化

## 11. 跨平台打包

Tauri 应用需要在对应系统上构建对应安装包。

```bash
pnpm tauri:build
```

建议：

- 在 macOS 上构建 macOS 安装包
- 在 Windows 上构建 Windows 安装包
- 在 Linux 上构建 Linux 安装包

跨平台发布时，需要分别准备三个平台的构建环境。

项目已经配置 GitHub Actions 自动发布流水线：

```text
.github/workflows/release.yml
```

触发方式：

- 推送 `v*` tag，例如 `v0.1.0`
- 或在 GitHub Actions 页面手动运行 `Release` workflow

发布步骤：

```bash
git tag v0.1.0
git push origin v0.1.0
```

流水线会分别在这些环境构建：

- `windows-latest`：生成 Windows 安装包
- `macos-latest`：生成 Apple Silicon 和 Intel macOS 安装包
- `ubuntu-22.04`：生成 Linux 安装包

自动上传的文件名会包含版本号、平台和架构，例如：

```text
BusSpy-0.1.0-windows-x86_64-nsis-setup.exe
BusSpy-0.1.0-windows-x86_64-msi.msi
BusSpy-0.1.0-macos-aarch64-dmg.dmg
BusSpy-0.1.0-macos-x86_64-dmg.dmg
BusSpy-0.1.0-linux-x86_64-appimage.AppImage
BusSpy-0.1.0-linux-x86_64-deb.deb
BusSpy-0.1.0-linux-x86_64-rpm.rpm
```

Release 默认创建为草稿。构建完成后，需要进入 GitHub Releases 检查文件，再手动发布。

发布前请确认三个版本号一致：

- `apps/desktop/package.json`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/Cargo.toml`

如果版本号不一致，Release tag 和安装包版本可能让用户混淆。
