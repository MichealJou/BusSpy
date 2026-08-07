import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  closeSerialPort,
  closeNetworkTransport,
  deleteCommandLabel,
  emitLoopbackData,
  listCommandLabels,
  listSerialPorts,
  openNetworkTransport,
  openSerialPort,
  saveCommandLabel,
  writeNetworkData,
  writeSerialData,
  type SerialDataEvent,
  type SerialPortInfo,
} from "../../../tauri";
import { analyzeSendPayload, bytesToHex, formatPayload, hexByteLength, nowStamp, textByteLength } from "../lib/format";
import { appendChecksumToHexFrame } from "../lib/checksum";
import { clearSavedSendHistory, loadSendHistory, rememberSendHistoryItem, saveSendHistoryItem } from "../lib/sendMemory";
import type { SerialConsoleState, SerialLog, TransportMode } from "../lib/types";
import type { TranslationKey } from "../../../i18n";

function formatPortLabel(port: SerialPortInfo) {
  // 只去掉路径前缀:/dev/cu.usbserial-310 → cu.usbserial-310;Windows COM3 原样。
  // cu./tty. 前缀必须保留,否则分不清是哪个串口。
  return port.name.split("/").pop() ?? port.name;
}

function portListSignature(ports: SerialPortInfo[]) {
  return ports.map((item) => `${item.name}:${item.portType}`).sort().join("|");
}

