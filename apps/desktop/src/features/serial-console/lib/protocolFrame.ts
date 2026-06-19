export type FrameFieldKind = "address" | "function" | "start" | "quantity" | "data" | "crc" | "unknown";

export interface FrameByteMark {
  index: number;
  value: string;
  kind: FrameFieldKind;
  label?: string;
}

export interface CustomFrameLabel {
  id: string;
  name: string;
  start: number;
  end: number;
}

export function parseHexFrame(text: string): FrameByteMark[] {
  const compact = text.replace(/\s/g, "").toUpperCase();
  const bytes = compact.match(/.{1,2}/g) ?? [];
  return bytes.map((value, index) => ({
    index,
    value,
    kind: inferModbusLikeField(index, bytes.length),
  }));
}

export function applyCustomFrameLabels(marks: FrameByteMark[], labels: CustomFrameLabel[]) {
  return marks.map((mark) => {
    const label = labels.find((item) => mark.index >= item.start && mark.index <= item.end);
    return label ? { ...mark, label: label.name } : mark;
  });
}

function inferModbusLikeField(index: number, length: number): FrameFieldKind {
  if (index === 0) {
    return "address";
  }
  if (index === 1) {
    return "function";
  }
  if (length >= 8 && (index === 2 || index === 3)) {
    return "start";
  }
  if (length >= 8 && (index === 4 || index === 5)) {
    return "quantity";
  }
  if (length >= 4 && index >= length - 2) {
    return "crc";
  }
  if (index > 1) {
    return "data";
  }
  return "unknown";
}
