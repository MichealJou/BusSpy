import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

export interface SerialPortInfo {
  name: string;
  portType: string;
}

export interface SerialOpenOptions {
  name: string;
  baudRate: number;
  dataBits: number;
  stopBits: string;
  parity: string;
}

export interface SerialWriteRequest {
  data: string;
  hex: boolean;
  appendNewline: boolean;
}

export interface NetworkOpenOptions {
  mode: "tcp-client" | "tcp-server" | "udp";
  remoteHost: string;
  remotePort: number;
  localPort: number;
}

export interface SendMemoryRequest {
  text: string;
}

export interface AppLanguageRequest {
  language: "zh" | "en";
}

export interface CommandLabel {
  id: number;
  name: string;
  text: string;
  hex: boolean;
}

export interface CommandLabelRequest {
  name: string;
  text: string;
  hex: boolean;
}

export interface SerialDataEvent {
  data: number[];
  text: string;
  hex: string;
}

export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  return invoke<SerialPortInfo[]>("list_serial_ports");
}

export async function openSerialPort(options: SerialOpenOptions): Promise<void> {
  return invoke("open_serial_port", { options });
}

export async function closeSerialPort(): Promise<void> {
  return invoke("close_serial_port");
}

export async function writeSerialData(request: SerialWriteRequest): Promise<number> {
  return invoke<number>("write_serial_data", { request });
}

export async function openNetworkTransport(options: NetworkOpenOptions): Promise<void> {
  return invoke("open_network_transport", { options });
}

export async function closeNetworkTransport(): Promise<void> {
  return invoke("close_network_transport");
}

export async function writeNetworkData(request: SerialWriteRequest): Promise<number> {
  return invoke<number>("write_network_data", { request });
}

export async function emitLoopbackData(request: SerialWriteRequest): Promise<number> {
  return invoke<number>("emit_loopback_data", { request });
}

export async function listSendMemory(): Promise<string[]> {
  return invoke<string[]>("list_send_memory");
}

export async function rememberSendMemory(request: SendMemoryRequest): Promise<string[]> {
  return invoke<string[]>("remember_send_memory", { request });
}

export async function clearSendMemory(): Promise<void> {
  return invoke("clear_send_memory");
}

export async function listCommandLabels(): Promise<CommandLabel[]> {
  return invoke<CommandLabel[]>("list_command_labels");
}

export async function saveCommandLabel(request: CommandLabelRequest): Promise<CommandLabel[]> {
  return invoke<CommandLabel[]>("save_command_label", { request });
}

export async function deleteCommandLabel(id: number): Promise<CommandLabel[]> {
  return invoke<CommandLabel[]>("delete_command_label", { id });
}

export interface AppPaths {
  packDir: string;
  firmwareDir: string;
}

export async function getAppPaths(): Promise<AppPaths> {
  return invoke("get_app_paths");
}

export async function setFirmwareDir(dir: string): Promise<string> {
  return invoke("set_firmware_dir", { dir });
}

export async function getAppLanguage(): Promise<"zh" | "en"> {
  return invoke<"zh" | "en">("get_app_language");
}

export async function setAppLanguage(request: AppLanguageRequest): Promise<"zh" | "en"> {
  return invoke<"zh" | "en">("set_app_language", { request });
}

export async function openExternalUrl(url: string): Promise<void> {
  return openUrl(url);
}

// ── 烧录器模块（flasher） ──────────────────────────────

export interface FlashProbeInfo {
  id: string;
  vendor: string;
  product: string;
  uniqueId: string;
  protocols: string[];
}

export interface FlashDependencyStatus {
  installed: boolean;
  version?: string;
  error?: string;
}

export interface FlashBackendStatus {
  mode: string;
  python: string;
  ready: boolean;
  pyocd: FlashDependencyStatus | null;
  pyserial: FlashDependencyStatus | null;
  backendVersion: string;
  mirrors: string[];
}

export interface FlashEventPayload {
  event: string;
  data: unknown;
}

export async function flashBackendStatus(): Promise<FlashBackendStatus> {
  return invoke<FlashBackendStatus>("flash_backend_status");
}

export async function flashListProbes(options?: { force?: boolean }): Promise<FlashProbeInfo[]> {
  return invoke<FlashProbeInfo[]>("flash_list_probes", { force: options?.force ?? false });
}

export async function flashBootstrap(mirror: string): Promise<void> {
  return invoke("flash_bootstrap", { mirror });
}

export async function flashBackendRestart(): Promise<void> {
  return invoke("flash_backend_restart");
}

export interface FlashTargetInfo {
  name: string;
  target: string;
  family: string;
  flashKb: number;
  ramKb: number;
  builtin: boolean;
}

export interface FlashPackInfo {
  name: string;
  version: string;
  deviceCount: number;
}

export interface FlashProgramOptions {
  probeId: string;
  target: string;
  filePath: string;
  eraseMode: "auto" | "chip";
  verify: boolean;
  pack?: string | null;
  address?: number | null;
}

export interface SnOptions {
  probeId: string;
  target: string;
  address: number;
  format: string;
  endian?: string;
  checksum?: string;
  length?: number | null;
  value?: string;
  pack?: string | null;
}

