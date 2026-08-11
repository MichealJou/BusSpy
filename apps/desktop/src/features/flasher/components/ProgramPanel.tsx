import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  NumberInput,
  Paper,
  Progress,
  SegmentedControl,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import {
  CircleCheck,
  CircleX,
  CloudDownload,
  FileUp,
  FolderOpen,
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
import type { FlasherStore } from "../lib/types";
import { PackDownloadModal } from "./PackDownloadModal";

interface ProgramPanelProps {
  state: FlasherStore;
}

export function ProgramPanel({ state }: ProgramPanelProps) {
  const { t } = useI18n();
  const [addressManual, setAddressManual] = useState(false);
  const [packDownloaderOpened, setPackDownloaderOpened] = useState(false);

  const envReady = Boolean(state.status?.ready);
  const probe = state.probes.find((item) => item.uniqueId) ?? state.probes[0];
  const canFlash = envReady && Boolean(state.selectedTarget) && Boolean(state.firmwarePath);

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

  const running = state.run.running;
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

      {/* ① 连接方式 */}
      <section className="flasher-card">
        <CardTitle icon={<Usb size={14} />} title={t("connectionMode")} />
        <SegmentedControl
          fullWidth
          size="xs"
          mb={10}
          value={state.connectionMode}
          onChange={(value) => state.setConnectionMode(value as "swd" | "isp")}
          data={[
            { label: `SWD ${t("probeMode")}`, value: "swd" },
            { label: t("serialIsp"), value: "isp" },
          ]}
        />
        {state.connectionMode === "swd" ? (
          <Stack gap={6}>
            {probe ? (
              <Group gap={8} wrap="nowrap">
                <span className="probe-dot" />
                <Text fz={13} fw={500} className="ellipsis">
                  {probe.product || probe.uniqueId}
                </Text>
                <Badge color="green" variant="light" size="xs" style={{ flexShrink: 0 }}>
                  {t("probeConnected")}
                </Badge>
              </Group>
            ) : (
              <Text fz={12} c="dimmed">
                {t("noProbe")}
              </Text>
            )}
            <Button size="compact-xs" variant="subtle" leftSection={<RefreshCw size={12} />} onClick={() => void state.refreshProbes()} loading={state.refreshing}>
              {t("refresh")}
            </Button>
          </Stack>
        ) : (
          <Stack gap={8}>
            <Select
              size="xs"
              label={t("selectPort")}
              data={state.serialPorts.map((port) => ({ value: port, label: port }))}
              value={state.selectedPort}
              onChange={(value) => state.setSelectedPort(value ?? null)}
              searchable
            />
            <Select
              size="xs"
              label={t("baudRate")}
              value={String(state.baudRate)}
              onChange={(value) => state.setBaudRate(Number(value ?? 115200))}
              data={["9600", "19200", "38400", "57600", "115200", "230400", "460800", "921600"].map((rate) => ({
                value: rate,
                label: rate,
              }))}
            />
            <Text fz={11} c="dimmed">
              {t("ispHint")}
            </Text>
          </Stack>
        )}
      </section>

      {/* ② 器件 */}
      <section className="flasher-card">
        <CardTitle icon={<Zap size={14} />} title={t("device")} />
        <Select
          size="xs"
          placeholder={t("deviceSearch")}
          value={state.selectedTarget}
          onChange={(value) => state.setSelectedTarget(value ?? null)}
          data={state.targets.map((item) => ({
            value: item.target,
            label: `${item.name} · ${item.flashKb}KB`,
            group: item.family,
          }))}
          searchable
          maxDropdownHeight={220}
          nothingFoundMessage={t("noDeviceFound")}
        />
        <Stack gap={6} mt={10}>
          <Button size="compact-xs" variant="light" leftSection={<CloudDownload size={13} />} onClick={() => setPackDownloaderOpened(true)}>
            {t("deviceManager")}
          </Button>
          <Group gap={8}>
            <Button size="compact-xs" variant="subtle" leftSection={<Package size={13} />} onClick={() => void pickPack()}>
              {t("importPack")}
            </Button>
            <Badge variant="default" size="xs">
              {t("installedPacks")}: {state.packs.length}
            </Badge>
          </Group>
        </Stack>
      </section>

      {/* ③ 固件 */}
      <section className="flasher-card">
        <CardTitle icon={<FileUp size={14} />} title={t("firmware")} />
        <Group gap={8}>
          <Button size="compact-xs" variant="light" leftSection={<FolderOpen size={13} />} onClick={() => void pickFirmware()}>
            {t("chooseFile")}
          </Button>
          {state.firmwarePath && (
            <Badge variant="default" size="xs" className="ellipsis" style={{ maxWidth: 180 }}>
              {state.firmwarePath.split(/[\\/]/).pop()}
            </Badge>
          )}
        </Group>
        {state.firmwarePath && (
          <Text fz={11} c="dimmed" mt={6} className="path-break">
            {state.firmwarePath}
          </Text>
        )}
      </section>

      {/* ④ 配置参数 */}
      <section className="flasher-card">
        <CardTitle icon={<SlidersHorizontal size={14} />} title={t("flashConfig")} />
        <Stack gap={8}>
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
          <Group gap={16}>
            <Checkbox size="xs" label={t("chipErase")} checked={state.chipErase} onChange={(event) => state.setChipErase(event.currentTarget.checked)} />
            <Checkbox size="xs" label={t("verifyAfterFlash")} checked={state.verifyAfterFlash} onChange={(event) => state.setVerifyAfterFlash(event.currentTarget.checked)} />
          </Group>
        </Stack>
      </section>

      {/* ⑤ 烧录操作（横跨） */}
      <section className="flasher-card flash-action-bar">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={8} style={{ flex: 1, minWidth: 0 }}>
            <Group gap={8}>
              <Button leftSection={<Play size={15} />} onClick={() => void state.flash()} disabled={!canFlash || running} loading={running}>
                {t("startFlash")}
              </Button>
              <Button variant="light" size="xs" leftSection={<Trash2 size={13} />} onClick={() => void state.erase()} disabled={!canFlash || running}>
                {t("chipErase")}
              </Button>
            </Group>
            {running && (
              <>
                <Progress value={state.run.pct} size="sm" striped animated />
                <Text fz={12} c="dimmed">
                  {phaseLabel} {state.run.pct}%
                </Text>
              </>
            )}
            {state.run.success === true && (
              <Group gap={6}>
                <CircleCheck size={16} color="#2f9e44" />
                <Text fz={13} c="green.8">
                  {state.run.message}
                </Text>
              </Group>
            )}
            {state.run.success === false && (
              <Group gap={6}>
                <CircleX size={16} color="#e03131" />
                <Text fz={13} c="red.8" className="path-break">
                  {state.run.message}
                </Text>
              </Group>
            )}
          </Stack>

          <Stack gap={4} style={{ minWidth: 190, flexShrink: 0 }}>
            <Group gap={6}>
              <Text fz={12} fw={600}>
                {t("chipInfo")}
              </Text>
              <Button size="compact-xs" variant="subtle" onClick={() => void state.readChipInfo()} disabled={!canFlash || running}>
                {t("readChipInfo")}
              </Button>
            </Group>
            {state.chipInfo ? (
              <>
                <Text fz={12} className="ellipsis">
                  {state.chipInfo.target}
                </Text>
                <Text fz={12}>
                  Flash: {state.chipInfo.flashSize ? `${Math.round(state.chipInfo.flashSize / 1024)} KB` : "-"}
                </Text>
                {state.chipInfo.chipId && <Text fz={12}>IDCODE: {state.chipInfo.chipId}</Text>}
                {state.chipInfo.uid.length > 0 && (
                  <Text fz={11} c="dimmed" className="path-break">
                    UID: {state.chipInfo.uid.join("")}
                  </Text>
                )}
              </>
            ) : (
              <Text fz={11} c="dimmed">
                {t("chipInfoHint")}
              </Text>
            )}
          </Stack>
        </Group>
      </section>

      {/* 日志 */}
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
