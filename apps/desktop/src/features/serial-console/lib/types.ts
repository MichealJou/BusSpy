import type { SelectProps } from "@mantine/core";
import type { RefObject } from "react";
import type { CommandLabel } from "../../../tauri";

export type LogDirection = "rx" | "tx" | "system" | "error";
export type TransportMode = "serial" | "tcp-client" | "tcp-server" | "udp";

export interface SerialLog {
  id: number;
  direction: LogDirection;
  time: string;
  text: string;
  hex?: string;
  byteLength: number;
}

export interface SendAnalysis {
  chars: number;
  bytes: number;
  hexBytes: number;
  isValidHex: boolean;
}

export interface SerialConsoleState {
  transportMode: TransportMode;
  setTransportMode: (value: TransportMode) => void;
  selectedConnection: string | null;
  setSelectedConnection: (value: string | null) => void;
  connectionOptions: NonNullable<SelectProps["data"]>;
  port: string | null;
  setPort: (value: string | null) => void;
  portOptions: NonNullable<SelectProps["data"]>;
  baudRate: string;
  setBaudRate: (value: string) => void;
  dataBit: string;
  setDataBit: (value: string) => void;
  stopBit: string;
  setStopBit: (value: string) => void;
  parity: string;
  setParity: (value: string) => void;
  rts: boolean;
  setRts: (value: boolean) => void;
  dtr: boolean;
  setDtr: (value: boolean) => void;
  remoteHost: string;
  setRemoteHost: (value: string) => void;
  remotePort: string;
  setRemotePort: (value: string) => void;
  localPort: string;
  setLocalPort: (value: string) => void;
  isConnected: boolean;
  isPaused: boolean;
  setIsPaused: (value: boolean | ((current: boolean) => boolean)) => void;
  isBusy: boolean;
  sendText: string;
  setSendText: (value: string) => void;
  receiveHexMode: boolean;
  setReceiveHexMode: (value: boolean) => void;
  showTimestamp: boolean;
  setShowTimestamp: (value: boolean) => void;
  packetMode: boolean;
  setPacketMode: (value: boolean) => void;
  packetTimeoutMs: string;
  setPacketTimeoutMs: (value: string) => void;
  saveReceiveToFile: boolean;
  setSaveReceiveToFile: (value: boolean) => void;
  sendHexMode: boolean;
  setSendHexMode: (value: boolean) => void;
  checksumType: string;
  setChecksumType: (value: string) => void;
  checksumStart: string;
  setChecksumStart: (value: string) => void;
  checksumEnd: string;
  setChecksumEnd: (value: string) => void;
  appendNewline: boolean;
  setAppendNewline: (value: boolean) => void;
  timedSend: boolean;
  setTimedSend: (value: boolean) => void;
  intervalMs: string;
  setIntervalMs: (value: string) => void;
  autoScroll: boolean;
  setAutoScroll: (value: boolean) => void;
  logs: SerialLog[];
  history: string[];
  commandLabels: CommandLabel[];
  saveCurrentCommandLabel: (name: string) => Promise<void>;
  deleteCommandLabelById: (id: number) => Promise<void>;
  rxBytes: number;
  txBytes: number;
  lastError: string | null;
  terminalHeight: number;
  terminalRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  txPreviewBytes: number;
  sendAnalysis: SendAnalysis;
  connectOrClose: () => Promise<void>;
  refreshPorts: () => Promise<void>;
  sendCurrentText: (text?: string) => Promise<void>;
  runLoopbackTest: () => Promise<void>;
  rememberSendText: (text?: string) => void;
  clearSendHistory: () => void;
  clearLogs: () => void;
  copyLogs: () => Promise<void>;
  downloadLogs: () => void;
  exportData: () => void;
  startTerminalResize: (event: React.PointerEvent<HTMLDivElement>) => void;
}
