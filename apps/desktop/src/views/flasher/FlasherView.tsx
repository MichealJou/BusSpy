import { useState } from "react";
import { Tabs } from "@mantine/core";
import { EnvironmentPanel, ProbePanel } from "../../features/flasher/components";
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
        {tab === "program" && (
          <div className="flasher-grid">
            <EnvironmentPanel state={flasher} />
            <ProbePanel state={flasher} />
            {/* S2：器件选择 / 固件选择 / 配置参数 / 烧录进度卡片在此接入 */}
            <section className="flasher-card flasher-placeholder">
              <span>①② 连接方式 · ③ 固件 · ④ 配置参数与烧录 —— S2 接入</span>
            </section>
          </div>
        )}
        {tab === "sn" && (
          <section className="flasher-card flasher-placeholder">
            <span>SN 工具 —— S3 接入（读 / 写 / 修改序列号）</span>
          </section>
        )}
        {tab === "production" && (
          <section className="flasher-card flasher-placeholder">
            <span>量产模式 —— S4 接入（批量队列 / 自动 SN / 防重复 / 导出 CSV）</span>
          </section>
        )}
      </main>
    </>
  );
}
