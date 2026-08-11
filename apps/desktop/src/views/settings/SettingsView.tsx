import { useEffect, useState } from "react";
import { Button, Group, Paper, Stack, Text } from "@mantine/core";
import { FolderOpen, Folder, RotateCcw } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { getAppPaths, setFirmwareDir, type AppPaths } from "../../tauri";
import { useI18n } from "../../i18n";

/** 设置页：存储位置管理（器件包目录 / 固件默认目录，各自独立、默认有位置） */
export function SettingsView() {
  const { t } = useI18n();
  const [paths, setPaths] = useState<AppPaths | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getAppPaths()
      .then(setPaths)
      .catch((err) => setError(String(err)));
  }, []);

  async function changeFirmwareDir() {
    const dir = await open({ directory: true, multiple: false, defaultPath: paths?.firmwareDir || undefined });
    if (typeof dir === "string") {
      try {
        await setFirmwareDir(dir);
        setPaths((prev) => (prev ? { ...prev, firmwareDir: dir } : prev));
      } catch (err) {
        setError(String(err));
      }
    }
  }

  async function resetFirmwareDir() {
    try {
      await setFirmwareDir("");
      setPaths((prev) => (prev ? { ...prev, firmwareDir: "" } : prev));
    } catch (err) {
      setError(String(err));
    }
  }

  async function openPackDir() {
    if (paths?.packDir) {
      void openPath(paths.packDir).catch(() => undefined);
    }
  }

  return (
    <main className="workspace">
      <Stack gap={14} style={{ maxWidth: 720 }}>
        <Text fw={700} fz={15}>
          {t("settingsTitle")}
        </Text>

        {/* 器件包目录 */}
        <Paper className="flasher-card" withBorder p="md">
          <Group gap={6} mb={8}>
            <Folder size={15} />
            <Text fw={600} fz={13}>
              {t("packDirLabel")}
            </Text>
          </Group>
          <Text fz={12} c="dimmed" mb={10} className="path-break">
            {paths?.packDir || t("loading")}
          </Text>
          <Group gap={8}>
            <Button size="compact-xs" variant="light" leftSection={<FolderOpen size={12} />} onClick={() => void openPackDir()}>
              {t("openInFinder")}
            </Button>
            <Text fz={11} c="dimmed">
              {t("packDirHint")}
            </Text>
          </Group>
        </Paper>

        {/* 固件默认目录 */}
        <Paper className="flasher-card" withBorder p="md">
          <Group gap={6} mb={8}>
            <FolderOpen size={15} />
            <Text fw={600} fz={13}>
              {t("firmwareDirLabel")}
            </Text>
          </Group>
          <Text fz={12} c="dimmed" mb={10} className="path-break">
            {paths?.firmwareDir ? paths.firmwareDir : t("firmwareDirDefault")}
          </Text>
          <Group gap={8}>
            <Button size="compact-xs" variant="light" leftSection={<FolderOpen size={12} />} onClick={() => void changeFirmwareDir()}>
              {t("changeDir")}
            </Button>
            <Button size="compact-xs" variant="subtle" leftSection={<RotateCcw size={12} />} onClick={() => void resetFirmwareDir()}>
              {t("resetDefault")}
            </Button>
            <Text fz={11} c="dimmed">
              {t("firmwareDirHint")}
            </Text>
          </Group>
        </Paper>

        {error && (
          <Text fz={12} c="red">
            {error}
          </Text>
        )}
      </Stack>
    </main>
  );
}
