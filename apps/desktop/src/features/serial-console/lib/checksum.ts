export function appendChecksumToHexFrame(text: string, type: string, startText: string, endText: string) {
  if (type === "none") {
    return text;
  }

  const bytes = parseHexBytes(text);
  if (bytes.length === 0) {
    return text;
  }

  const start = Math.max(0, Number(startText) - 1 || 0);
  const end = normalizeEnd(endText, bytes.length);
  const range = bytes.slice(start, end + 1);
  const checksum = calculateChecksum(range, type);
  if (checksum.length === 0) {
    return text;
  }

  return [...bytes, ...checksum].map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

function normalizeEnd(value: string, length: number) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === "end" || trimmed === "末尾") {
    return length - 1;
  }
  return Math.min(length - 1, Math.max(0, Number(trimmed) - 1 || length - 1));
}

function parseHexBytes(text: string) {
  const compact = text.replace(/\s/g, "");
  if (compact.length % 2 !== 0) {
    return [];
  }
  const bytes: number[] = [];
  for (let index = 0; index < compact.length; index += 2) {
    const byte = Number.parseInt(compact.slice(index, index + 2), 16);
    if (Number.isNaN(byte)) {
      return [];
    }
    bytes.push(byte);
  }
  return bytes;
}

function calculateChecksum(bytes: number[], type: string) {
  switch (type) {
    case "sum":
      return [bytes.reduce((sum, byte) => (sum + byte) & 0xff, 0)];
    case "xor":
      return [bytes.reduce((value, byte) => value ^ byte, 0)];
    case "crc8":
      return [crc8(bytes)];
    case "crc16":
      return wordBigEndian(crc16Ccitt(bytes));
    case "modbus-crc16":
      return wordLittleEndian(crc16Modbus(bytes));
    default:
      return [];
  }
}

function crc8(bytes: number[]) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

function crc16Ccitt(bytes: number[]) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function crc16Modbus(bytes: number[]) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x0001 ? (crc >> 1) ^ 0xa001 : crc >> 1;
    }
  }
  return crc & 0xffff;
}

function wordBigEndian(value: number) {
  return [(value >> 8) & 0xff, value & 0xff];
}

function wordLittleEndian(value: number) {
  return [value & 0xff, (value >> 8) & 0xff];
}
