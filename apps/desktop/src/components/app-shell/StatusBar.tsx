import { useI18n } from "../../i18n";

interface StatusBarProps {
  isConnected: boolean;
  rxBytes: number;
  txBytes: number;
  connectionSummary: string;
}

export function StatusBar({ isConnected, rxBytes, txBytes, connectionSummary }: StatusBarProps) {
  const { t } = useI18n();

  return (
    <footer className="statusbar">
      <span>{t("status")}：{isConnected ? t("portOpened") : t("waitingConnect")}</span>
      <span>RX {rxBytes} B</span>
      <span>TX {txBytes} B</span>
      <span>{connectionSummary}</span>
    </footer>
  );
}
