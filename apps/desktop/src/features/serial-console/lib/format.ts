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

// 给 rx/tx 数据开头加笑脸标记,方便看清每条数据的开始。
// 只放开头:设备返回的数据里常带 \r\n,放结尾会被挤到下一行;开头标记足够分辨边界。
// system/error 是提示文字,不加标记。
// 单行显示:设备数据里的 CR/LF/Tab 等控制字符一律替换成空格,保证每条记录只占一行,
// 超宽由终端区横向滚动;复制(copySingleLog)仍走 formatPayload 拿原始数据。
export function formatFramedPayload(log: SerialLog, hexMode: boolean) {
  const payload = formatPayload(log, hexMode);
  const isData = log.direction === "rx" || log.direction === "tx";
  if (!isData) {
    return payload;
  }
  return `:-) ${payload.replace(/[\r\n\t]+/g, " ").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")}`;
}

export function nowStamp() {
  const now = new Date();
  return now.toLocaleTimeString("zh-CN", { hour12: false }) + `.${String(now.getMilliseconds()).padStart(3, "0")}`;
}
