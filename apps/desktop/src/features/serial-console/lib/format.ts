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

// 给 rx/tx 数据加首尾笑脸定界符,方便看清每条数据的开始和结束。
// system/error 是提示文字,不加包围。
export function formatFramedPayload(log: SerialLog, hexMode: boolean) {
  const payload = formatPayload(log, hexMode);
  const isData = log.direction === "rx" || log.direction === "tx";
  return isData ? `:-) ${payload} (-:` : payload;
}

export function nowStamp() {
  const now = new Date();
  return now.toLocaleTimeString("zh-CN", { hour12: false }) + `.${String(now.getMilliseconds()).padStart(3, "0")}`;
}