export interface IspProgramOptions {
  port: string;
  baudRate: number;
  filePath: string;
  address: number;
  verify: boolean;
}

export interface ProductionStartOptions {
  target: string;
  firmwarePath: string;
  eraseMode?: string;
  verify?: boolean;
  pack?: string | null;
  snEnabled?: boolean;
  snAddress?: number;
  snFormat?: string;
  snLength?: number | null;
  snChecksum?: string;
  snEndian?: string;
  snStart?: number;
  snStep?: number;
  snPrefix?: string;
}

export interface FlashChipInfo {
  flashSize?: number | null;
  chipId?: string | null;
  coreId?: string | null;
  uid: string[];
  target?: string;
  /** 按芯片 ID 自动识别的 target（连接后未选器件时自动填充） */
  suggestedTarget?: string | null;
}

export interface FlashProgressEvent {
  phase: string;
  pct: number;
}

export interface ProductionRecord {
  id: string;
  probeId: string;
  product: string;
  uid: string;
  sn: string;
  ok: boolean;
  message: string;
  durationMs: number;
}

export interface ProductionStats {
  total: number;
  ok: number;
  fail: number;
}

export async function flashListTargets(): Promise<FlashTargetInfo[]> {
  return invoke<FlashTargetInfo[]>("flash_list_targets");
}

export async function flashListPacks(): Promise<FlashPackInfo[]> {
  return invoke<FlashPackInfo[]>("flash_list_packs");
}

export async function flashImportPack(packPath: string): Promise<unknown> {
  return invoke("flash_import_pack", { packPath });
}

export interface PackSearchResult {
  device: string;
  pack: string;
  version: string;
  flashKb: number | null;
  /** Pack 清单模式下该 Pack 覆盖的器件数（器件搜索时为 1 或省略） */
  deviceCount?: number | null;
  /** 内置器件（如 51 系列，非在线 Pack，不可下载） */
  builtin?: boolean;
}

export interface PackCategory {
  key: string;
  /** 内置分类（如 51 系列，无在线 Pack 可下载） */
  builtin?: boolean;
  packs: PackSearchResult[];
}

export interface DeviceInfo {
  name: string;
  vendor: string;
  family: string;
  flashKb: number | null;
  ramKb: number | null;
  pack: string;
  version: string;
  builtin: boolean;
}

export interface DeviceFamily {
  name: string;
  devices: DeviceInfo[];
}

export interface DeviceVendor {
  name: string;
  families: DeviceFamily[];
}

export async function flashSearchPacks(query: string): Promise<{ results: PackSearchResult[]; total: number; packs: string[] }> {
  return invoke("flash_search_packs", { query });
}

export async function flashListPackCategories(): Promise<{ categories: PackCategory[] }> {
  return invoke("flash_list_pack_categories");
}

export async function flashDeviceTree(): Promise<{ vendors: DeviceVendor[] }> {
  return invoke("flash_device_tree");
}

export async function flashSearchDevices(query: string): Promise<{ results: DeviceInfo[]; total: number }> {
  return invoke("flash_search_devices", { query });
}

export async function flashDownloadPack(pack: string): Promise<unknown> {
  return invoke("flash_download_pack", { pack });
}

export async function flashProgram(options: FlashProgramOptions): Promise<{ ok: boolean; verified: boolean }> {
  return invoke("flash_program", { options });
}

export async function flashErase(probeId: string, target: string, pack?: string | null): Promise<unknown> {
  return invoke("flash_erase", { probeId, target, pack: pack ?? null });
}

export async function flashReadChipInfo(probeId: string, target: string, pack?: string | null): Promise<FlashChipInfo> {
  return invoke("flash_read_chip_info", { probeId, target, pack: pack ?? null });
}

export async function flashReadSn(options: SnOptions): Promise<{ value: string; raw: number[]; valid: boolean }> {
  return invoke("flash_read_sn", { options });
}

export async function flashWriteSn(options: SnOptions): Promise<{ ok: boolean; value: string; valid: boolean }> {
  return invoke("flash_write_sn", { options });
}

export async function ispProgram(options: IspProgramOptions): Promise<{ ok: boolean; chipId: string; verified: boolean }> {
  return invoke("isp_program", { options });
}

export async function productionStart(options: ProductionStartOptions): Promise<unknown> {
  return invoke("production_start", { options });
}

export async function productionStop(): Promise<unknown> {
  return invoke("production_stop");
}

export async function productionStats(): Promise<{ stats: ProductionStats; running: boolean }> {
  return invoke("production_stats");
}

export async function productionRecords(): Promise<{ records: ProductionRecord[] }> {
  return invoke("production_records");
}

/** 选择固件 / Pack 文件（打开系统文件对话框，可指定默认目录）。 */
export async function pickFile(
  filters?: { name: string; extensions: string[] }[],
  defaultPath?: string,
): Promise<string | null> {
  const selected = await open({ multiple: false, filters, defaultPath });
  if (typeof selected === "string") {
    return selected;
  }
  return null;
}
