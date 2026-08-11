## STM32 专注阶段：烧录链路 + 器件库 + UI 优化

51 后置。聚焦三件事（均围绕 STM32）。

### 一、修通 STM32 烧录链路

**代码审查发现一个真实 bug（`serial_isp.py:126`）**：
`_get_chip_id` 里 `int.from_bytes(id_bytes[:length-1], "big")` 把 ID 字节截断了。AN3155 协议：GetID 响应为 `ACK + N + ID(N+1 字节) + ACK`，`port.read(length+1)` 已读全量 ID，再 slice `[:length-1]` 反而截断（如 STM32F103 的 2 字节 ID 0x0410，N=1，`[:0]` 取空 → chip_id 恒为 0）。
- **修复**：改为 `int.from_bytes(id_bytes, "big")`。ISP 烧录本身能完成（chip_id 只做日志），但芯片 ID 显示恒 0x0000，修复后正确显示（0x0410 等）。

**审查结论**：SWD 烧录（`flash.py`：连接→擦除→编程→校验、进度事件、芯片信息）逻辑完整无需改动。真板实测清单将提供给用户：SWD（ATK-HS-V3 + STM32F103 板）烧录 + ISP（USB-TTL + BOOT0 拉高）烧录各一次。

### 二、预置常用 STM32 器件包（扩充 `devices.json`）

- 保留现有 47 个型号，新增常用型号，覆盖 F0/F1/F2/F3/F4/F7/G0/G4/L0/L1/L4/H7 全系列
- `builtin: true`：pyOCD 内置可直接烧（如 stm32f051、stm32f103rc、stm32f412xg、stm32f429xi、stm32f767zi、stm32h743xx、stm32h750xx、stm32l432kc 等）
- `builtin: false`：需下载 DFP 的常用型号（如 STM32F103C8T6、F407VET6/ZET6、F411RET6、F446RET6 等），器件下拉标注"需装 DFP"，下载器 STM32 分类一键装
- 每个新增 target 名用 `pyocd list --targets` 校验可解析

### 三、烧录页 UI 优化（`ProgramPanel.tsx`，增量不动架构）

1. **器件下拉**：选项标注「内置可烧」/「需装 DFP」徽标；DFP 未装的可选下载器直达按钮
2. **串口 ISP 模式**：默认选中第一个串口；接线提示（BOOT0 拉高 + 复位）改为分步清晰展示
3. **烧录流程**：失败原因红色 Alert 高亮（已有基础上加强可读性）；阶段进度条保留
4. **探针引导**：未检测到探针时显示"请连接探针"引导（替代仅灰色提示文字）
5. i18n 中英文文案补充

### 验证

1. `serial_isp.py` 修复后直连后端 RPC 测试 `_get_chip_id` 逻辑（无硬件时用单测验证字节解析）
2. `devices.json` 新增 target 名逐个用 pyOCD 校验可解析
3. `pnpm typecheck` + `cargo check`（如涉及 Rust 则）
4. 提供真板实测清单（SWD 烧录、ISP 烧录、芯片信息读取）供用户验证

### 不做的事

- 51 烧录（后置）
- 烧录器硬件协议重写、量产模式重构（已有实现不动）