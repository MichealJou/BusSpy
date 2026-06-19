import { invoke } from "@tauri-apps/api/core";

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

export async function getAppLanguage(): Promise<"zh" | "en"> {
  return invoke<"zh" | "en">("get_app_language");
}

export async function setAppLanguage(request: AppLanguageRequest): Promise<"zh" | "en"> {
  return invoke<"zh" | "en">("set_app_language", { request });
}
