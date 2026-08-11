import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  flashBackendRestart,
  flashBackendStatus,
  flashBootstrap,
  flashErase,
  flashImportPack,
  flashListPacks,
  flashListProbes,
  flashListTargets,
  flashProgram,
  flashReadChipInfo,
  flashReadSn,
  flashWriteSn,
  ispProgram,
  listSerialPorts,
  productionRecords as productionRecordsRpc,
  productionStart as productionStartRpc,
  productionStats as productionStatsRpc,
  productionStop as productionStopRpc,
  type FlashBackendStatus,
  type FlashEventPayload,
  type FlashProbeInfo,
  type FlashProgressEvent,
  type ProductionRecord,
  type ProductionStats,
} from "../../../tauri";
import {
  DEFAULT_PRODUCTION_CONFIG,
  DEFAULT_SN_CONFIG,
  type FlasherStore,
  type ProbeType,
  type ProductionConfig,
} from "../lib/types";

/** 按探针信息判断调试器类型（供 probeType 筛选） */
function classifyProbe(probe: FlashProbeInfo): ProbeType {
  const s = `${probe.vendor} ${probe.product}`.toLowerCase();
  if (s.includes("st-link") || s.includes("stlink")) return "stlink";
  if (s.includes("j-link") || s.includes("jlink") || s.includes("segger")) return "jlink";
  return "cmsis-dap";
}

function emptyRun(): FlasherStore["run"] {
  return { running: false, phase: "", pct: 0, success: null, message: "", startedAt: 0 };
}

