import { useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Loader,
  NumberInput,
  Paper,
  Progress,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  Check,
  CircleCheck,
  CircleX,
  CloudDownload,
  Cpu,
  FileUp,
  FolderOpen,
  Info,
  Package,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  Usb,
  Zap,
} from "lucide-react";
import { pickFile } from "../../../tauri";
import { useI18n } from "../../../i18n";
import type { FlasherStore, ProbeType } from "../lib/types";
import { PackDownloadModal } from "./PackDownloadModal";

interface ProgramPanelProps {
  state: FlasherStore;
}

/** 单烧页：Keil uVision 风格（顶部连接栏 + 左侧配置 + 中间烧录区 + 底部输出日志） */
export function ProgramPanel({ state }: ProgramPanelProps) {
  const { t } = useI18n();
  const [addressManual, setAddressManual] = useState(false);
  const [packDownloaderOpened, setPackDownloaderOpened] = useState(false);

  const envReady = Boolean(state.status?.ready);
  const probe = state.visibleProbes.find((item) => item.uniqueId) ?? state.visibleProbes[0];
  const canFlash = envReady && Boolean(state.selectedTarget) && Boolean(state.firmwarePath);
  // 读取芯片信息 / 整片擦除只需探针 + 器件，不需要固件文件
  const canChip = envReady && Boolean(state.selectedTarget) && Boolean(probe);
  const running = state.run.running;

  // 器件下拉选项（Mantine Select 显式分组：{group, items}，避免 data 更新时分组转换崩溃）
  const deviceOptions = useMemo(() => {
    const groups = new Map<string, { value: string; label: string }[]>();
    for (const item of state.targets) {
      const family = item.family || "其他";
      if (!groups.has(family)) {
        groups.set(family, []);
      }
      groups.get(family)!.push({
        value: item.target,
        label: item.builtin
          ? `${item.name} · ${item.flashKb}KB ${t("deviceBuiltin")}`
          : `${item.name} · ${item.flashKb}KB ${t("deviceDfp")}`,
      });
    }
    return Array.from(groups.entries()).map(([group, items]) => ({ group, items }));
  }, [state.targets]);
  const isSwd = state.connectionMode === "swd";

  const phaseLabel =
    state.run.phase === "program"
      ? t("phaseProgram")
      : state.run.phase === "erase"
        ? t("phaseErase")
        : state.run.phase === "connecting"
          ? t("phaseConnecting")
          : state.run.phase === "verify"
            ? t("phaseVerify")
            : state.run.phase === "done"
              ? t("phaseDone")
              : state.run.phase === "error"
                ? t("phaseError")
                : "";

  async function pickFirmware() {
    const path = await pickFile([
      { name: "固件文件", extensions: ["hex", "bin", "elf", "axf"] },
      { name: "所有文件", extensions: ["*"] },
    ]);
    if (path) {
      state.setFirmwarePath(path);
    }
  }

  async function pickPack() {
    const path = await pickFile([{ name: "CMSIS DFP Pack", extensions: ["pack"] }]);
    if (path) {
      await state.importPack(path);
    }
  }

  return (
    <div className="program-layout">
      <PackDownloadModal
        opened={packDownloaderOpened}
        onClose={() => setPackDownloaderOpened(false)}
        onInstalled={async () => {
          await Promise.all([state.loadPacks(), state.loadTargets()]);
        }}
        onLog={state.pushFlashLog}
        state={state}
      />

      {/* ── 顶部连接栏 ── */}
      <section className="flasher-card flash-connect-bar">
        <Stack gap={10}>
          <Group gap={12} align="flex-end" wrap="wrap">
            <SegmentedControl
              size="xs"
              value={state.connectionMode}
              onChange={(value) => state.setConnectionMode(value as "swd" | "isp")}
              data={[
                { label: `SWD ${t("probeMode")}`, value: "swd" },
                { label: t("serialIsp"), value: "isp" },
              ]}
            />
            {isSwd ? (
              <>
                <Select
                  style={{ width: 118, flexShrink: 0 }}
                  size="xs"
                  label={t("probeTypeLabel")}
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
                <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                  {state.refreshing ? (
                    <Group gap={6} justify="center">
                      <Loader size={13} />
                      <Text fz={12} c="dimmed">
                        {t("probeScanning")}
                      </Text>
                    </Group>
                  ) : probe ? (
                    <Group gap={8} justify="center" wrap="nowrap">
                      <span className="probe-dot" />
                      <Text fz={13} fw={500} className="ellipsis">
                        {probe.product || probe.uniqueId}
                      </Text>
                    </Group>
                  ) : state.probeType !== "auto" ? (
                    <Text fz={12} c="dimmed" ta="center">
                      {t("probeTypeNone")}
                    </Text>
                  ) : (
                    <Text fz={12} c="dimmed" ta="center">
                      {t("probeGuide")}
                    </Text>
                  )}
                </Stack>
                <Button size="compact-xs" variant="subtle" leftSection={<RefreshCw size={12} />} onClick={() => void state.refreshProbes()} loading={state.refreshing} style={{ flexShrink: 0 }}>
                  {t("refresh")}
                </Button>
              </>
            ) : (
              <>
                <Select
                  style={{ width: 190, flexShrink: 0 }}
                  size="xs"
                  label={t("selectPort")}
                  data={state.serialPorts.map((port) => ({ value: port, label: port }))}
                  value={state.selectedPort}
                  onChange={(value) => state.setSelectedPort(value ?? null)}
                  searchable
                />
                <Select
                  style={{ width: 100, flexShrink: 0 }}
                  size="xs"
                  label={t("baudRate")}
                  value={String(state.baudRate)}
                  onChange={(value) => state.setBaudRate(Number(value ?? 115200))}
                  data={["9600", "19200", "38400", "57600", "115200", "230400", "460800", "921600"].map((rate) => ({
                    value: rate,
                    label: rate,
                  }))}
                />
                <Tooltip
                  label={`${t("ispStep1")}\n${t("ispStep2")}\n${t("ispStep3")}`}
                  withArrow
                  multiline
                  w={220}
                  styles={{ tooltip: { whiteSpace: "pre-line" } }}
                >
                  <Button size="compact-xs" variant="subtle" leftSection={<Info size={12} />} style={{ marginBottom: 4, flexShrink: 0 }}>
                    {t("ispHelpLabel")}
                  </Button>
                </Tooltip>
              </>
            )}
          </Group>
        </Stack>
      </section>

      {/* ── 左：配置面板（Keil Project 风格分层） ── */}
      <section className="flasher-card">
        <Group justify="space-between" align="center" mb={5} wrap="nowrap">
          <Text fw={600} fz={13}>
            {t("device")}
          </Text>
          <Group gap={4} wrap="nowrap">
            <Tooltip label={t("deviceManager")}>
              <ActionIcon variant="light" color="blue" size="sm" aria-label={t("deviceManager")} onClick={() => setPackDownloaderOpened(true)}>
                <CloudDownload size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("importPack")}>
              <ActionIcon variant="subtle" color="gray" size="sm" aria-label={t("importPack")} onClick={() => void pickPack()}>
                <Package size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("installedPacks")}>
              <Badge variant="default" size="xs" style={{ cursor: "default" }}>
                {state.packs.length}
              </Badge>
            </Tooltip>
          </Group>
        </Group>
        <Select
          size="xs"
          placeholder={t("deviceSearch")}
          value={state.selectedTarget}
          onChange={(value) => state.setSelectedTarget(value ?? null)}
          data={deviceOptions}
          searchable
          maxDropdownHeight={180}
          nothingFoundMessage={t("noDeviceFound")}
        />

        <Divider my={12} />

        <CardTitle icon={<FileUp size={14} />} title={t("firmware")} />
        <Stack gap={6}>
          <Button size="compact-xs" variant="light" leftSection={<FolderOpen size={13} />} onClick={() => void pickFirmware()} style={{ alignSelf: "flex-start" }}>
            {t("chooseFile")}
          </Button>
          {state.firmwarePath ? (
            <>
              <Badge variant="default" size="xs" className="ellipsis" style={{ alignSelf: "flex-start", maxWidth: "100%" }}>
                {state.firmwarePath.split(/[\\/]/).pop()}
              </Badge>
              <Text fz={11} c="dimmed" className="path-break">
                {state.firmwarePath}
              </Text>
            </>
          ) : (
            <Text fz={12} c="dimmed">
              {t("noFirmwareHint")}
            </Text>
          )}
        </Stack>

        <Divider my={12} />

        <CardTitle icon={<SlidersHorizontal size={14} />} title={t("flashConfig")} />
        <Stack gap={8}>
          <Group gap={16} wrap="wrap">
            <Checkbox size="xs" label={t("chipErase")} checked={state.chipErase} onChange={(event) => state.setChipErase(event.currentTarget.checked)} />
            <Checkbox size="xs" label={t("verifyAfterFlash")} checked={state.verifyAfterFlash} onChange={(event) => state.setVerifyAfterFlash(event.currentTarget.checked)} />
          </Group>
          <Group gap={8} wrap="nowrap">
            <Checkbox size="xs" label={t("manualAddress")} checked={addressManual} onChange={(event) => setAddressManual(event.currentTarget.checked)} style={{ whiteSpace: "nowrap" }} />
            {addressManual && (
              <NumberInput
                size="xs"
                style={{ width: 130 }}
                value={state.flashAddress ?? 0}
                onChange={(value) => state.setFlashAddress(Number(value ?? 0))}
                prefix="0x"
                hideControls
                aria-label={t("flashAddress")}
              />
            )}
          </Group>
        </Stack>
      </section>

      {/* ── 右：烧录主区域（设备信息 + 操作 + 进度） ── */}
      <section className="flasher-card flash-action-bar">
        <Stack gap={12}>
          {/* 设备信息 */}
          <Stack gap={5}>
            <Group gap={6}>
              <Cpu size={14} />
              <Text fw={600} fz={13}>
                {t("deviceInfoTitle")}
              </Text>
            </Group>
            {state.chipInfo ? (
              <>
                <Text fz={13} fw={600} className="ellipsis">
                  {state.chipInfo.target}
                </Text>
                <Group gap={16}>
                  {state.chipInfo.flashSize && <Text fz={12}>Flash: {Math.round(state.chipInfo.flashSize / 1024)} KB</Text>}
                  {state.chipInfo.chipId && <Text fz={12}>IDCODE: {state.chipInfo.chipId}</Text>}
                </Group>
                {state.chipInfo.uid.length > 0 && (
                  <Text fz={11} c="dimmed" className="path-break">
                    UID: {state.chipInfo.uid.join("")}
                  </Text>
                )}
              </>
            ) : (
              <Text fz={12} c="dimmed">
                {t("chipInfoHint")}
              </Text>
            )}
          </Stack>

          <Divider />

          {/* 操作按钮 */}
          <Group gap={10}>
            <Button
              leftSection={running ? <Loader size={14} /> : <Play size={15} />}
              onClick={() => void state.flash()}
              disabled={!canFlash || running}
              loading={running}
              styles={{ root: { minWidth: 120 } }}
            >
              {t("startFlash")}
            </Button>
            <Button variant="light" size="xs" leftSection={<Trash2 size={13} />} onClick={() => void state.erase()} disabled={!canChip || running}>
              {t("chipErase")}
            </Button>
            <Button size="compact-xs" variant="subtle" leftSection={<Cpu size={12} />} onClick={() => void state.readChipInfo()} disabled={!canChip || running}>
              {t("readChipInfo")}
            </Button>
          </Group>

          {/* 进度 / 结果 */}
          {running && (
            <Stack gap={4}>
              <Progress value={state.run.pct} size="sm" striped animated />
              <Text fz={12} c="dimmed">
                {phaseLabel} {state.run.pct}%
              </Text>
            </Stack>
          )}
          {state.run.success === true && (
            <div className="flash-result ok">
              <CircleCheck size={17} />
              <span>{state.run.message}</span>
            </div>
          )}
          {state.run.success === false && (
            <div className="flash-result fail">
              <CircleX size={17} />
              <span className="path-break">{state.run.message}</span>
            </div>
          )}
        </Stack>
      </section>

      {/* ── 输出窗口（Keil Build Output 风格，底部） ── */}
      {state.flashLogs.length > 0 && (
        <Paper className="flash-log-panel" withBorder>
          <Group justify="space-between" mb={4}>
            <Text fz={12} fw={600}>
              {t("flashLog")}
            </Text>
            <Button size="compact-xs" variant="subtle" onClick={state.clearFlashLogs}>
              {t("clear")}
            </Button>
          </Group>
          <pre className="bootstrap-log">{state.flashLogs.join("\n")}</pre>
        </Paper>
      )}

      {state.error && (
        <Alert color="red" variant="light" p="sm">
          <Text fz={12}>{state.error}</Text>
        </Alert>
      )}
    </div>
  );
}

function CardTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <Group gap={6} mb={10}>
      <span className="card-title-icon">{icon}</span>
      <Text fw={600} fz={13}>
        {title}
      </Text>
    </Group>
  );
}
