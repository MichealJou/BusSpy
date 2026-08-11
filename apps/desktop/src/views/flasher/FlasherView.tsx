import { useState } from "react";
import { Tabs } from "@mantine/core";
import { EnvironmentPanel, ProductionPanel, ProgramPanel, SnToolPanel } from "../../features/flasher/components";
import { useFlasher } from "../../features/flasher/hooks";
import { useI18n } from "../../i18n";

type FlasherTab = "program" | "sn" | "production";

export function FlasherView() {
  const { t } = useI18n();
  const flasher = useFlasher();
  const [tab, setTab] = useState<FlasherTab>("program");

  return (
    <>
      <header className="toolbar flasher-toolbar">
        <Tabs value={tab} onChange={(value) => setTab((value as FlasherTab) ?? "program")}>
          <Tabs.List>
            <Tabs.Tab value="program">{t("singleFlash")}</Tabs.Tab>
            <Tabs.Tab value="sn">{t("snTool")}</Tabs.Tab>
            <Tabs.Tab value="production">{t("productionMode")}</Tabs.Tab>
          </Tabs.List>
        </Tabs>
      </header>

      <main className="workspace flasher-workspace">
        <EnvironmentPanel state={flasher} />
        {tab === "program" && <ProgramPanel state={flasher} />}
        {tab === "sn" && <SnToolPanel state={flasher} />}
        {tab === "production" && <ProductionPanel state={flasher} />}
      </main>
    </>
  );
}