export function useFlasher(): FlasherStore {
  const [status, setStatus] = useState<FlashBackendStatus | null>(null);
  const [probes, setProbes] = useState<FlasherStore["probes"]>([]);
  const [targets, setTargets] = useState<FlasherStore["targets"]>([]);
  const [packs, setPacks] = useState<FlasherStore["packs"]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [firmwarePath, setFirmwarePath] = useState<string | null>(null);
  const [connectionMode, setConnectionModeState] = useState<FlasherStore["connectionMode"]>("swd");
  const [probeType, setProbeTypeState] = useState<ProbeType>("auto");
  const [serialPorts, setSerialPorts] = useState<string[]>([]);
  const [selectedPort, setSelectedPortState] = useState<string | null>(null);
  const [baudRate, setBaudRate] = useState(115200);
  const [flashAddress, setFlashAddress] = useState<number | null>(null);
  const [chipErase, setChipErase] = useState(false);
  const [verifyAfterFlash, setVerifyAfterFlash] = useState(true);
  const [run, setRun] = useState(emptyRun);
  const [flashLogs, setFlashLogs] = useState<string[]>([]);
  const [chipInfo, setChipInfo] = useState<FlasherStore["chipInfo"]>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [checking, setChecking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapLogs, setBootstrapLogs] = useState<string[]>([]);
  const [bootstrapSuccess, setBootstrapSuccess] = useState<boolean | null>(null);
  const [snConfig, setSnConfigState] = useState(DEFAULT_SN_CONFIG);
  const [currentSn, setCurrentSn] = useState<string | null>(null);
  const [snValid, setSnValid] = useState<boolean | null>(null);
  const [productionConfig, setProductionConfigState] = useState<ProductionConfig>(DEFAULT_PRODUCTION_CONFIG);
  const [productionRunning, setProductionRunning] = useState(false);
  const [productionStats, setProductionStats] = useState<ProductionStats>({ total: 0, ok: 0, fail: 0 });
  const [productionRecords, setProductionRecords] = useState<ProductionRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const statusRef = useRef<FlasherStore["status"]>(null);
  statusRef.current = status;

  // 后端进程崩溃后的自动恢复函数（每次渲染刷新引用，事件监听调用最新版本）
  const recoveryRef = useRef<() => void>(() => undefined);
  recoveryRef.current = () => {
    if (statusRef.current?.ready) {
      return;
    }
    void checkEnvironment()
      .then(() => {
        if (statusRef.current?.ready) {
          return Promise.all([refreshProbes(), loadTargets(), loadPacks(), refreshSerialPorts()]).then(() => undefined);
        }
        return Promise.resolve();
      })
      .catch(() => undefined);
  };
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedTarget;
  const modeRef = useRef<FlasherStore["connectionMode"]>("swd");
  modeRef.current = connectionMode;
  const baudRef = useRef(baudRate);
  baudRef.current = baudRate;
  const portRef = useRef<string | null>(null);
  portRef.current = selectedPort;
  const addressRef = useRef<number | null>(null);
  addressRef.current = flashAddress;
  const chipEraseRef = useRef(false);
  chipEraseRef.current = chipErase;
  const verifyRef = useRef(true);
  verifyRef.current = verifyAfterFlash;
  const snConfigRef = useRef(DEFAULT_SN_CONFIG);
  snConfigRef.current = snConfig;

  const setSnConfig: FlasherStore["setSnConfig"] = useCallback((patch) => {
    setSnConfigState((prev) => ({ ...prev, ...patch }));
  }, []);

  const setProductionConfig: FlasherStore["setProductionConfig"] = useCallback((patch) => {
    setProductionConfigState((prev) => ({ ...prev, ...patch }));
  }, []);

  const setConnectionMode: FlasherStore["setConnectionMode"] = useCallback((mode) => {
    setConnectionModeState(mode);
  }, []);

  const setProbeType: FlasherStore["setProbeType"] = useCallback((type) => {
    setProbeTypeState(type);
  }, []);

  // 按调试器类型过滤后的探针列表
  const visibleProbes = useMemo(() => {
    if (probeType === "auto") {
      return probes;
    }
    return probes.filter((probe) => classifyProbe(probe) === probeType);
  }, [probes, probeType]);

  const setSelectedPort: FlasherStore["setSelectedPort"] = useCallback((port) => {
    setSelectedPortState(port);
  }, []);

  const checkEnvironment = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const next = await flashBackendStatus();
      setStatus(next);
      if (!next.ready) {
        setError(next.python ? "后端未就绪，请检查 Python 环境" : "未找到可用的 Python 环境");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setChecking(false);
    }
  }, []);

  const refreshProbes = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      // force=true：跳过后端 3s TTL 缓存，确保插拔探针后点刷新能拿到最新
      setProbes(await flashListProbes({ force: true }));
    } catch (err) {
      setError(String(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  // 首次探针扫描为空（后端枚举偶发失败 / 探针刚插入）时自动重试，最多 2 次
  const probeRetries = useRef(0);
  useEffect(() => {
    if (probes.length === 0 && probeRetries.current < 2) {
      probeRetries.current += 1;
      const timer = setTimeout(() => void refreshProbes(), 1500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleProbes]);

  const loadTargets = useCallback(async () => {
    setLoading(true);
    try {
      setTargets(await flashListTargets());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPacks = useCallback(async () => {
    try {
      setPacks(await flashListPacks());
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const refreshSerialPorts = useCallback(async () => {
    try {
      const ports = await listSerialPorts();
      setSerialPorts(ports.map((port) => port.name));
      // 默认选中第一个可用串口，省去手动选择
      setSelectedPortState((prev) => prev ?? ports[0]?.name ?? null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const importPack = useCallback(async (packPath: string) => {
    setLoading(true);
    try {
      await flashImportPack(packPath);
      await loadPacks();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [loadPacks]);

  const bootstrap = useCallback(async (mirror: string) => {
    setBootstrapping(true);
    setBootstrapSuccess(null);
    setBootstrapLogs([]);
    setError(null);
    try {
      await flashBootstrap(mirror);
    } catch (err) {
      setError(String(err));
      setBootstrapping(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);
  const clearFlashLogs = useCallback(() => setFlashLogs([]), []);
  const pushFlashLog = useCallback((message: string) => {
    setFlashLogs((prev) => [...prev.slice(-200), message]);
  }, []);

  // ── 烧录 ────────────────────────────────────────────────
  const flash = useCallback(async () => {
    const target = selectedRef.current;
    if (!target) {
      setError("请先选择器件");
      return;
    }
    const pack = (() => {
      // 器件不是内置 pyOCD target 时，用已安装 Pack（后端自动从索引解析，无需显式传）
      return null;
    })();
    setRun({ running: true, phase: "connecting", pct: 0, success: null, message: "", startedAt: Date.now() });
    setFlashLogs((prev) => [...prev.slice(-200), `开始烧录：${target}`]);
    setError(null);
    try {
      if (modeRef.current === "isp") {
        if (baudRef.current <= 0) {
          throw new Error("请选择串口");
        }
        const port = portRef.current ?? serialPorts[0] ?? "";
        if (!port) {
          throw new Error("请选择串口");
        }
        const result = await ispProgram({
          port,
          baudRate: baudRef.current,
          filePath: firmwarePath ?? "",
          address: addressRef.current ?? 0x08000000,
          verify: verifyRef.current,
        });
        if (result.ok) {
          setRun({ running: false, phase: "done", pct: 100, success: true, message: "烧录成功，校验通过", startedAt: 0 });
        }
        return;
      }
      const probe = visibleProbes.find((item) => item.uniqueId) ?? visibleProbes[0];
      if (!probe) {
        throw new Error("未检测到烧录器");
      }
      const result = await flashProgram({
        probeId: probe.uniqueId || probe.id,
        target,
        filePath: firmwarePath ?? "",
        eraseMode: chipEraseRef.current ? "chip" : "auto",
        verify: verifyRef.current,
        pack,
        address: addressRef.current,
      });
      setRun({
        running: false,
        phase: "done",
        pct: 100,
        success: true,
        message: result.verified ? "烧录成功，校验通过" : "烧录成功",
        startedAt: 0,
      });
    } catch (err) {
      setRun({ running: false, phase: "error", pct: 0, success: false, message: String(err), startedAt: 0 });
      setFlashLogs((prev) => [...prev, `烧录失败：${String(err)}`]);
    }
  }, [visibleProbes, firmwarePath, serialPorts]);

  const erase = useCallback(async () => {
    const target = selectedRef.current;
    const probe = visibleProbes.find((item) => item.uniqueId) ?? visibleProbes[0];
    if (!target || !probe) {
      setError("请先选择器件并连接烧录器");
      return;
    }
    setRun({ running: true, phase: "erase", pct: 0, success: null, message: "", startedAt: Date.now() });
    try {
      await flashErase(probe.uniqueId || probe.id, target);
      setRun({ running: false, phase: "done", pct: 100, success: true, message: "整片擦除完成", startedAt: 0 });
    } catch (err) {
      setRun({ running: false, phase: "error", pct: 0, success: false, message: String(err), startedAt: 0 });
    }
  }, [visibleProbes]);

  const readChipInfo = useCallback(async () => {
    const target = selectedRef.current;
    const probe = visibleProbes.find((item) => item.uniqueId) ?? visibleProbes[0];
    if (!target || !probe) {
      setError("请先选择器件并连接烧录器");
      return;
    }
    setError(null);
    try {
      setChipInfo(await flashReadChipInfo(probe.uniqueId || probe.id, target));
    } catch (err) {
      setError(`读取芯片信息失败：${String(err)}`);
    }
  }, [visibleProbes]);

  // ── SN ─────────────────────────────────────────────────
  const readSn = useCallback(async () => {
    const target = selectedRef.current;
    const probe = visibleProbes.find((item) => item.uniqueId) ?? visibleProbes[0];
    if (!target || !probe) {
      setError("请先选择器件并连接烧录器");
      return;
    }
    setError(null);
    try {
      const result = await flashReadSn({
        probeId: probe.uniqueId || probe.id,
        target,
        address: snConfigRef.current.address,
        format: snConfigRef.current.format,
        endian: snConfigRef.current.endian,
        checksum: snConfigRef.current.checksum,
        length: snConfigRef.current.length,
      });
      setCurrentSn(result.value);
      setSnValid(result.valid);
    } catch (err) {
      setError(`读取 SN 失败：${String(err)}`);
    }
  }, [visibleProbes]);

  const writeSn = useCallback(async (value: string) => {
    const target = selectedRef.current;
    const probe = visibleProbes.find((item) => item.uniqueId) ?? visibleProbes[0];
    if (!target || !probe) {
      setError("请先选择器件并连接烧录器");
      return false;
    }
    setError(null);
    try {
      const result = await flashWriteSn({
        probeId: probe.uniqueId || probe.id,
        target,
        address: snConfigRef.current.address,
        format: snConfigRef.current.format,
        endian: snConfigRef.current.endian,
        checksum: snConfigRef.current.checksum,
        length: snConfigRef.current.length,
        value,
      });
      setCurrentSn(result.value);
      setSnValid(result.valid);
      return result.ok;
    } catch (err) {
      setError(`写入 SN 失败：${String(err)}`);
      return false;
    }
  }, [visibleProbes]);

  // ── 量产 ────────────────────────────────────────────────
  const productionStart = useCallback(async () => {
    const target = selectedRef.current;
    if (!target || !firmwarePath) {
      setError("量产前请先选择器件和固件");
      return;
    }
    setError(null);
    try {
      await productionStartRpc({
        target,
        firmwarePath,
        eraseMode: chipEraseRef.current ? "chip" : "auto",
        verify: verifyRef.current,
        snEnabled: productionConfig.snEnabled,
        snAddress: productionConfig.snAddress,
        snFormat: productionConfig.snFormat,
        snLength: productionConfig.snLength,
        snChecksum: productionConfig.snChecksum,
        snEndian: productionConfig.snEndian,
        snStart: productionConfig.snStart,
        snStep: productionConfig.snStep,
        snPrefix: productionConfig.snPrefix,
      });
      setProductionRunning(true);
      await productionStatsRpc().then((value) => setProductionStats(value.stats));
    } catch (err) {
      setError(`启动量产失败：${String(err)}`);
    }
  }, [selectedTarget, firmwarePath, productionConfig]);

  const productionStop = useCallback(async () => {
    try {
      await productionStopRpc();
      setProductionRunning(false);
      await productionStatsRpc().then((value) => setProductionStats(value.stats));
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const refreshProductionRecords = useCallback(async () => {
    try {
      const result = await productionRecordsRpc();
      setProductionRecords(result.records);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  // ── 初始化：环境自检 + 器件库 ──────────────────────────
  // 页面始终先渲染；环境自检完成后各数据源并行独立加载（互不等待，任一失败不影响其余），
  // 后端进程在 blocking 线程池异步跑，不会冻结 UI。
  useEffect(() => {
    let cancelled = false;
    void checkEnvironment()
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) {
          return;
        }
        setInitializing(false);
        if (statusRef.current?.ready) {
          void Promise.allSettled([refreshProbes(), loadTargets(), loadPacks(), refreshSerialPorts()]);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 订阅后端事件 ────────────────────────────────────────
  useEffect(() => {
    let unlistenEvent: UnlistenFn | undefined;
    let unlistenLog: UnlistenFn | undefined;
    let unlistenDone: UnlistenFn | undefined;
    let unlistenProdRecord: UnlistenFn | undefined;
    let unlistenProdStats: UnlistenFn | undefined;

    listen<FlashEventPayload>("flash-event", (event) => {
      const payload = event.payload;
      if (payload.event === "backend.exit") {
        setStatus((prev) => (prev ? { ...prev, ready: false } : prev));
        // 后端进程崩溃（如探针 HID 兼容问题）后延迟自动重启并重新加载
        setTimeout(() => recoveryRef.current(), 800);
      }
      if (payload.event === "flash.progress") {
        const data = payload.data as FlashProgressEvent;
        setRun((prev) => ({ ...prev, phase: data.phase, pct: data.pct }));
      }
      if (payload.event === "flash.log") {
        const message = (payload.data as { message?: string }).message ?? "";
        setFlashLogs((prev) => [...prev.slice(-200), message]);
      }
    }).then((fn) => {
      unlistenEvent = fn;
    });

    listen<string>("flash-bootstrap-log", (event) => {
      setBootstrapLogs((prev) => [...prev.slice(-200), event.payload]);
    }).then((fn) => {
      unlistenLog = fn;
    });

    listen<{ success: boolean; message: string }>("flash-bootstrap-done", (event) => {
      const { success, message } = event.payload;
      setBootstrapLogs((prev) => [...prev, message]);
      setBootstrapSuccess(success);
      setBootstrapping(false);
      if (success) {
        void flashBackendRestart()
          .then(checkEnvironment)
          .catch((err) => setError(String(err)));
      }
    }).then((fn) => {
      unlistenDone = fn;
    });

    listen<ProductionRecord>("production.record", (event) => {
      setProductionRecords((prev) => [event.payload, ...prev].slice(0, 500));
    }).then((fn) => {
      unlistenProdRecord = fn;
    });

    listen<{ stats: ProductionStats }>("production.stats", (event) => {
      setProductionStats(event.payload.stats);
    }).then((fn) => {
      unlistenProdStats = fn;
    });

    return () => {
      unlistenEvent?.();
      unlistenLog?.();
      unlistenDone?.();
      unlistenProdRecord?.();
      unlistenProdStats?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    probes,
    probeType,
    setProbeType,
    visibleProbes,
    targets,
    packs,
    selectedTarget,
    firmwarePath,
    connectionMode,
    serialPorts,
    selectedPort,
    baudRate,
    flashAddress,
    chipErase,
    verifyAfterFlash,
    run,
    flashLogs,
    chipInfo,
    loading,
    initializing,
    checking,
    refreshing,
    bootstrapping,
    bootstrapLogs,
    bootstrapSuccess,
    snConfig,
    currentSn,
    snValid,
    productionRunning,
    productionStats,
    productionRecords,
    productionConfig,
    error,
    checkEnvironment,
    refreshProbes,
    loadTargets,
    loadPacks,
    refreshSerialPorts,
    bootstrap,
    setSelectedTarget,
    setFirmwarePath,
    setConnectionMode,
    setSelectedPort,
    setBaudRate,
    setFlashAddress,
    setChipErase,
    setVerifyAfterFlash,
    setSnConfig,
    importPack,
    flash,
    erase,
    readChipInfo,
    readSn,
    writeSn,
    productionStart,
    productionStop,
    refreshProductionRecords,
    setProductionConfig,
    clearError,
    clearFlashLogs,
    pushFlashLog,
  };
}
