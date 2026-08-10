import type {
  FlashBackendStatus,
  FlashDependencyStatus,
  FlashProbeInfo,
} from "../../../tauri";

export interface FlasherState {
  /** 后端环境自检结果 */
  status: FlashBackendStatus | null;
  /** 枚举到的烧录器列表 */
  probes: FlashProbeInfo[];
  /** 环境自检进行中 */
  checking: boolean;
  /** 探针刷新中 */
  refreshing: boolean;
  /** 环境初始化进行中 */
  bootstrapping: boolean;
  /** 环境初始化日志（滚动追加） */
  bootstrapLogs: string[];
  /** 初始化是否成功（最后一条 done 事件） */
  bootstrapSuccess: boolean | null;
  /** 最近一次错误信息 */
  error: string | null;
}

export interface FlasherActions {
  /** 环境自检：后端可用性 + pyocd/pyserial 状态 */
  checkEnvironment: () => Promise<void>;
  /** 刷新烧录器列表 */
  refreshProbes: () => Promise<void>;
  /** 自动初始化环境（选择镜像） */
  bootstrap: (mirror: string) => Promise<void>;
  /** 清理错误信息 */
  clearError: () => void;
}

export type FlasherStore = FlasherState & FlasherActions;

/** pyocd 依赖是否就绪（供 UI 判断是否可烧录） */
export function isDependencyReady(dep: FlashDependencyStatus | null): boolean {
  return Boolean(dep?.installed);
}
