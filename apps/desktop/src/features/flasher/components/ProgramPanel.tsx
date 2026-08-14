import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  Progress,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  CircleCheck,
  CircleX,
  ChevronDown,
  ChevronRight,
  CloudDownload,
  Cpu,
  FolderOpen,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { getAppPaths, pickFile } from "../../../tauri";
import { useI18n } from "../../../i18n";
import type { FlasherStore, ProbeType } from "../lib/types";
import { PackDownloadModal } from "./PackDownloadModal";
import { DevicePickerModal } from "./DevicePickerModal";

interface ProgramPanelProps {
  state: FlasherStore;
}

export function ProgramPanel({ state }: ProgramPanelProps) {
  const { t } = useI18n();

  const [packDownloaderOpened, setPackDownloaderOpened] = useState(false);
  const [devicePickerOpened, setDevicePickerOpened] = useState(false);
  // 烧录日志：默认收起不打扰，只在用户主动点开「查看日志」时展开；
  // 结果通过下方 run.success 的成功/失败条展示，不刷过程日志。
  const [logsOpen, setLogsOpen] = useState(false);

  const running = state.run.running;
  const showLogsExpanded = logsOpen;
  const hasLogs = state.flashLogs.length > 0;

  const envReady = Boolean(state.status?.ready);
  const probe = state.selectedProbe;
  const canFlash = envReady && Boolean(state.selectedTarget) && Boolean(state.firmwarePath);
  const canChip = envReady && Boolean(probe);
  const isSwd = state.connectionMode === "swd";

  const deviceOptions = useMemo(() => {
    const groups = new Map<string, { value: string; label: string }[]>();
    for (const item of state.targets) {
      const family = item.family || "其他";
      if (!groups.has(family)) groups.set(family, []);
      groups.get(family)!.push({ value: item.target, label: `${item.name} · ${item.flashKb}KB` });
    }
    return Array.from(groups.entries()).map(([group, items]) => ({ group, items }));
  }, [state.targets]);

  const phaseLabel =
    state.run.phase === "program" ? t("phaseProgram")
    : state.run.phase === "erase" ? t("phaseErase")
    : state.run.phase === "connecting" ? t("phaseConnecting")
    : state.run.phase === "verify" ? t("phaseVerify")
    : "";

  async function pickFirmware() {
    let defaultPath: string | undefined;
    try {
      const { firmwareDir } = await getAppPaths();
      defaultPath = firmwareDir || undefined;
    } catch { /* ignore */ }
    const path = await pickFile(
      [{ name: "固件文件", extensions: ["hex", "bin", "elf", "axf"] }, { name: "所有文件", extensions: ["*"] }],
      defaultPath,
    );
    if (path) state.setFirmwarePath(path);
  }

  return (
    <div className="program-simple">
      <PackDownloadModal
        opened={packDownloaderOpened}
        onClose={() => setPackDownloaderOpened(false)}
        onInstalled={async () => { await Promise.all([state.loadPacks(), state.loadTargets()]); }}
        onLog={state.pushFlashLog}
        state={state}
      />
      <DevicePickerModal
        opened={devicePickerOpened}
        onClose={() => setDevicePickerOpened(false)}
        selectedTarget={state.selectedTarget}
        onSelect={(target) => state.setSelectedTarget(target)}
        installedPacks={state.packs.map((p) => p.name)}
        onInstalled={async () => { await Promise.all([state.loadPacks(), state.loadTargets()]); }}
      />

      {/* ── 烧录卡片（一个白色卡片，内部分区，紧凑有层次） ── */}
      <section className="flasher-card">
        <Stack gap={18}>
          {/* 连接 */}
          <div className="prog-section">
          <div className="prog-section-title">{t("sectionConnect")}</div>
          <Stack gap={8}>
            <Group gap={10} wrap="wrap" align="center">
              <SegmentedControl
                size="xs"
                value={state.connectionMode}
                onChange={(value) => state.setConnectionMode(value as "swd" | "isp")}
                data={[{ label: "SWD", value: "swd" }, { label: t("serialIsp"), value: "isp" }]}
              />
              {isSwd && (
                <Select
                  size="xs"
                  style={{ width: 130 }}
                  value={state.probeType}
                  onChange={(value) => state.setProbeType((value as ProbeType) ?? "auto")}
                  data={[
                    { value: "auto", label: t("probeTypeAuto") },
                    { value: "cmsis-dap", label: t("probeTypeCmsisDap") },
                    { value: "stlink", label: t("probeTypeStlink") },
                    { value: "jlink", label: t("probeTypeJlink") },
                  ]}
                  allowDeselect={false}
                />
              )}
            </Group>
            {isSwd ? (
              <Group gap={10} wrap="wrap" align="center">
                {state.visibleProbes.length > 1 ? (
                  <Select
                    size="xs"
                    style={{ flex: 1, minWidth: 200 }}
                    value={state.selectedProbeId ?? state.visibleProbes[0]?.uniqueId ?? null}
                    onChange={(value) => state.setSelectedProbeId(value ?? null)}
                    placeholder={t("selectProbe")}
                    data={state.visibleProbes.map((item) => ({
                      value: item.uniqueId || item.id,
                      label: `${item.product || item.vendor}${item.uniqueId ? ` (${item.uniqueId})` : ""}`,
                    }))}
                    allowDeselect={false}
                  />
                ) : (
                  <Text fz={13} className="ellipsis" style={{ flex: 1, minWidth: 0, color: probe ? "#2f9e44" : "var(--text-muted)" }}>
                    {state.refreshing ? "⏳ 扫描中..." : probe ? `● ${probe.product || probe.uniqueId || probe.id}` : "○ 未连接"}
                  </Text>
                )}
                <Button size="compact-xs" variant="subtle" leftSection={<RefreshCw size={12} />} onClick={() => void state.refreshProbes()} loading={state.refreshing}>
                  {t("refresh")}
                </Button>
              </Group>
            ) : (
              <Group gap={10} wrap="wrap" align="center">
                <Select
                  size="xs"
                  style={{ flex: 1, minWidth: 180 }}
                  data={state.serialPorts.map((port) => ({ value: port, label: port }))}
                  value={state.selectedPort}
                  onChange={(value) => state.setSelectedPort(value ?? null)}
                  placeholder={t("selectPort")}
                  searchable
                />
                <Select
                  size="xs"
                  style={{ width: 100 }}
                  value={String(state.baudRate)}
                  onChange={(value) => state.setBaudRate(Number(value ?? 115200))}
                  data={["115200", "460800", "921600", "230400", "57600", "38400", "19200", "9600"].map((r) => ({ value: r, label: r }))}
                />
              </Group>
            )}
          </Stack>
          </div>

          {/* 器件 + 固件 */}
          <div className="prog-section">
          <div className="prog-section-title">{t("sectionDeviceFirmware")}</div>
          <Group gap={12} wrap="wrap" align="flex-end">
            <Stack gap={4} style={{ flex: 1, minWidth: 240 }}>
              <Text fz={12} fw={600}>{t("device")}</Text>
              <Group gap={6} wrap="nowrap">
                <Button
                  size="xs"
                  variant="default"
                  onClick={() => setDevicePickerOpened(true)}
                  style={{ flex: 1, justifyContent: "flex-start" }}
                >
                  {state.selectedTarget
                    ? `${deviceOptions.flatMap((g) => g.items).find((i) => i.value === state.selectedTarget)?.label || state.selectedTarget}`
                    : t("deviceSearch")}
                </Button>
                <Button size="compact-xs" variant="light" leftSection={<CloudDownload size={11} />} onClick={() => setPackDownloaderOpened(true)}>
                  {t("deviceManager")}
                </Button>
              </Group>
            </Stack>
            <Stack gap={4} style={{ flex: 1, minWidth: 240 }}>
              <Text fz={12} fw={600}>{t("firmware")}</Text>
              {state.firmwarePath ? (
                <Group gap={6} wrap="nowrap">
                  <Button size="compact-xs" variant="light" leftSection={<FolderOpen size={11} />} onClick={() => void pickFirmware()}>
                    {t("chooseFile")}
                  </Button>
                  <Text fz={11} c="dimmed" className="ellipsis" style={{ flex: 1, minWidth: 0 }}>
                    {state.firmwarePath.split(/[\\/]/).pop()}
                  </Text>
                </Group>
              ) : (
                <Button size="xs" variant="light" leftSection={<FolderOpen size={12} />} onClick={() => void pickFirmware()} fullWidth>
                  {t("chooseFile")}
                </Button>
              )}
            </Stack>
          </Group>
          </div>

          {/* 选项 */}
          <div className="prog-section">
          <div className="prog-section-title">{t("sectionOptions")}</div>
          <Stack gap={10}>
            <Group gap={20} wrap="wrap" align="center">
              <Checkbox size="xs" label={t("chipErase")} checked={state.chipErase} onChange={(e) => state.setChipErase(e.currentTarget.checked)} />
              <Checkbox size="xs" label={t("verifyAfterFlash")} checked={state.verifyAfterFlash} onChange={(e) => state.setVerifyAfterFlash(e.currentTarget.checked)} />
            </Group>
            <Group gap={12} wrap="wrap" align="flex-start" grow>
              <TextInput
                size="xs"
                label={t("flashAddress")}
                styles={{ label: { fontSize: 11, color: "var(--text-muted)" }, input: { fontFamily: "monospace" } }}
                value={`0x${(state.flashAddress ?? 0x08000000).toString(16).toUpperCase()}`}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  const num = v.startsWith("0x") ? parseInt(v, 16) : parseInt(v, 10);
                  if (!isNaN(num)) state.setFlashAddress(num);
                }}
              />
              <Select
                size="xs"
                label={t("maxClock")}
                styles={{ label: { fontSize: 11, color: "var(--text-muted)" } }}
                value={String(state.swdFrequency)}
                onChange={(value) => state.setSwdFrequency(Number(value ?? 1_000_000))}
                data={[
                  { value: "1000000", label: "1 MHz" },
                  { value: "2000000", label: "2 MHz" },
                  { value: "4000000", label: "4 MHz" },
                  { value: "8000000", label: "8 MHz" },
                  { value: "10000000", label: "10 MHz" },
                ]}
                allowDeselect={false}
              />
              <Select
                size="xs"
                label={t("flashAlgorithm")}
                styles={{ label: { fontSize: 11, color: "var(--text-muted)" } }}
                value={state.selectedAlgorithm ?? ""}
                onChange={(value) => state.setSelectedAlgorithm(value ?? null)}
                placeholder={state.algorithms.length > 0 ? undefined : t("algorithmNoDfp")}
                disabled={state.algorithms.length === 0}
                data={[
                  {
                    value: "",
                    label: t("algorithmDefault", {
                      name: state.algorithms.find((a) => a.default)?.name ?? state.algorithms[0]?.name ?? t("probeTypeAuto"),
                    }),
                  },
                  ...state.algorithms.map((a) => ({
                    value: a.name,
                    label: `${a.name}${a.sizeKb > 0 ? ` (${a.sizeKb}KB)` : ""}${a.default ? " · 默认" : ""}`,
                  })),
                ]}
                allowDeselect={false}
              />
            </Group>
          </Stack>
          </div>

          {/* 操作按钮 */}
          <div className="prog-section">
          <div className="prog-section-title">{t("sectionFlash")}</div>
          <Group gap={10} wrap="wrap">
            <Button
              size="sm"
              leftSection={running ? <Loader size={14} /> : <Play size={14} />}
              onClick={() => void state.flash()}
              disabled={!canFlash || running}
              loading={running}
            >
              {t("startFlash")}
            </Button>
            <Button variant="light" size="sm" leftSection={<Trash2 size={14} />} onClick={() => void state.erase()} disabled={!canChip || running}>
              {t("chipErase")}
            </Button>
            <Button variant="subtle" size="sm" leftSection={<Cpu size={14} />} onClick={() => void state.readChipInfo()} disabled={!canChip || running} loading={state.chipInfoLoading}>
              {t("readChipInfo")}
            </Button>
          </Group>
          </div>

          {state.run.success === true && (
            <div className="flash-result ok"><CircleCheck size={16} /><span>{state.run.message}</span></div>
          )}
          {state.run.success === false && (
            <div className="flash-result fail"><CircleX size={16} /><span className="path-break">{state.run.message}</span></div>
          )}

          {/* 芯片信息 */}
          {state.chipInfo && (
            <Group gap={16} wrap="wrap" style={{ fontSize: 12, color: "var(--text-muted)" }}>
              <span>{state.chipInfo.target}</span>
              {state.chipInfo.flashSize && <span>Flash: {Math.round(state.chipInfo.flashSize / 1024)}KB</span>}
              {state.chipInfo.chipId && <span>设备ID: {state.chipInfo.chipId}</span>}
              {state.chipInfo.uid.some((w) => w !== "00000000") && <span>UID: {state.chipInfo.uid.join(" ")}</span>}
            </Group>
          )}

          {/* 序列号（芯片里已写过 SN 时显示） */}
          {state.currentSn && (
            <Group gap={8} align="center">
              <Text fz={12} c="dimmed">SN:</Text>
              <Text fz={14} fw={700} style={{ fontFamily: "monospace" }}>{state.currentSn}</Text>
            </Group>
          )}
        </Stack>
      </section>

      {/* 日志（卡片外，底部；默认收起不遮挡，点标题展开） */}
      {hasLogs && (
        <div className="flash-log-panel">
          <Group justify="space-between" align="center" mb={0} wrap="nowrap">
            <Button
              size="compact-xs"
              variant="subtle"
              leftSection={showLogsExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              onClick={() => setLogsOpen((prev) => !prev)}
              styles={{ root: { color: "var(--text-muted)" } }}
            >
              {t("flashLog")} ({state.flashLogs.length})
            </Button>
            {showLogsExpanded && (
              <Button size="compact-xs" variant="subtle" onClick={state.clearFlashLogs}>
                {t("clear")}
              </Button>
            )}
          </Group>
          {showLogsExpanded && (
            <pre className="bootstrap-log" style={{ maxHeight: 160 }}>{state.flashLogs.join("\n")}</pre>
          )}
        </div>
      )}

      {state.error && (
        <Alert color="red" variant="light" p="sm">
          <Text fz={12}>{state.error}</Text>
        </Alert>
      )}

      {/* 烧录进度（页面最底部固定栏，与下载器底部进度同风格） */}
      {running && (
        <div className="flash-progress-bar">
          <Group justify="space-between" align="center" wrap="nowrap" mb={6}>
            <Text fz={12} fw={600}>{phaseLabel || t("startFlash")}</Text>
            <Text fz={12} c="dimmed">{state.run.pct}%</Text>
          </Group>
          <Progress value={state.run.pct} size="md" striped animated />
        </div>
      )}
    </div>
  );
}
