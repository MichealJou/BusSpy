import { useState } from "react";
import { Alert, Badge, Button, Group, Loader, Select, Text } from "@mantine/core";
import { RefreshCw, Wrench } from "lucide-react";
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

/** 顶部环境状态条：就绪徽章 + 依赖状态 + 重新检测 / 缺失时一键初始化 */
export function EnvironmentPanel({ state }: EnvironmentPanelProps) {
  const { t } = useI18n();
  const [mirror, setMirror] = useState("tuna");
  const [initOpened, setInitOpened] = useState(false);

  const ready = Boolean(state.status?.ready);
  const pyocdOk = Boolean(state.status?.pyocd?.installed);
  const pyserialOk = Boolean(state.status?.pyserial?.installed);
  const mode = state.status?.mode ?? "python3";

  return (
    <div className="env-bar">
      <Group gap={8} wrap="nowrap">
        {state.checking ? (
          <Loader size={15} />
        ) : ready ? (
          <span className="env-dot env-dot-ok" />
        ) : (
          <span className="env-dot env-dot-bad" />
        )}
        <Text fw={600} fz={13} style={{ whiteSpace: "nowrap" }}>
          {t("envCheck")}
        </Text>
        {ready ? (
          <>
            <Badge color="green" variant="light" size="sm">
              {t("envReady")}
            </Badge>
            <Badge color={pyocdOk ? "green" : "red"} variant="light" size="sm">
              pyocd {pyocdOk ? state.status?.pyocd?.version ?? "" : "✗"}
            </Badge>
            <Badge color={pyserialOk ? "green" : "red"} variant="light" size="sm">
              pyserial {pyserialOk ? state.status?.pyserial?.version ?? "" : "✗"}
            </Badge>
            <Badge variant="default" size="sm">
              {mode}
            </Badge>
            {state.status?.python && (
              <Text fz={11} c="dimmed" className="ellipsis" title={state.status.python} style={{ maxWidth: 260 }}>
                {state.status.python}
              </Text>
            )}
          </>
        ) : (
          <>
            <Text fz={12} c="dimmed">
              {state.status?.python ? t("envMissingDetail") : t("envNoPython")}
            </Text>
            {initOpened ? (
              <Group gap={6} wrap="nowrap">
                <Select
                  size="xs"
                  style={{ width: 140 }}
                  value={mirror}
                  onChange={(value) => setMirror(value ?? "tuna")}
                  data={Object.entries(MIRROR_LABELS).map(([value, label]) => ({
                    value,
                    label: `${label} · ${value}`,
                  }))}
                  allowDeselect={false}
                  disabled={state.bootstrapping}
                />
                <Button
                  size="xs"
                  leftSection={<Wrench size={13} />}
                  onClick={() => void state.bootstrap(mirror)}
                  loading={state.bootstrapping}
                >
                  {t("initEnv")}
                </Button>
              </Group>
            ) : (
              <Button size="compact-xs" variant="light" onClick={() => setInitOpened(true)}>
                {t("initEnv")}
              </Button>
            )}
          </>
        )}
        <Button
          size="compact-xs"
          variant="subtle"
          leftSection={<RefreshCw size={12} />}
          onClick={() => void state.checkEnvironment()}
          disabled={state.checking}
        >
          {t("recheck")}
        </Button>
      </Group>

      {state.error && (
        <Alert color="red" variant="light" p="sm" mt={8}>
          <Text fz={12}>{state.error}</Text>
        </Alert>
      )}
      {state.bootstrapLogs.length > 0 && <pre className="bootstrap-log">{state.bootstrapLogs.join("\n")}</pre>}
      {state.bootstrapping && (
        <Text fz={12} c="dimmed" mt={6}>
          {t("bootstrapping")}
        </Text>
      )}
    </div>
  );
}
