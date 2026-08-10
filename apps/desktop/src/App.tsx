import { useState } from "react";
import { I18nProvider } from "./i18n";
import { UpdateChecker } from "./components/update/UpdateChecker";
import { AppSidebar, type ToolId } from "./components/app-shell/AppSidebar";
import { SerialConsoleView } from "./views/serial-console";
import { FlasherView } from "./views/flasher";

export function App() {
  const [activeTool, setActiveTool] = useState<ToolId>("serial");

  return (
    <I18nProvider>
      <UpdateChecker />
      <div className="app-shell">
        <AppSidebar activeTool={activeTool} onChange={setActiveTool} />
        {activeTool === "serial" && <SerialConsoleView />}
        {activeTool === "flasher" && <FlasherView />}
        {activeTool === "settings" && <main className="workspace">设置页开发中</main>}
      </div>
    </I18nProvider>
  );
}
