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
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  CircleCheck,
  CircleX,
  FileUp,
  FolderOpen,
  Info,
  Package,
  Play,
  RefreshCw,
  Trash2,
  Usb,
  Zap,
} from "lucide-react";
import { pickFile } from "../../../tauri";
import { useI18n } from "../../../i18n";
import type { FlasherStore } from "../lib/types";

interface ProgramPanelProps {
  state: FlasherStore;
}

export function ProgramPanel({ state }: ProgramPanelProps) {
  const { t } = useI18n();
  const [addressManual, setAddressManual] = useState(false);

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
    const path = await pickFile([
      { name: "CMSIS DFP Pack", extensions: ["pack"] },
    ]);
    if (path) {
      await state.importPack(path);
    }
  }

  const progressValue = state.run.running ? state.run.pct : 0;
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
    <div className="flasher-grid program-grid">
      {/* ① 连接方式 */}
      <section className="flasher-card">
        <PanelTitle icon={<Usb size={15} />} title={t("connectionMode")} />
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
              <Group gap={8}>
                <span className="probe-dot" />
                <Text fz={13} fw={500}>
                  {probe.product || probe.uniqueId}
                </Text>
                <Badge color="green" variant="light" size="xs">
                  {t("probeConnected")}
                </Badge>
              </Group>
            ) : (
              <Text fz={12} c="dimmed">
                {t("noProbe")}
              </Text>
            )}
            <Button size="xs" variant="subtle" leftSection={<RefreshCw size={13} />} onClick={() => void state.refreshProbes()}>
              {t("refresh")}
            </Button>
          </Stack>
        ) : (
          <Stack gap={8}>
            <Select
              size="xs"
              label={t("selectPort")}
              placeholder={t("selectPort")}
              data={state.serialPorts.map((port) => ({ value: port, label: port }))}
              value={state.selectedPort}
              onChange={(value) => state.setSelectedPort(value ?? null)}
              searchable
            />
            <Group grow>
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
            </Group>
            <Text fz={11} c="dimmed">
              {t("ispHint")}
            </Text>
          </Stack>
        )}
      </section>

      {/* ② 器件 */}
      <section className="flasher-card">
        <PanelTitle icon={<Zap size={15} />} title={t("device")} />
        <Select
          size="xs"
          label={t("deviceSearch")}
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
        <Group gap={8} mt={8}>
          <Button size="xs" variant="light" leftSection={<Package size={13} />} onClick={() => void pickPack()}>
            {t("importPack")}
          </Button>
          <Tooltip label={t("packListTooltip")}>
            <Badge variant="default" size="xs">
              {t("installedPacks")}: {state.packs.length}
            </Badge>
          </Tooltip>
        </Group>
        {state.packs.length > 0 && (
          <Text fz={11} c="dimmed" mt={6}>
            {state.packs.map((pack) => `${pack.name} v${pack.version}`).join("、")}
          </Text>
        )}
      </section>

      {/* ③ 固件 */}
      <section className="flasher-card">
        <PanelTitle icon={<FileUp size={15} />} title={t("firmware")} />
        <Group gap={8}>
          <Button
            size="xs"
            variant="light"
            leftSection={<FolderOpen size={13} />}
            onClick={() => void pickFirmware()}
          >
            {t("chooseFile")}
          </Button>
          {state.firmwarePath && (
            <Badge variant="default" size="xs">
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
        <PanelTitle icon={<Info size={15} />} title={t("flashConfig")} />
        <Stack gap={8}>
          <Group gap={8}>
            <Checkbox
              size="xs"
              label={t("manualAddress")}
              checked={addressManual}
              onChange={(event) => setAddressManual(event.currentTarget.checked)}
            />
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

      {/* ⑤ 烧录 + 结果 + 芯片信息 */}
      <section className="flasher-card flash-actions-card">
        <Group justify="space-between" align="flex-start">
          <Stack gap={8} style={{ flex: 1 }}>
            <Group gap={8}>
              <Button
                leftSection={<Play size={15} />}
                onClick={() => void state.flash()}
                disabled={!canFlash || state.run.running}
                loading={state.run.running}
              >
                {t("startFlash")}
              </Button>
              <Button variant="light" size="xs" leftSection={<Trash2 size={13} />} onClick={() => void state.erase()} disabled={!canFlash || state.run.running}>
                {t("chipErase")}
              </Button>
              {state.run.running && <Loader size={16} />}
            </Group>
            {state.run.running && (
              <Progress value={progressValue} size="sm" striped animated />
            )}
            <Text fz={12} c="dimmed">
              {state.run.running ? `${phaseLabel} ${progressValue}%` : ""}
            </Text>
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
                <Text fz={13} c="red.8">
                  {state.run.message}
                </Text>
              </Group>
            )}
          </Stack>

          <Stack gap={6} style={{ minWidth: 180 }}>
            <Group gap={6}>
              <Text fz={12} fw={600}>
                {t("chipInfo")}
              </Text>
              <Button size="compact-xs" variant="subtle" onClick={() => void state.readChipInfo()} disabled={!canFlash || state.run.running}>
                {t("readChipInfo")}
              </Button>
            </Group>
            {state.chipInfo ? (
              <>
                <Text fz={12}>
                  {t("device")}: {state.chipInfo.target}
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

function PanelTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <Group gap={6} mb={10}>
      <ThemeIcon variant="light" radius="sm" size={22}>
        {icon}
      </ThemeIcon>
      <Text fw={600} fz={13}>
        {title}
      </Text>
    </Group>
  );
}
