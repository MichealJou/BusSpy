import { useMemo, useState } from "react";
import { Badge, Button, Checkbox, Group, NumberInput, ScrollArea, Select, Stack, Table, Text, TextInput, ThemeIcon } from "@mantine/core";
import { CircleCheck, CircleX, Download, Factory, Square } from "lucide-react";
import { useI18n } from "../../../i18n";
import type { FlasherStore, SnFormat } from "../lib/types";

interface ProductionPanelProps {
  state: FlasherStore;
}

export function ProductionPanel({ state }: ProductionPanelProps) {
  const { t } = useI18n();
  const [showSnConfig, setShowSnConfig] = useState(false);

  const { total, ok, fail } = state.productionStats;
  const rate = total > 0 ? Math.round((ok / total) * 1000) / 10 : 0;

  function exportCsv() {
    const rows = [
      ["时间", "结果", "设备", "SN", "耗时(ms)", "信息"],
      ...state.productionRecords.map((record) => [
        new Date().toLocaleString(),
        record.ok ? "OK" : "FAIL",
        record.product || record.probeId,
        record.sn,
        String(record.durationMs),
        record.message,
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `busspy-production-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const passRate = useMemo(() => rate, [rate]);

  return (
    <div className="flasher-grid production-grid">
      <section className="flasher-card">
        <Group gap={6} mb={12}>
          <ThemeIcon variant="light" color="orange" radius="sm" size={22}>
            <Factory size={14} />
          </ThemeIcon>
          <Text fw={600} fz={13}>
            {t("productionConfig")}
          </Text>
        </Group>
        <Stack gap={10}>
          <Text fz={12}>
            {t("device")}: <b>{state.selectedTarget ?? "-"}</b>
          </Text>
          <Text fz={12} className="path-break">
            {t("firmware")}: {state.firmwarePath ?? "-"}
          </Text>
          <Checkbox
            size="xs"
            label={t("productionSnEnabled")}
            checked={state.productionConfig.snEnabled}
            onChange={(event) => state.setProductionConfig({ snEnabled: event.currentTarget.checked })}
          />
          {state.productionConfig.snEnabled && (
            <Stack gap={8} className="sn-config-box">
              <Group grow>
                <Select
                  size="xs"
                  label={t("snFormat")}
                  value={state.productionConfig.snFormat}
                  onChange={(value) => state.setProductionConfig({ snFormat: (value ?? "ascii") as SnFormat })}
                  data={[
                    { value: "ascii", label: "ASCII" },
                    { value: "bcd", label: "BCD" },
                    { value: "uint32", label: "uint32" },
                    { value: "uint64", label: "uint64" },
                  ]}
                />
                <NumberInput
                  size="xs"
                  label={t("snStart")}
                  value={state.productionConfig.snStart}
                  onChange={(value) => state.setProductionConfig({ snStart: Number(value ?? 1) })}
                  min={0}
                />
              </Group>
              <Group grow>
                <NumberInput
                  size="xs"
                  label={t("snStep")}
                  value={state.productionConfig.snStep}
                  onChange={(value) => state.setProductionConfig({ snStep: Number(value ?? 1) })}
                  min={1}
                />
                <TextInput
                  size="xs"
                  label={t("snPrefix")}
                  value={state.productionConfig.snPrefix}
                  onChange={(event) => state.setProductionConfig({ snPrefix: event.currentTarget.value })}
                />
              </Group>
              <Group grow>
                <NumberInput
                  size="xs"
                  label={t("snAddress")}
                  value={state.productionConfig.snAddress}
                  onChange={(value) => state.setProductionConfig({ snAddress: Number(value ?? 0) })}
                  min={0}
                />
                <NumberInput
                  size="xs"
                  label={t("snLength")}
                  value={state.productionConfig.snLength ?? 0}
                  onChange={(value) => state.setProductionConfig({ snLength: Number(value ?? 0) })}
                  min={1}
                />
              </Group>
            </Stack>
          )}
          <Group gap={8}>
            <Button
              leftSection={state.productionRunning ? <Square size={14} /> : <Factory size={14} />}
              color={state.productionRunning ? "red" : "blue"}
              onClick={() => (state.productionRunning ? void state.productionStop() : void state.productionStart())}
              disabled={!state.selectedTarget || !state.firmwarePath}
            >
              {state.productionRunning ? t("productionStop") : t("productionStart")}
            </Button>
            <Button variant="light" size="xs" leftSection={<Download size={13} />} onClick={exportCsv} disabled={state.productionRecords.length === 0}>
              {t("exportCsv")}
            </Button>
          </Group>
        </Stack>
      </section>

      <section className="flasher-card">
        <Text fw={600} fz={13} mb={10}>
          {t("productionStats")}
        </Text>
        <Group gap={24} mb={8}>
          <StatItem label={t("total")} value={String(total)} />
          <StatItem label={t("ok")} value={String(ok)} color="#2f9e44" />
          <StatItem label={t("fail")} value={String(fail)} color="#e03131" />
          <StatItem label={t("passRate")} value={`${passRate}%`} />
        </Group>
        <Text fz={12} c="dimmed">
          {state.productionRunning ? t("productionRunningHint") : t("productionStoppedHint")}
        </Text>
      </section>

      <section className="flasher-card production-records-card">
        <Group justify="space-between" mb={8}>
          <Text fw={600} fz={13}>
            {t("productionRecords")}
          </Text>
          <Badge variant="light" size="xs">
            {state.productionRecords.length}
          </Badge>
        </Group>
        {state.productionRecords.length === 0 ? (
          <Text fz={12} c="dimmed">
            {t("productionEmpty")}
          </Text>
        ) : (
          <ScrollArea h={320}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("result")}</Table.Th>
                  <Table.Th>{t("device")}</Table.Th>
                  <Table.Th>SN</Table.Th>
                  <Table.Th>{t("duration")}</Table.Th>
                  <Table.Th>{t("message")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {state.productionRecords.map((record) => (
                  <Table.Tr key={record.id}>
                    <Table.Td>
                      {record.ok ? <CircleCheck size={15} color="#2f9e44" /> : <CircleX size={15} color="#e03131" />}
                    </Table.Td>
                    <Table.Td>{record.product || record.probeId}</Table.Td>
                    <Table.Td style={{ fontFamily: "monospace" }}>{record.sn}</Table.Td>
                    <Table.Td>{record.durationMs}ms</Table.Td>
                    <Table.Td className="path-break">{record.message}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </section>
    </div>
  );
}

function StatItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Stack gap={0}>
      <Text fz={11} c="dimmed">
        {label}
      </Text>
      <Text fz={20} fw={700} c={color}>
        {value}
      </Text>
    </Stack>
  );
}
