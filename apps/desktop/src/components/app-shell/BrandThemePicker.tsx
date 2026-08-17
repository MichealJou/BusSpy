import { useEffect, useState } from "react";
import { Button, Popover, UnstyledButton } from "@mantine/core";
import { Check, Palette } from "lucide-react";
import { useI18n } from "../../i18n";

interface BrandTheme {
  id: string;
  label: string;
  a: string;
  b: string;
}

const BRAND_THEMES: BrandTheme[] = [
  { id: "blue", label: "品牌蓝", a: "#578df5", b: "#4783ea" },
  { id: "green", label: "青绿", a: "#43cc8e", b: "#27ae68" },
  { id: "purple", label: "紫罗兰", a: "#9b7bf7", b: "#7a5af5" },
  { id: "orange", label: "活力橙", a: "#f7a94b", b: "#ef8f2c" },
  { id: "rose", label: "玫瑰红", a: "#f3796b", b: "#e8563f" },
  { id: "cyan", label: "天空青", a: "#45c6f0", b: "#219fd8" },
  { id: "slate", label: "石墨灰", a: "#64748b", b: "#475569" },
];

const DEFAULT_THEME = BRAND_THEMES[0];
const STORAGE_KEY = "busspy.brandTheme";

function applyTheme(theme: BrandTheme) {
  const root = document.documentElement;
  root.style.setProperty("--brand-a", theme.a);
  root.style.setProperty("--brand-b", theme.b);
}

/** 头部颜色切换：调色盘按钮 + 预设色板，选择立即生效并持久化 */
export function BrandThemePicker() {
  const { t } = useI18n();
  const [opened, setOpened] = useState(false);
  const [themeId, setThemeId] = useState(() => localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME.id);

  useEffect(() => {
    const saved = BRAND_THEMES.find((item) => item.id === localStorage.getItem(STORAGE_KEY));
    if (saved && saved.id !== DEFAULT_THEME.id) {
      applyTheme(saved);
    }
  }, []);

  function choose(theme: BrandTheme) {
    setThemeId(theme.id);
    localStorage.setItem(STORAGE_KEY, theme.id);
    applyTheme(theme);
    setOpened(false);
  }

  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" shadow="md" width={236}>
      <Popover.Target>
        <Button
          className="tool-button compact-tool"
          variant="subtle"
          color="gray"
          leftSection={<Palette size={15} />}
          onClick={() => setOpened((value) => !value)}
        >
          {t("brandColor")}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <div className="brand-swatches">
          {BRAND_THEMES.map((theme) => (
            <UnstyledButton
              key={theme.id}
              className={`brand-swatch${theme.id === themeId ? " active" : ""}`}
              style={{ background: `linear-gradient(135deg, ${theme.a}, ${theme.b})` }}
              title={theme.label}
              aria-label={theme.label}
              onClick={() => choose(theme)}
            >
              {theme.id === themeId ? <Check size={14} color="#fff" strokeWidth={3} /> : null}
            </UnstyledButton>
          ))}
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}
