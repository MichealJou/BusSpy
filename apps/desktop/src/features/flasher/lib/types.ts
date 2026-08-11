import type {
  FlashBackendStatus,
  FlashChipInfo,
  FlashDependencyStatus,
  FlashPackInfo,
  FlashProbeInfo,
  FlashTargetInfo,
  ProductionRecord,
  ProductionStats,
} from "../../../tauri";

export type ConnectionMode = "swd" | "isp";

/** 调试器类型筛选：自动识别全部，或按类型过滤 */
export type ProbeType = "auto" | "cmsis-dap" | "stlink" | "jlink";

export type SnFormat = "ascii" | "bcd" | "uint32" | "uint64";
export type SnChecksum = "none" | "crc16" | "crc32";

export interface FlashRunState {
  running: boolean;
  phase: string;
  pct: number;
  success: boolean | null;
  message: string;
  startedAt: number;
}

export interface SnConfig {
  address: number;
  format: SnFormat;
  endian: "little" | "big";
  checksum: SnChecksum;
  length: number | null;
}

export interface ProductionConfig {
  snEnabled: boolean;
  snAddress: number;
  snFormat: SnFormat;
  snLength: number | null;
  snChecksum: SnChecksum;
  snEndian: "little" | "big";
  snStart: number;
  snStep: number;
  snPrefix: string;
}

export interface FlasherState {
  /** 后端环境自检结果 */
  status: FlashBackendStatus | null;
  /** 枚举到的烧录器列表 */
  probes: FlashProbeInfo[];
  /** 内置器件库 */
  targets: FlashTargetInfo[];
  /** 已安装 Pack */
  packs: FlashPackInfo[];
  /** 已选器件（device target 名） */
  selectedTarget: string | null;
  /** 已选固件文件路径 */
  firmwarePath: string | null;
  /** 连接方式：SWD 烧录器 / 串口 ISP */
  connectionMode: ConnectionMode;
  /** 调试器类型筛选 */
  probeType: ProbeType;
  /** 按 probeType 过滤后的探针列表 */
  visibleProbes: FlashProbeInfo[];
  /** 串口列表（ISP 用） */
  serialPorts: string[];
  /** 已选串口（ISP 用） */
  selectedPort: string | null;
  /** 串口 ISP 波特率 */
  baudRate: number;
  /** 烧录地址（自动/手动） */
  flashAddress: number | null;
  /** 整片擦除开关 */
  chipErase: boolean;
  /** 烧后校验开关 */
  verifyAfterFlash: boolean;
  /** 烧录运行状态（进度） */
  run: FlashRunState;
  /** 烧录日志 */
  flashLogs: string[];
  /** 芯片信息 */
  chipInfo: FlashChipInfo | null;
  /** 环境自检/探针/器件库加载状态 */
  loading: boolean;
  /** 首次进入烧录页的初始化状态（含后端进程启动） */
  initializing: boolean;
  checking: boolean;
  refreshing: boolean;
  bootstrapping: boolean;
  bootstrapLogs: string[];
  bootstrapSuccess: boolean | null;
  /** SN 配置 */
  snConfig: SnConfig;
  /** 读取到的当前 SN */
  currentSn: string | null;
  snValid: boolean | null;
  /** 量产模式 */
  productionRunning: boolean;
  productionStats: ProductionStats;
  productionRecords: ProductionRecord[];
  /** 量产 SN 规则配置 */
  productionConfig: ProductionConfig;
  /** 最近错误 */
  error: string | null;
}

export interface FlasherActions {
  checkEnvironment: () => Promise<void>;
  refreshProbes: () => Promise<void>;
  loadTargets: () => Promise<void>;
  loadPacks: () => Promise<void>;
  refreshSerialPorts: () => Promise<void>;
  bootstrap: (mirror: string) => Promise<void>;
  setSelectedTarget: (target: string | null) => void;
  setFirmwarePath: (path: string | null) => void;
  setConnectionMode: (mode: ConnectionMode) => void;
  setProbeType: (type: ProbeType) => void;
  setSelectedPort: (port: string | null) => void;
  setBaudRate: (rate: number) => void;
  setFlashAddress: (address: number | null) => void;
  setChipErase: (value: boolean) => void;
  setVerifyAfterFlash: (value: boolean) => void;
  setSnConfig: (patch: Partial<SnConfig>) => void;
  importPack: (packPath: string) => Promise<void>;
  /** 烧录（SWD 或串口 ISP） */
  flash: () => Promise<void>;
  /** 整片擦除 */
  erase: () => Promise<void>;
  /** 读取芯片信息 */
  readChipInfo: () => Promise<void>;
  /** 读 SN */
  readSn: () => Promise<void>;
  /** 写/改 SN */
  writeSn: (value: string) => Promise<boolean>;
  /** 量产控制 */
  productionStart: () => Promise<void>;
  productionStop: () => Promise<void>;
  refreshProductionRecords: () => Promise<void>;
  setProductionConfig: (patch: Partial<ProductionConfig>) => void;
  clearError: () => void;
  clearFlashLogs: () => void;
  pushFlashLog: (message: string) => void;
}

export type FlasherStore = FlasherState & FlasherActions;

/** pyocd 依赖是否就绪（供 UI 判断是否可烧录） */
export function isDependencyReady(dep: FlashDependencyStatus | null): boolean {
  return Boolean(dep?.installed);
}

export const DEFAULT_SN_CONFIG: SnConfig = {
  address: 0x0800f000,
  format: "ascii",
  endian: "little",
  checksum: "none",
  length: 32,
};

export const DEFAULT_PRODUCTION_CONFIG: ProductionConfig = {
  snEnabled: false,
  snAddress: 0x0800f000,
  snFormat: "ascii",
  snLength: 32,
  snChecksum: "none",
  snEndian: "little",
  snStart: 1,
  snStep: 1,
  snPrefix: "",
};
