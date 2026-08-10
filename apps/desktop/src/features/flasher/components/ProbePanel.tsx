import { Badge, Button, Group, Text, ThemeIcon } from "@mantine/core";
import { RefreshCw, Usb, CircleAlert } from "lucide-react";
import { useI18n } from "../../../i18n";
import type { FlasherStore } from "../lib/types";

interface ProbePanelProps {
  state: FlasherStore;
}

export function ProbePanel({ state }: ProbePanelProps) {
  const { t } = useI18n();

  return (
    <section className="flasher-card probe-panel">
      <Group justify="space-between" mb={8}>
        <Group gap={8}>
          <ThemeIcon variant="light" color="green" radius="md" size="md">
            <Usb size={16} />
          </ThemeIcon>
          <Text fw={600} fz={14}>
            {t("probes")}
          </Text>
        </Group>
        <Button
          size="compact-xs"
          variant="subtle"
          leftSection={<RefreshCw size={13} />}
          onClick={() => void state.refreshProbes()}
          loading={state.refreshing}
          disabled={!state.status?.ready}
        >
          {t("refresh")}
        </Button>
      </Group>

      {state.probes.length === 0 ? (
        <Group gap={6} c="dimmed">
          <CircleAlert size={15} />
          <Text fz={13}>{t("noProbe")}</Text>
        </Group>
      ) : (
        state.probes.map((probe) => (
          <div key={probe.uniqueId || probe.id} className="probe-row">
            <span className="probe-dot" title={t("probeConnected")} />
            <div className="probe-info">
              <Text fz={13} fw={500}>
                {probe.product || probe.id || probe.uniqueId}
              </Text>
              <Text fz={11} c="dimmed">
                {[probe.vendor, probe.uniqueId].filter(Boolean).join(" · ")}
              </Text>
            </div>
            {probe.protocols.length > 0 && (
              <Badge variant="default" size="xs">
                {probe.protocols.join(" / ")}
              </Badge>
            )}
          </div>
        ))
      )}
    </section>
  );
}
