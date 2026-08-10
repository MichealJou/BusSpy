import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  flashBackendRestart,
  flashBackendStatus,
  flashBootstrap,
  flashListProbes,
  type FlashBackendStatus,
  type FlashEventPayload,
} from "../../../tauri";
import type { FlasherStore } from "../lib/types";

export function useFlasher(): FlasherStore {
  const [status, setStatus] = useState<FlashBackendStatus | null>(null);
  const [probes, setProbes] = useState<FlasherStore["probes"]>([]);
  const [checking, setChecking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapLogs, setBootstrapLogs] = useState<string[]>([]);
  const [bootstrapSuccess, setBootstrapSuccess] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 事件监听用 ref 保持最新状态，避免闭包过期
  const statusRef = useRef<FlasherStore["status"]>(null);
  statusRef.current = status;

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
      setProbes(await flashListProbes());
    } catch (err) {
      setError(String(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

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

  // 挂载时先做环境自检，后端就绪后自动刷新探针
  useEffect(() => {
    void checkEnvironment().then(() => {
      if (statusRef.current?.ready) {
        void refreshProbes();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 订阅后端异步事件（进度 / 退出）与初始化日志
  useEffect(() => {
    let unlistenEvent: UnlistenFn | undefined;
    let unlistenLog: UnlistenFn | undefined;
    let unlistenDone: UnlistenFn | undefined;

    listen<FlashEventPayload>("flash-event", (event) => {
      const payload = event.payload;
      if (payload.event === "backend.exit") {
        setStatus((prev) => (prev ? { ...prev, ready: false } : prev));
      }
      if (payload.event === "flash.progress") {
        // S2 烧录进度在此驱动
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
        // 初始化完成：重启后端（切换 venv 解释器）并重新自检
        void flashBackendRestart()
          .then(checkEnvironment)
          .catch((err) => setError(String(err)));
      }
    }).then((fn) => {
      unlistenDone = fn;
    });

    return () => {
      unlistenEvent?.();
      unlistenLog?.();
      unlistenDone?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    probes,
    checking,
    refreshing,
    bootstrapping,
    bootstrapLogs,
    bootstrapSuccess,
    error,
    checkEnvironment,
    refreshProbes,
    bootstrap,
    clearError,
  };
}
