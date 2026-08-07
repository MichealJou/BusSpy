import { ActionIcon, Group, Switch, Text, TextInput, Tooltip } from "@mantine/core";
import { Check, Copy, Eraser, Pause, Play } from "lucide-react";
import { useState } from "react";
import { HelpTip } from "../../../components/help/HelpTip";
import { useI18n } from "../../../i18n";
import { formatFramedPayload, formatPayload } from "../lib/format";
import type { SerialConsoleState } from "../lib/types";
import type { SerialLog } from "../lib/types";

interface ReceivePanelProps {
  state: SerialConsoleState;
}

export function ReceivePanel({ state }: ReceivePanelProps) {
  const { t } = useI18n();
  const [copiedId, setCopiedId] = useState<number | null>(null);

  async function copySingleLog(log: SerialLog) {
    const content = formatPayload(log, state.receiveHexMode);
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(log.id);
      window.setTimeout(() => setCopiedId((current) => (current === log.id ? null : current)), 1200);
    } catch {
      // 剪贴板不可用时静默失败,不打断用户
    }
  }

  return (
    <>
      <div className="panel-header">
        <Group gap="xs">
          <Text className="section-title">{t("receiveData")}</Text>
          <HelpTip label={t("receiveHelp")} />
        </Group>
        <Group gap="xs" className="receive-actions">
          <Tooltip label={state.isPaused ? t("resume") : t("pause")}>
            <ActionIcon variant={state.isPaused ? "filled" : "light"} onClick={() => state.setIsPaused((value) => !value)}>
              {state.isPaused ? <Play size={16} /> : <Pause size={16} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("clearWindow")}>
            <ActionIcon variant="light" onClick={state.clearLogs}>
              <Eraser size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("copyContent")}>
            <ActionIcon variant="light" onClick={() => void state.copyLogs()} disabled={state.logs.length === 0}>
              <Copy size={16} />
            </ActionIcon>
          </Tooltip>
          <Switch size="sm" label="HEX" checked={state.receiveHexMode} onChange={(event) => state.setReceiveHexMode(event.currentTarget.checked)} />
          <Switch size="sm" label={t("timestamp")} checked={state.showTimestamp} onChange={(event) => state.setShowTimestamp(event.currentTarget.checked)} />
          <Group gap={4} className="inline-help-control">
            <Switch size="sm" label={t("packetDisplay")} checked={state.packetMode} onChange={(event) => state.setPacketMode(event.currentTarget.checked)} />
            <HelpTip label={t("packetHelp")} />
          </Group>
          <TextInput className="tiny-input" aria-label={t("packetTimeout")} value={state.packetTimeoutMs} onChange={(event) => state.setPacketTimeoutMs(event.currentTarget.value)} rightSection="ms" disabled={!state.packetMode} />
          <Group gap={4} className="inline-help-control">
            <Switch size="sm" label={t("receiveToFile")} checked={state.saveReceiveToFile} onChange={(event) => state.setSaveReceiveToFile(event.currentTarget.checked)} />
            <HelpTip label={t("receiveToFileHelp")} />
          </Group>
          <Switch size="sm" label={t("scroll")} checked={state.autoScroll} onChange={(event) => state.setAutoScroll(event.currentTarget.checked)} />
        </Group>
      </div>

      <div className="terminal" ref={state.terminalRef} style={{ height: state.terminalHeight }}>
        {state.logs.length === 0 ? (
          <div className="terminal-empty">{t("waitingData")}</div>
        ) : (
          state.logs.map((log) => (
            <div key={log.id} className={`terminal-line ${log.direction}`}>
              {state.showTimestamp ? (
                <span className="terminal-time">[{log.time}]</span>
              ) : (
                <span className="terminal-time" aria-hidden="true" />
              )}
              <span className="terminal-kind">{t(log.direction)}</span>
              <span className="terminal-payload">{formatFramedPayload(log, state.receiveHexMode)}</span>
              <Tooltip label={copiedId === log.id ? t("copied") : t("copyContent")} withArrow>
                <ActionIcon
                  className="terminal-copy"
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={() => void copySingleLog(log)}
                  aria-label={t("copyContent")}
                >
                  {copiedId === log.id ? <Check size={14} /> : <Copy size={14} />}
                </ActionIcon>
              </Tooltip>
            </div>
          ))
        )}
      </div>

      <div className="terminal-resizer" onPointerDown={state.startTerminalResize} role="separator" aria-label={t("resizeReceiveArea")}>
        <span />
      </div>
    </>
  );
}