export function useSerialConsole(t: (key: TranslationKey) => string): SerialConsoleState {
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [transportMode, setTransportMode] = useState<TransportMode>("serial");
  const [port, setPort] = useState<string | null>(null);
  const [baudRate, setBaudRate] = useState("115200");
  const [dataBit, setDataBit] = useState("8");
  const [stopBit, setStopBit] = useState("1");
  const [parity, setParity] = useState("None");
  const [rts, setRts] = useState(false);
  const [dtr, setDtr] = useState(false);
  const [remoteHost, setRemoteHost] = useState("127.0.0.1");
  const [remotePort, setRemotePort] = useState("502");
  const [localPort, setLocalPort] = useState("6000");
  const [isConnected, setIsConnected] = useState(false);
  const [reconnectPending, setReconnectPending] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [sendText, setSendText] = useState("");
  const [receiveHexMode, setReceiveHexMode] = useState(true);
  const [showTimestamp, setShowTimestamp] = useState(true);
  const [packetMode, setPacketMode] = useState(true);
  const [packetTimeoutMs, setPacketTimeoutMs] = useState("20");
  const [saveReceiveToFile, setSaveReceiveToFile] = useState(false);
  const [sendHexMode, setSendHexMode] = useState(true);
  const [checksumType, setChecksumType] = useState("none");
  const [checksumStart, setChecksumStart] = useState("1");
  const [checksumEnd, setChecksumEnd] = useState("end");
  const [appendNewline, setAppendNewline] = useState(true);
  const [timedSend, setTimedSend] = useState(false);
  const [intervalMs, setIntervalMs] = useState("1000");
  const [autoScroll, setAutoScroll] = useState(true);
  const [logs, setLogs] = useState<SerialLog[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [commandLabels, setCommandLabels] = useState<import("../../../tauri").CommandLabel[]>([]);
  const [rxBytes, setRxBytes] = useState(0);
  const [txBytes, setTxBytes] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [terminalHeight, setTerminalHeight] = useState(260);
  const logIdRef = useRef(0);
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const isPausedRef = useRef(false);
  const receiveBufferRef = useRef<{ bytes: number[]; firstAt: number } | null>(null);
  const receiveTimerRef = useRef<number | null>(null);
  const packetModeRef = useRef(packetMode);
  const packetTimeoutRef = useRef(packetTimeoutMs);
  const textDecoderRef = useRef(new TextDecoder());
  const reconnectingRef = useRef(false);
  const isConnectedRef = useRef(isConnected);
  const reconnectPendingRef = useRef(reconnectPending);
  const tRef = useRef(t);
  const transportModeRef = useRef(transportMode);
  const portRef = useRef(port);

  const portOptions = useMemo(
    () => ports.map((item) => ({ value: item.name, label: formatPortLabel(item) })),
    [ports],
  );
  const connectionOptions = useMemo(() => {
    const base: { value: string; label: string }[] = [
      { value: "tcp-client", label: "TCPClient" },
      { value: "tcp-server", label: "TCPServer" },
      { value: "udp", label: "UDP" },
      ...ports.map((item) => ({ value: `serial:${item.name}`, label: formatPortLabel(item) })),
    ];
    // 选中端口被拔(不在列表里),补一个占位项,避免 Select 显示空白
    if (port && !ports.some((item) => item.name === port)) {
      base.unshift({
        value: `serial:${port}`,
        label: `${formatPortLabel({ name: port, portType: "" })} (${t("disconnected")})`,
      });
    }
    return base;
  }, [ports, port, t]);
  const selectedConnection = transportMode === "serial" ? (port ? `serial:${port}` : null) : transportMode;

  const sendAnalysis = useMemo(() => analyzeSendPayload(sendText, sendHexMode, appendNewline), [sendText, sendHexMode, appendNewline]);

  function appendLog(log: Omit<SerialLog, "id" | "time">) {
    setLogs((current) => [
      ...current.slice(-999),
      {
        ...log,
        id: logIdRef.current++,
        time: nowStamp(),
      },
    ]);
  }

  function flushReceiveBuffer() {
    if (receiveTimerRef.current !== null) {
      window.clearTimeout(receiveTimerRef.current);
      receiveTimerRef.current = null;
    }
    const buffered = receiveBufferRef.current;
    receiveBufferRef.current = null;
    if (!buffered || buffered.bytes.length === 0) {
      return;
    }
    const bytes = buffered.bytes;
    appendLog({
      direction: "rx",
      text: textDecoderRef.current.decode(new Uint8Array(bytes)),
      hex: bytesToHex(bytes),
      byteLength: bytes.length,
    });
  }

  function scheduleReceiveFlush(timeoutMs: number) {
    // 仅在缓冲区首次收到数据时启动 flush 定时器。
    // 后续到达的字节会追加进同一个缓冲区，不再推迟 flush，
    // 避免数据持续到来时定时器被无限重置、缓冲区永不输出。
    if (receiveTimerRef.current !== null) {
      return;
    }
    receiveTimerRef.current = window.setTimeout(() => {
      receiveTimerRef.current = null;
      flushReceiveBuffer();
    }, timeoutMs);
  }

  function setSelectedConnection(value: string | null) {
    if (!value) {
      setPort(null);
      return;
    }
    if (value.startsWith("serial:")) {
      setTransportMode("serial");
      setPort(value.slice("serial:".length));
      return;
    }
    setTransportMode(value as TransportMode);
    setPort(null);
  }

  async function loadPorts({ silent = false }: { silent?: boolean } = {}) {
    try {
      const nextPorts = await listSerialPorts();
      const nextNames = new Set(nextPorts.map((item) => item.name));

      // 拔出检测(主信号):已连接串口模式下,选中的端口从枚举里消失 → 标记待重连。
      // available_ports() 在所有平台上都能可靠反映物理存在,比 read 错误更可靠。
      // 读 ref 避免 setInterval 闭包陈旧;门控只记一次。
      if (
        isConnectedRef.current &&
        transportModeRef.current === "serial" &&
        portRef.current &&
        !nextNames.has(portRef.current) &&
        !reconnectPendingRef.current
      ) {
        appendLog({ direction: "system", text: tRef.current("portDisconnectedReconnect"), byteLength: 0 });
        setReconnectPending(true);
      }

      setPorts((currentPorts) => {
        if (portListSignature(currentPorts) === portListSignature(nextPorts)) {
          return currentPorts;
        }
        return nextPorts;
      });
      setPort((currentPort) => {
        // 已连接:绝不让后台轮询覆盖当前选择
        if (isConnected) {
          return currentPort;
        }
        // 端口还在:保留
        if (currentPort && nextPorts.some((item) => item.name === currentPort)) {
          return currentPort;
        }
        // 端口被拔:保留原端口名,等设备重新插入后自动恢复选中
        if (currentPort) {
          return currentPort;
        }
        // 从未选过:默认第一个
        return nextPorts[0]?.name ?? null;
      });
      setLastError(null);
    } catch (error) {
      if (!silent) {
        setPorts([]);
        setLastError(String(error));
      }
    }
  }

  async function refreshPorts() {
    await loadPorts();
  }

  async function connectOrClose() {
    if (isConnected) {
      setIsBusy(true);
      try {
        if (transportMode === "serial") {
          await closeSerialPort();
        } else {
          await closeNetworkTransport();
        }
        setIsConnected(false);
        setTimedSend(false);
        setReconnectPending(false);
        appendLog({ direction: "system", text: t("portClosed"), byteLength: 0 });
      } catch (error) {
        setLastError(String(error));
        appendLog({ direction: "error", text: String(error), byteLength: 0 });
      } finally {
        setIsBusy(false);
      }
      return;
    }

    if (transportMode === "serial" && !port) {
      return;
    }

    setIsBusy(true);
    try {
      if (transportMode === "serial") {
        await openSerialPort({
          name: port as string,
          baudRate: Number(baudRate),
          dataBits: Number(dataBit),
          stopBits: stopBit,
          parity,
        });
      } else {
        await openNetworkTransport({
          mode: transportMode,
          remoteHost,
          remotePort: Number(remotePort),
          localPort: Number(localPort),
        });
      }
      setIsConnected(true);
      setLastError(null);
      appendLog({ direction: "system", text: `${t("portOpened")}：${connectionText()}`, byteLength: 0 });
    } catch (error) {
      setLastError(String(error));
      appendLog({ direction: "error", text: String(error), byteLength: 0 });
    } finally {
      setIsBusy(false);
    }
  }

  async function sendCurrentText(text = sendText) {
    if (!isConnected || !text.trim()) {
      return;
    }

    const payload = sendHexMode ? appendChecksumToHexFrame(text, checksumType, checksumStart, checksumEnd) : text;

    try {
      const writeData = transportMode === "serial" ? writeSerialData : writeNetworkData;
      const written = await writeData({
        data: payload,
        hex: sendHexMode,
        appendNewline: !sendHexMode && appendNewline,
      });
      setTxBytes((value) => value + written);
      rememberSendText(payload);
      appendLog({
        direction: "tx",
        text: payload,
        hex: sendHexMode ? payload : bytesToHex(Array.from(new TextEncoder().encode(payload + (appendNewline ? "\r\n" : "")))),
        byteLength: written,
      });
      setLastError(null);
    } catch (error) {
      setLastError(String(error));
      appendLog({ direction: "error", text: String(error), byteLength: 0 });
    }
  }

  function connectionText() {
    if (transportMode === "serial") {
      return `${port} @ ${baudRate}`;
    }
    if (transportMode === "tcp-server") {
      return `TCP Server :${localPort}`;
    }
    if (transportMode === "udp") {
      return `UDP :${localPort} -> ${remoteHost}:${remotePort}`;
    }
    return `TCP Client ${remoteHost}:${remotePort}`;
  }

  async function runLoopbackTest() {
    const text = sendText.trim() ? sendText : t("loopbackDefaultText");
    try {
      const byteLength = await emitLoopbackData({
        data: text,
        hex: sendHexMode,
        appendNewline: !sendHexMode && appendNewline,
      });
      appendLog({
        direction: "system",
        text: `${t("loopbackReturned")} ${byteLength} B`,
        byteLength: 0,
      });
      rememberSendText(text);
      setLastError(null);
    } catch (error) {
      setLastError(String(error));
      appendLog({ direction: "error", text: String(error), byteLength: 0 });
    }
  }

  function clearLogs() {
    setLogs([]);
    setRxBytes(0);
    setTxBytes(0);
  }

  function rememberSendText(text = sendText) {
    const value = text.trim();
    if (!value) {
      return;
    }
    setHistory((current) => rememberSendHistoryItem(current, value));
    saveSendHistoryItem(value)
      .then(setHistory)
      .catch((error) => {
        setLastError(String(error));
      });
  }

  function clearSendHistory() {
    setHistory([]);
    clearSavedSendHistory().catch((error) => {
      setLastError(String(error));
    });
  }

  async function saveCurrentCommandLabel(name: string) {
    const value = sendText.trim();
    if (!value || !name.trim()) {
      return;
    }
    const nextLabels = await saveCommandLabel({ name, text: value, hex: sendHexMode });
    setCommandLabels(nextLabels);
  }

  async function deleteCommandLabelById(id: number) {
    const nextLabels = await deleteCommandLabel(id);
    setCommandLabels(nextLabels);
  }

  async function copyLogs() {
    const content = logs.map((log) => `[${log.time}] ${log.direction.toUpperCase()} ${formatPayload(log, receiveHexMode)}`).join("\n");
    await navigator.clipboard.writeText(content);
  }

  function downloadLogs() {
    const content = logs.map((log) => `[${log.time}] ${log.direction.toUpperCase()} ${formatPayload(log, receiveHexMode)}`).join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `busspy-${Date.now()}.log`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportData() {
    const payload = {
      exportedAt: new Date().toISOString(),
      connection: {
        transportMode,
        port,
        baudRate,
        dataBit,
        stopBit,
        parity,
        remoteHost,
        remotePort,
        localPort,
      },
      options: {
        receiveHexMode,
        sendHexMode,
        showTimestamp,
        packetMode,
        packetTimeoutMs,
        appendNewline,
        timedSend,
        intervalMs,
        checksumType,
        checksumStart,
        checksumEnd,
      },
      stats: {
        rxBytes,
        txBytes,
      },
      logs: logs.map((log) => ({
        time: log.time,
        direction: log.direction,
        text: log.text,
        hex: log.hex,
        byteLength: log.byteLength,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `busspy-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function startTerminalResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = terminalHeight;
    const panelHeight = panelRef.current?.clientHeight ?? 620;
    const maxHeight = Math.max(180, panelHeight - 420);

    function onPointerMove(moveEvent: PointerEvent) {
      const nextHeight = Math.min(maxHeight, Math.max(160, startHeight + moveEvent.clientY - startY));
      setTerminalHeight(nextHeight);
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.body.classList.remove("is-resizing-terminal");
    }

    document.body.classList.add("is-resizing-terminal");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  useEffect(() => {
    void loadPorts();
  }, []);

  useEffect(() => {
    loadSendHistory()
      .then(setHistory)
      .catch((error) => {
        setLastError(String(error));
      });
    listCommandLabels()
      .then(setCommandLabels)
      .catch((error) => {
        setLastError(String(error));
      });
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadPorts({ silent: true });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [isConnected]);

  // 串口拔出后,等待设备重新插入自动重连(用上次的连接参数)。
  // 依赖 ports:每 1.5s 轮询更新,端口重新出现时自动触发一次重连。
  useEffect(() => {
    if (!reconnectPending || transportMode !== "serial" || !port) {
      return;
    }
    if (reconnectingRef.current) {
      return;
    }
    // 原端口还没回来,等下一轮轮询
    if (!ports.some((item) => item.name === port)) {
      return;
    }

    reconnectingRef.current = true;
    void (async () => {
      try {
        await openSerialPort({
          name: port,
          baudRate: Number(baudRate),
          dataBits: Number(dataBit),
          stopBits: stopBit,
          parity,
        });
        setReconnectPending(false);
        setLastError(null);
        appendLog({ direction: "system", text: `${t("portOpened")}：${connectionText()}`, byteLength: 0 });
      } catch (error) {
        // 重连失败不循环重试,清待重连标志,记日志,让用户手动处理
        setReconnectPending(false);
        setLastError(String(error));
        appendLog({ direction: "error", text: String(error), byteLength: 0 });
      } finally {
        reconnectingRef.current = false;
      }
    })();
  }, [reconnectPending, ports, port, transportMode, baudRate, dataBit, stopBit, parity, t]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    packetModeRef.current = packetMode;
  }, [packetMode]);

  useEffect(() => {
    packetTimeoutRef.current = packetTimeoutMs;
  }, [packetTimeoutMs]);

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  useEffect(() => {
    reconnectPendingRef.current = reconnectPending;
  }, [reconnectPending]);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    transportModeRef.current = transportMode;
  }, [transportMode]);

  useEffect(() => {
    portRef.current = port;
  }, [port]);

  // 事件监听器只在挂载时注册一次,内部全部读 ref,绝不依赖任何 state。
  // 这样 StrictMode 双挂载、packetMode/packetTimeoutMs 变化都不会重建监听器,
  // 彻底避免事件丢失、buffer 状态混乱、监听器泄漏等问题。
  useEffect(() => {
    let unlistenData: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    let disposed = false;

    listen<SerialDataEvent>("serial-data", (event) => {
      const byteLength = event.payload.data.length;
      setRxBytes((value) => value + byteLength);
      if (isPausedRef.current) {
        return;
      }

      if (!packetModeRef.current) {
        appendLog({
          direction: "rx",
          text: event.payload.text,
          hex: event.payload.hex,
          byteLength,
        });
        return;
      }

      const buffered = receiveBufferRef.current;
      if (buffered) {
        buffered.bytes.push(...event.payload.data);
      } else {
        receiveBufferRef.current = {
          bytes: [...event.payload.data],
          firstAt: Date.now(),
        };
      }
      const parsed = Number(packetTimeoutRef.current);
      const timeoutMs = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 20;
      scheduleReceiveFlush(timeoutMs);
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        unlistenData = unlisten;
      }
    });

    listen<string>("serial-error", (event) => {
      setLastError(event.payload);
      appendLog({ direction: "error", text: event.payload, byteLength: 0 });
      if (isConnectedRef.current && !reconnectPendingRef.current) {
        appendLog({ direction: "system", text: tRef.current("portDisconnectedReconnect"), byteLength: 0 });
        setReconnectPending(true);
      }
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        unlistenError = unlisten;
      }
    });

    return () => {
      disposed = true;
      flushReceiveBuffer();
      unlistenData?.();
      unlistenError?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (autoScroll) {
      terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight });
    }
  }, [autoScroll, logs]);

  useEffect(() => {
    if (!timedSend || !isConnected) {
      return;
    }
    const timer = window.setInterval(() => {
      void sendCurrentText();
    }, Number(intervalMs));
    return () => window.clearInterval(timer);
  }, [timedSend, isConnected, intervalMs, sendText, sendHexMode, appendNewline]);

  return {
    transportMode,
    setTransportMode,
    selectedConnection,
    setSelectedConnection,
    connectionOptions,
    port,
    setPort,
    portOptions,
    baudRate,
    setBaudRate,
    dataBit,
    setDataBit,
    stopBit,
    setStopBit,
    parity,
    setParity,
    rts,
    setRts,
    dtr,
    setDtr,
    remoteHost,
    setRemoteHost,
    remotePort,
    setRemotePort,
    localPort,
    setLocalPort,
    isConnected,
    isPaused,
    setIsPaused,
    isBusy,
    sendText,
    setSendText,
    receiveHexMode,
    setReceiveHexMode,
    showTimestamp,
    setShowTimestamp,
    packetMode,
    setPacketMode,
    packetTimeoutMs,
    setPacketTimeoutMs,
    saveReceiveToFile,
    setSaveReceiveToFile,
    sendHexMode,
    setSendHexMode,
    checksumType,
    setChecksumType,
    checksumStart,
    setChecksumStart,
    checksumEnd,
    setChecksumEnd,
    appendNewline,
    setAppendNewline,
    timedSend,
    setTimedSend,
    intervalMs,
    setIntervalMs,
    autoScroll,
    setAutoScroll,
    logs,
    history,
    commandLabels,
    saveCurrentCommandLabel,
    deleteCommandLabelById,
    rxBytes,
    txBytes,
    lastError,
    terminalHeight,
    terminalRef,
    panelRef,
    txPreviewBytes: sendHexMode ? hexByteLength(sendText) : textByteLength(sendText, appendNewline),
    sendAnalysis,
    connectOrClose,
    refreshPorts,
    sendCurrentText,
    runLoopbackTest,
    rememberSendText,
    clearSendHistory,
    clearLogs,
    copyLogs,
    downloadLogs,
    exportData,
    startTerminalResize,
  };
}
