import { useState } from "react";
import { Badge, Button, Group, Loader, Select, Text, Tooltip } from "@mantine/core";
import { CircleCheck, CircleX, RefreshCw, Wrench } from "lucide-react";
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

/** 环境状态：一个状态图标 + 就绪/未就绪 + 重新检测（未就绪时提供一键初始化） */
export function EnvironmentPanel({ state }: EnvironmentPanelProps) {
  const { t } = useI18n();
  const [mirror, setMirror] = useState("tuna");
  const [initOpened, setInitOpened] = useState(false);

  const ready = Boolean(state.status?.ready);
  const pyocdOk = Boolean(state.status?.pyocd?.installed);
  const pyserialOk = Boolean(state.status?.pyserial?.installed);
  const mode = state.status?.mode ?? "python3";
  const detail = state.status?.pyocd?.version ?? "";

  return (
    <div className="env-bar env-bar-mini">
      <Group gap={10} wrap="nowrap">
        {state.checking ? (
          <Loader size={16} />
        ) : ready ? (
          <CircleCheck size={16} color="#37b24d" />
        ) : (
          <CircleX size={16} color="#e03131" />
        )}
        <Text fw={600} fz={13}>
          {ready ? t("envReady") : t("envNotReady")}
        </Text>

        {ready && (
          <Tooltip
            label={`pyocd ${pyocdOk ? detail : "✗"} · pyserial ${pyserialOk ? "✓" : "✗"} · ${mode}`}
            openDelay={300}
          >
            <Badge variant="default" size="xs">
              {mode}
            </Badge>
          </Tooltip>
        )}

        <Button size="compact-xs" variant="subtle" leftSection={<RefreshCw size={12} />} onClick={() => void state.checkEnvironment()} disabled={state.checking}>
          {t("recheck")}
        </Button>

        {!ready && !state.bootstrapping && !initOpened && (
          <Button size="compact-xs" variant="light" leftSection={<Wrench size={12} />} onClick={() => setInitOpened(true)}>
            {t("initEnv")}
          </Button>
        )}
        {!ready && initOpened && (
          <Group gap={6} wrap="nowrap">
            <Select
              size="xs"
              style={{ width: 140 }}
              value={mirror}
              onChange={(value) => setMirror(value ?? "tuna")}
              data={Object.entries(MIRROR_LABELS).map(([value, label]) => ({ value, label: `${label} · ${value}` }))}
              allowDeselect={false}
              disabled={state.bootstrapping}
            />
            <Button size="xs" leftSection={<Wrench size={13} />} onClick={() => void state.bootstrap(mirror)} loading={state.bootstrapping}>
              {t("initEnv")}
            </Button>
          </Group>
        )}
      </Group>

      {state.bootstrapLogs.length > 0 && <pre className="bootstrap-log">{state.bootstrapLogs.join("\n")}</pre>}
      {state.bootstrapping && (
        <Text fz={12} c="dimmed" mt={6}>
          {t("bootstrapping")}
        </Text>
      )}
    </div>
  );
}
