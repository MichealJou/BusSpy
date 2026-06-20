import { Button, Menu, Select } from "@mantine/core";
import { Copy, Download, Eraser, FileText, Info, RefreshCw, Rocket, Save, ShieldCheck, TerminalSquare } from "lucide-react";
import { useI18n, type Language } from "../../i18n";
import { openExternalUrl } from "../../tauri";

const RELEASES_URL = "https://github.com/MichealJou/BusSpy/releases";

interface AppToolbarProps {
  hasLogs: boolean;
  onDownloadLogs: () => void;
  onExportData: () => void;
  onCopyLogs: () => void;
  onClearLogs: () => void;
  onOpenAbout: (section: "about" | "protocol" | "policy") => void;
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
      <Menu shadow="md" width={190} position="bottom-start">
        <Menu.Target>
          <Button className="tool-button compact-tool" variant="subtle" color="gray" leftSection={<Info size={16} />}>
            {t("about")}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<Info size={15} />} onClick={() => onOpenAbout("about")}>
            {t("aboutBusSpy")}
          </Menu.Item>
          <Menu.Item
            leftSection={<RefreshCw size={15} />}
            onClick={() => {
              window.dispatchEvent(new Event("busspy:check-update"));
            }}
          >
            {t("checkUpdates")}
          </Menu.Item>
          <Menu.Item leftSection={<FileText size={15} />} onClick={() => onOpenAbout("protocol")}>
            {t("releaseProtocol")}
          </Menu.Item>
          <Menu.Item leftSection={<ShieldCheck size={15} />} onClick={() => onOpenAbout("policy")}>
            {t("updatePolicy")}
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item leftSection={<Rocket size={15} />} onClick={() => void openExternalUrl(RELEASES_URL)}>
            {t("openReleases")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
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
