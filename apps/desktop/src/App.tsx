import { useState } from "react";
import { I18nProvider } from "./i18n";
import { UpdateChecker } from "./components/update/UpdateChecker";
import { AppSidebar, type ToolId } from "./components/app-shell/AppSidebar";
import { SerialConsoleView } from "./views/serial-console";
import { FlasherView } from "./views/flasher";
import { SettingsView } from "./views/settings/SettingsView";

export function App() {
  const [activeTool, setActiveTool] = useState<ToolId>("serial");

  return (
    <I18nProvider>
      <UpdateChecker />
      <div className="app-shell">
        <AppSidebar activeTool={activeTool} onChange={setActiveTool} />
        {activeTool === "serial" && <SerialConsoleView />}
        {/* FlasherView 常驻渲染：display:contents 保持 grid 子节点布局，
            隐藏时仅视觉隐藏。这样环境自检/器件/Pack 只在首次进入烧录页初始化一次，
            切走再切回不重复检测、不丢已选器件/固件。 */}
        <div style={{ display: activeTool === "flasher" ? "contents" : "none" }}>
          <FlasherView />
        </div>
        {activeTool === "settings" && <SettingsView />}
      </div>
    </I18nProvider>
  );
}
