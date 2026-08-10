import { Flame, Settings, TerminalSquare } from "lucide-react";
import { useI18n, type TranslationKey } from "../../i18n";

export type ToolId = "serial" | "flasher" | "settings";

interface AppSidebarProps {
  activeTool: ToolId;
  onChange: (tool: ToolId) => void;
}

const TOOL_ITEMS: Array<{ id: ToolId; icon: typeof TerminalSquare; label: TranslationKey }> = [
  { id: "serial", icon: TerminalSquare, label: "serialAssistant" },
  { id: "flasher", icon: Flame, label: "flasher" },
  { id: "settings", icon: Settings, label: "settings" },
];

export function AppSidebar({ activeTool, onChange }: AppSidebarProps) {
  const { t } = useI18n();

  return (
    <aside className="app-sidebar">
      <nav className="sidebar-items">
        {TOOL_ITEMS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            className={`sidebar-item${activeTool === id ? " active" : ""}`}
            title={t(label)}
            onClick={() => onChange(id)}
          >
            <Icon size={20} strokeWidth={1.8} />
            <span className="sidebar-item-label">{t(label)}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">v{/* 版本由主内容区状态栏展示 */}</div>
    </aside>
  );
}
