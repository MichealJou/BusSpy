import { useEffect, useState } from "react";
import { Button } from "@mantine/core";
import { Download, Info, Save } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { EnvironmentPanel, ProductionPanel, ProgramPanel, SnToolPanel } from "../../features/flasher/components";
import { useFlasher } from "../../features/flasher/hooks";
import { useI18n } from "../../i18n";
import { AboutDialog } from "../../components/update/AboutDialog";
import { BrandThemePicker } from "../../components/app-shell";

type FlasherTab = "program" | "sn" | "production";

export function FlasherView() {
  const { t } = useI18n();
  const flasher = useFlasher();
  const [tab, setTab] = useState<FlasherTab>("program");
  const [aboutOpened, setAboutOpened] = useState(false);
  const [appVersion, setAppVersion] = useState("0.1.0");

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("0.1.0"));
  }, []);

  const running = flasher.run.running || flasher.productionRunning;
  const busyLabel = flasher.run.running
    ? (flasher.run.phase === "program" ? t("phaseProgram")
      : flasher.run.phase === "erase" ? t("phaseErase")
      : flasher.run.phase === "verify" ? t("phaseVerify")
      : t("phaseConnecting"))
    : t("productionRunningLabel");
  const deviceLabel = flasher.connectionMode === "swd"
    ? (flasher.selectedProbe?.product || flasher.selectedProbe?.uniqueId || null)
    : flasher.selectedPort;

  function saveFlashLogs() {
    if (flasher.flashLogs.length === 0) return;
    const blob = new Blob([flasher.flashLogs.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `busspy-flash-${Date.now()}.log`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportProductionCsv() {
    if (flasher.productionRecords.length === 0) return;
    const exportedAt = new Date().toLocaleString();
    const rows = [
      ["时间", "结果", "设备", "SN", "耗时(ms)", "信息"],
      ...flasher.productionRecords.map((record) => [
        exportedAt,
        record.ok ? "OK" : "FAIL",
        record.product || record.probeId,
        record.sn,
        String(record.durationMs),
        record.message,
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `busspy-production-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <header className="toolbar toolbar-brand flasher-toolbar">
        <div className="brand-logo">B</div>
        <div className="brand-title">
          <span className="brand-name">BusSpy {t("flasherTitle")}</span>
          <span className="brand-sub">{t("flasherSubtitle")} · v{appVersion}</span>
        </div>
        <div className="toolbar-actions">
          <Button className="tool-button" variant="subtle" color="gray" leftSection={<Save size={15} />} onClick={saveFlashLogs} disabled={flasher.flashLogs.length === 0}>
            {t("saveLog")}
          </Button>
          <Button className="tool-button" variant="subtle" color="gray" leftSection={<Download size={15} />} onClick={exportProductionCsv} disabled={flasher.productionRecords.length === 0}>
            {t("exportCsv")}
          </Button>
          <BrandThemePicker />
          <Button className="tool-button compact-tool" variant="subtle" color="gray" leftSection={<Info size={15} />} onClick={() => setAboutOpened(true)}>
            {t("about")}
          </Button>
        </div>
      </header>

      <main className="workspace flasher-workspace">
        <EnvironmentPanel state={flasher} />
        <div className="flasher-tabbar">
          <button type="button" className={`flasher-tab${tab === "program" ? " active" : ""}`} onClick={() => setTab("program")}>
            {t("singleFlash")}
          </button>
          <button type="button" className={`flasher-tab${tab === "sn" ? " active" : ""}`} onClick={() => setTab("sn")}>
            {t("snTool")}
          </button>
          <button type="button" className={`flasher-tab${tab === "production" ? " active" : ""}`} onClick={() => setTab("production")}>
            {t("productionMode")}
          </button>
        </div>
        {tab === "program" && <ProgramPanel state={flasher} />}
        {tab === "sn" && <SnToolPanel state={flasher} />}
        {tab === "production" && <ProductionPanel state={flasher} />}
      </main>

      <footer className="statusbar flasher-statusbar">
        <span>
          {t("status")}：
          <span className={running ? "status-dot busy" : "status-dot ok"} />
          {running ? busyLabel : t("statusIdle")}
        </span>
        <span>{t("device")}：{deviceLabel ?? "-"}</span>
        <span>v{appVersion}</span>
      </footer>

      <AboutDialog opened={aboutOpened} onClose={() => setAboutOpened(false)} section="about" />
    </>
  );
}
