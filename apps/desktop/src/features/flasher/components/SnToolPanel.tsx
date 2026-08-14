import { useState } from "react";
import { Alert, Button, Checkbox, Group, NumberInput, Select, Stack, Text, TextInput, ThemeIcon, Tooltip } from "@mantine/core";
import { BadgeCheck, Hash, Pencil, RefreshCw } from "lucide-react";
import { useI18n } from "../../../i18n";
import type { FlasherStore, SnFormat } from "../lib/types";

interface SnToolPanelProps {
  state: FlasherStore;
}

const FORMAT_OPTIONS: { value: SnFormat; label: string }[] = [
  { value: "ascii", label: "ASCII" },
  { value: "bcd", label: "BCD" },
  { value: "uint32", label: "uint32" },
  { value: "uint64", label: "uint64" },
];

const CHECKSUM_OPTIONS = [
  { value: "none", label: "None" },
  { value: "crc16", label: "CRC16" },
  { value: "crc32", label: "CRC32" },
];

export function SnToolPanel({ state }: SnToolPanelProps) {
  const { t } = useI18n();
  const [newValue, setNewValue] = useState("");
  const [writing, setWriting] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  const probe = state.selectedProbe;
  const canUse = Boolean(state.selectedTarget) && Boolean(probe);
  const needsLength = state.snConfig.format === "ascii" || state.snConfig.format === "bcd";

  async function handleRead() {
    setReadError(null);
    await state.readSn();
    // readSn 内部已 setError，这里直接读 state.error（通过 ref 保证拿到最新值）
    if (state.error) {
      setReadError(state.error);
    }
  }

  async function handleWrite() {
    if (!newValue.trim()) {
      return;
    }
    setReadError(null);
    setWriting(true);
    const err = await state.writeSn(newValue.trim());
    setWriting(false);
    if (!err) {
      setNewValue("");
    } else {
      // 写 SN 失败：把错误显示在当前页面
      setReadError(err);
    }
  }

  return (
    <div className="flasher-grid sn-grid">
      <section className="flasher-card">
        <Group gap={6} mb={12}>
          <ThemeIcon variant="light" color="teal" radius="sm" size={22}>
            <Hash size={14} />
          </ThemeIcon>
          <Text fw={600} fz={13}>
            {t("snCurrent")}
          </Text>
        </Group>

        <Group gap={8} mb={10}>
          <Button size="xs" leftSection={<RefreshCw size={13} />} onClick={() => void handleRead()} disabled={!canUse} loading={state.snLoading}>
            {t("readSn")}
          </Button>
        </Group>

        {!canUse && (
          <Text fz={12} c="dimmed" mb={8}>
            {t("snNeedDeviceProbe")}
          </Text>
        )}

        {state.currentSn !== null && (
          <Group gap={8} mb={8}>
            <BadgeCheck size={18} color={state.snValid ? "#2f9e44" : "#e03131"} />
            <Text fz={16} fw={600} style={{ fontFamily: "monospace" }}>
              {state.currentSn}
            </Text>
            <Text fz={12} c="dimmed">
              {state.snValid ? t("snChecksumOk") : t("snChecksumBad")}
            </Text>
          </Group>
        )}

        {state.snWarning && (
          <Alert color="yellow" variant="light" p="sm" mb={8}>
            <Text fz={12}>{state.snWarning}</Text>
          </Alert>
        )}

        <Text fz={13} fw={500} mb={6}>
          {t("snModify")}
        </Text>
        <Group gap={8}>
          <TextInput
            style={{ flex: 1 }}
            size="xs"
            placeholder={t("snValuePlaceholder")}
            value={newValue}
            onChange={(event) => setNewValue(event.currentTarget.value)}
            disabled={!canUse}
          />
          <Button
            size="xs"
            leftSection={<Pencil size={13} />}
            onClick={() => void handleWrite()}
            loading={writing}
            disabled={!canUse || !newValue.trim()}
          >
            {t("writeSn")}
          </Button>
        </Group>
        {readError && (
          <Alert color="red" variant="light" p="sm" mt={8}>
            <Text fz={12}>{readError}</Text>
          </Alert>
        )}
      </section>

      <section className="flasher-card">
        <Text fw={600} fz={13} mb={12}>
          {t("snConfigTitle")}
        </Text>
        <Stack gap={10}>
          <TextInput
            size="xs"
            label={t("snAddress")}
            value={`0x${state.snConfig.address.toString(16).toUpperCase()}`}
            onChange={(e) => {
              const v = e.currentTarget.value.trim();
              const num = v.startsWith("0x") ? parseInt(v, 16) : parseInt(v, 10);
              if (!isNaN(num) && num >= 0) state.setSnConfig({ address: num });
            }}
            styles={{ input: { fontFamily: "monospace" } }}
          />
          <Group grow>
            <Select
              size="xs"
              label={t("snFormat")}
              value={state.snConfig.format}
              onChange={(value) => state.setSnConfig({ format: (value ?? "ascii") as SnFormat })}
              data={FORMAT_OPTIONS}
            />
            <Select
              size="xs"
              label={t("snChecksum")}
              value={state.snConfig.checksum}
              onChange={(value) => state.setSnConfig({ checksum: (value ?? "none") as "none" | "crc16" | "crc32" })}
              data={CHECKSUM_OPTIONS}
            />
          </Group>
          <Group grow>
            {needsLength ? (
              <NumberInput
                size="xs"
                label={t("snLength")}
                value={state.snConfig.length ?? 0}
                onChange={(value) => state.setSnConfig({ length: Number(value ?? 0) })}
                min={1}
              />
            ) : (
              <Select
                size="xs"
                label={t("snEndian")}
                value={state.snConfig.endian}
                onChange={(value) => state.setSnConfig({ endian: (value ?? "little") as "little" | "big" })}
                data={[
                  { value: "little", label: "Little Endian" },
                  { value: "big", label: "Big Endian" },
                ]}
              />
            )}
            <Checkbox
              size="xs"
              label="OTP（写后不可改）"
              mt={26}
              checked={false}
              disabled
              onChange={() => undefined}
            />
          </Group>
          <Tooltip label={t("snOtpHint")} multiline w={240}>
            <Text fz={11} c="dimmed">
              {t("snAddressHint")}
            </Text>
          </Tooltip>
        </Stack>
      </section>
    </div>
  );
}
