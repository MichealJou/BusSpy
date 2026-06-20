import { Button, Select } from "@mantine/core";
import { Copy, Download, Eraser, Info, Save, TerminalSquare } from "lucide-react";
import { useI18n, type Language } from "../../i18n";

interface AppToolbarProps {
  hasLogs: boolean;
  onDownloadLogs: () => void;
  onExportData: () => void;
  onCopyLogs: () => void;
  onClearLogs: () => void;
  onOpenAbout: () => void;
}

export function AppToolbar({ hasLogs, onDownloadLogs, onExportData, onCopyLogs, onClearLogs, onOpenAbout }: AppToolbarProps) {
  const { language, setLanguage, t } = useI18n();

  return (
    <nav className="toolbar">
      <Button className="tool-button active" variant="subtle" color="blue" leftSection={<TerminalSquare size={16} />}>
        {t("serialAssistant")}
      </Button>
      <Button className="tool-button" variant="subtle" color="gray" leftSection={<Save size={16} />} onClick={onDownloadLogs} disabled={!hasLogs}>
        {t("saveLog")}
      </Button>
      <Button className="tool-button" variant="subtle" color="gray" leftSection={<Download size={16} />} onClick={onExportData} disabled={!hasLogs}>
        {t("exportData")}
      </Button>
      <Button className="tool-button" variant="subtle" color="gray" leftSection={<Copy size={16} />} onClick={onCopyLogs} disabled={!hasLogs}>
        {t("copyData")}
      </Button>
      <Button className="tool-button compact-tool" variant="subtle" color="gray" leftSection={<Eraser size={16} />} onClick={onClearLogs}>
        {t("clear")}
      </Button>
      <Button className="tool-button compact-tool" variant="subtle" color="gray" leftSection={<Info size={16} />} onClick={onOpenAbout}>
        {t("about")}
      </Button>
      <Select
        className="language-select"
        aria-label={t("language")}
        data={[
          { value: "zh", label: t("zh") },
          { value: "en", label: t("en") },
        ]}
        value={language}
        onChange={(value) => setLanguage((value ?? "zh") as Language)}
      />
    </nav>
  );
}
