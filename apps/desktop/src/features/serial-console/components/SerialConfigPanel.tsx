import { Badge, Button, Group, Select, Stack, Switch, Text, TextInput } from "@mantine/core";
import { Pause, Play, RefreshCw } from "lucide-react";
import { HelpTip } from "../../../components/help/HelpTip";
import { useI18n } from "../../../i18n";
import { baudRates, dataBits, parities, stopBits } from "../lib/constants";
import type { SerialConsoleState } from "../lib/types";

interface SerialConfigPanelProps {
  state: SerialConsoleState;
}

export function SerialConfigPanel({ state }: SerialConfigPanelProps) {
  const { t } = useI18n();

  return (
    <aside className="sidebar">
      <div className="config-card">
        <Group gap="xs" className="title-with-help">
          <Text className="card-title">{t("connectionSettings")}</Text>
          <HelpTip label={t("connectionHelp")} />
        </Group>
        <Stack className="config-fields">
          <Select
            label={t("port")}
            placeholder={t("selectPort")}
            data={state.connectionOptions}
            value={state.selectedConnection}
            onChange={state.setSelectedConnection}
            disabled={state.isConnected}
          />

          {state.transportMode === "serial" ? (
            <>
              <Select label={t("baudRate")} data={baudRates} value={state.baudRate} onChange={(value) => state.setBaudRate(value ?? "115200")} disabled={state.isConnected} />
              <Select label={t("parity")} data={parities} value={state.parity} onChange={(value) => state.setParity(value ?? "None")} disabled={state.isConnected} />
              <Group grow className="mini-field-row">
                <Select label={t("dataBits")} data={dataBits} value={state.dataBit} onChange={(value) => state.setDataBit(value ?? "8")} disabled={state.isConnected} />
                <Select label={t("stopBits")} data={stopBits} value={state.stopBit} onChange={(value) => state.setStopBit(value ?? "1")} disabled={state.isConnected} />
              </Group>
              <Text className="subsection-title">{t("serialAdvanced")}</Text>
              <Group grow className="mini-field-row">
                <Group gap="xs">
                  <Switch label="RTS" checked={state.rts} onChange={(event) => state.setRts(event.currentTarget.checked)} disabled={state.isConnected} />
                  <HelpTip label={t("rtsHelp")} />
                </Group>
                <Group gap="xs">
                  <Switch label="DTR" checked={state.dtr} onChange={(event) => state.setDtr(event.currentTarget.checked)} disabled={state.isConnected} />
                  <HelpTip label={t("dtrHelp")} />
                </Group>
              </Group>
            </>
          ) : null}

          {state.transportMode === "tcp-client" ? (
            <>
              <TextInput label={t("remoteHost")} value={state.remoteHost} onChange={(event) => state.setRemoteHost(event.currentTarget.value)} disabled={state.isConnected} />
              <TextInput label={t("remotePort")} value={state.remotePort} onChange={(event) => state.setRemotePort(event.currentTarget.value)} disabled={state.isConnected} />
            </>
          ) : null}

          {state.transportMode === "tcp-server" ? (
            <TextInput label={t("listenPort")} value={state.localPort} onChange={(event) => state.setLocalPort(event.currentTarget.value)} disabled={state.isConnected} />
          ) : null}

          {state.transportMode === "udp" ? (
            <>
              <TextInput label={t("localPort")} value={state.localPort} onChange={(event) => state.setLocalPort(event.currentTarget.value)} disabled={state.isConnected} />
              <TextInput label={t("remoteHost")} value={state.remoteHost} onChange={(event) => state.setRemoteHost(event.currentTarget.value)} disabled={state.isConnected} />
              <TextInput label={t("remotePort")} value={state.remotePort} onChange={(event) => state.setRemotePort(event.currentTarget.value)} disabled={state.isConnected} />
            </>
          ) : null}
        </Stack>
        <div className="card-separator" />
        <Button
          className="connect-button"
          color={state.isConnected ? "red" : "blue"}
          leftSection={state.isConnected ? <Pause size={16} /> : <Play size={16} />}
          onClick={() => void state.connectOrClose()}
          disabled={(state.transportMode === "serial" && !state.port) || state.isBusy}
          loading={state.isBusy}
        >
          {state.isConnected ? t("disconnect") : t("connect")}
        </Button>
        {state.transportMode === "serial" ? (
          <Button className="refresh-button" variant="light" color="gray" leftSection={<RefreshCw size={16} />} onClick={() => void state.refreshPorts()} disabled={state.isConnected}>
            {t("refreshPorts")}
          </Button>
        ) : null}
        <Group gap="xs" className="connection-state">
          <Badge color={state.isConnected ? "green" : "red"} variant="light">
            {state.isConnected ? t("connected") : t("disconnected")}
          </Badge>
          <Text size="sm" c="dimmed">
            {state.transportMode === "serial" ? state.port ?? t("noPort") : connectionLabel(state)}
          </Text>
        </Group>
        {state.lastError ? (
          <Text size="xs" c="red" className="error-note">
            {state.lastError}
          </Text>
        ) : null}
      </div>
    </aside>
  );
}

function connectionLabel(state: SerialConsoleState) {
  if (state.transportMode === "tcp-server") {
    return `:${state.localPort}`;
  }
  if (state.transportMode === "udp") {
    return `:${state.localPort} -> ${state.remoteHost}:${state.remotePort}`;
  }
  return `${state.remoteHost}:${state.remotePort}`;
}
