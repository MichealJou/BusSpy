import type { SerialLog } from "./types";

export function bytesToHex(bytes: number[]) {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

export function textByteLength(text: string, appendNewline: boolean) {
  return new TextEncoder().encode(text + (appendNewline ? "\r\n" : "")).length;
}

export function hexByteLength(text: string) {
  return text.replace(/\s/g, "").length / 2;
}

export function analyzeSendPayload(text: string, hexMode: boolean, appendNewline: boolean) {
  const normalizedHex = text.replace(/\s/g, "");
  const textBytes = textByteLength(text, appendNewline);
  return {
    chars: Array.from(text).length,
    bytes: hexMode ? Math.floor(normalizedHex.length / 2) : textBytes,
    hexBytes: Math.floor(normalizedHex.length / 2),
    isValidHex: !hexMode || normalizedHex.length % 2 === 0,
  };
}

export function formatPayload(log: SerialLog, hexMode: boolean) {
  if (log.direction === "system" || log.direction === "error") {
    return log.text;
  }
  return hexMode ? log.hex ?? log.text : log.text;
}

export function nowStamp() {
  const now = new Date();
  return now.toLocaleTimeString("zh-CN", { hour12: false }) + `.${String(now.getMilliseconds()).padStart(3, "0")}`;
}
