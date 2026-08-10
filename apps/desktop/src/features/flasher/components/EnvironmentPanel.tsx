import { useState } from "react";
import { Alert, Badge, Button, Group, Loader, Select, Stack, Text, ThemeIcon, Tooltip } from "@mantine/core";
import { Check, CircleX, Database, RefreshCw, Wrench } from "lucide-react";
import { useI18n } from "../../../i18n";
import type { FlasherStore } from "../lib/types";

interface EnvironmentPanelProps {
  state: FlasherStore;
}

const MIRROR_LABELS: Record<string, string> = {
  tuna: "清华 TUNA",
  aliyun: "阿里云",
  ustc: "中科大 USTC",
  official: "官方 PyPI",
};

export function EnvironmentPanel({ state }: EnvironmentPanelProps) {
  const { t } = useI18n();
  const [mirror, setMirror] = useState("tuna");

  const ready = Boolean(state.status?.ready);
  const pyocdOk = Boolean(state.status?.pyocd?.installed);
  const pyserialOk = Boolean(state.status?.pyserial?.installed);
  const mode = state.status?.mode ?? "python3";

  return (
    <section className="flasher-card env-panel">
      <Group justify="space-between" mb={8}>
        <Group gap={8}>
          <ThemeIcon variant="light" color="blue" radius="md" size="md">
            <Database size={16} />
          </ThemeIcon>
          <Text fw={600} fz={14}>
            {t("envCheck")}
          </Text>
          {state.checking && <Loader size={14} />}
        </Group>
        <Button
          size="compact-xs"
          variant="subtle"
          leftSection={<RefreshCw size={13} />}
          onClick={() => void state.checkEnvironment()}
          disabled={state.checking}
        >
          {t("recheck")}
        </Button>
      </Group>

      {ready ? (
        <Group gap={6} mb={10}>
          <Badge color="green" variant="light">
            {t("envReady")}
          </Badge>
          <Badge color={pyocdOk ? "green" : "red"} variant="light">
            pyocd {pyocdOk ? state.status?.pyocd?.version ?? "" : "✗"}
          </Badge>
          <Badge color={pyserialOk ? "green" : "red"} variant="light">
            pyserial {pyserialOk ? state.status?.pyserial?.version ?? "" : "✗"}
          </Badge>
          <Badge variant="default">{mode}</Badge>
        </Group>
      ) : (
        <>
          <Alert color="orange" variant="light" icon={<CircleX size={16} />} mb={10} p="sm">
            <Text fz={13}>
              {state.status?.python ? t("envMissingDetail") : t("envNoPython")}
            </Text>
          </Alert>
          <Stack gap={8}>
            <Select
              size="xs"
              label={t("mirror")}
              data={Object.entries(MIRROR_LABELS).map(([value, label]) => ({
                value,
                label: `${label} · ${value}`,
              }))}
              value={mirror}
              onChange={(value) => setMirror(value ?? "tuna")}
              searchable
              allowDeselect={false}
              disabled={state.bootstrapping}
            />
            <Group gap={8}>
              <Button
                size="xs"
                leftSection={<Wrench size={14} />}
                onClick={() => void state.bootstrap(mirror)}
                loading={state.bootstrapping}
              >
                {t("initEnv")}
              </Button>
              {state.bootstrapping && (
                <Text fz={12} c="dimmed">
                  {t("bootstrapping")}
                </Text>
              )}
            </Group>
          </Stack>
        </>
      )}

      {state.error && (
        <Alert color="red" variant="light" p="sm" mt={8}>
          <Text fz={12}>{state.error}</Text>
        </Alert>
      )}

      {state.bootstrapLogs.length > 0 && (
        <pre className="bootstrap-log">{state.bootstrapLogs.join("\n")}</pre>
      )}
      {state.bootstrapSuccess !== null && (
        <Group gap={6} mt={6}>
          {state.bootstrapSuccess ? (
            <Tooltip label={t("envReady")}>
              <Check size={16} color="#2f9e44" />
            </Tooltip>
          ) : (
            <CircleX size={16} color="#e03131" />
          )}
          <Text fz={12} c="dimmed">
            {state.bootstrapSuccess ? t("bootstrapDone") : t("bootstrapFailed")}
          </Text>
        </Group>
      )}
    </section>
  );
}
