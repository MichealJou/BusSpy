import { useI18n } from "../../i18n";

interface StatusBarProps {
  isConnected: boolean;
  rxBytes: number;
  txBytes: number;
  connectionSummary: string;
  appVersion: string;
}

export function StatusBar({ isConnected, rxBytes, txBytes, connectionSummary, appVersion }: StatusBarProps) {
  const { t } = useI18n();

  return (
    <footer className="statusbar">
      <span>{t("status")}：{isConnected ? t("portOpened") : t("waitingConnect")}</span>
      <span>RX {rxBytes} B</span>
      <span>TX {txBytes} B</span>
      <span>{connectionSummary}</span>
      <span>v{appVersion}</span>
    </footer>
  );
}
