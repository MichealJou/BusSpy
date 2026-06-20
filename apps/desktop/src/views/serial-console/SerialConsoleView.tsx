import { useState } from "react";
import { AppToolbar, StatusBar } from "../../components/app-shell";
import { AboutDialog } from "../../components/update/AboutDialog";
import { ReceivePanel, SendPanel, SerialConfigPanel } from "../../features/serial-console/components";
import { useSerialConsole } from "../../features/serial-console/hooks";
import { useI18n } from "../../i18n";

export function SerialConsoleView() {
  const { t } = useI18n();
  const serial = useSerialConsole(t);
  const [aboutOpened, setAboutOpened] = useState(false);

  return (
    <div className="app-shell">
      <AboutDialog opened={aboutOpened} onClose={() => setAboutOpened(false)} />
      <AppToolbar
        hasLogs={serial.logs.length > 0}
        onDownloadLogs={serial.downloadLogs}
        onExportData={serial.exportData}
        onCopyLogs={() => void serial.copyLogs()}
        onClearLogs={serial.clearLogs}
        onOpenAbout={() => setAboutOpened(true)}
      />

      <main className="workspace">
        <SerialConfigPanel state={serial} />
        <section className="panel" ref={serial.panelRef}>
          <ReceivePanel state={serial} />
          <SendPanel state={serial} />
        </section>
      </main>

      <StatusBar
        isConnected={serial.isConnected}
        rxBytes={serial.rxBytes}
        txBytes={serial.txBytes}
        connectionSummary={connectionSummary(serial)}
      />
    </div>
  );
}

function connectionSummary(serial: ReturnType<typeof useSerialConsole>) {
  if (serial.transportMode === "serial") {
    return `${serial.baudRate} / ${serial.dataBit}${serial.parity === "None" ? "N" : serial.parity[0]}${serial.stopBit}`;
  }
  if (serial.transportMode === "tcp-server") {
    return `TCP Server :${serial.localPort}`;
  }
  if (serial.transportMode === "udp") {
    return `UDP :${serial.localPort} -> ${serial.remoteHost}:${serial.remotePort}`;
  }
  return `TCP Client ${serial.remoteHost}:${serial.remotePort}`;
}
