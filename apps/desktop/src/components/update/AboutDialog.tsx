import { useEffect, useState } from "react";
import { Badge, Button, Divider, Group, Modal, Stack, Text } from "@mantine/core";
import { getVersion } from "@tauri-apps/api/app";
import { useI18n } from "../../i18n";

const RELEASES_URL = "https://github.com/MichealJou/BusSpy/releases";

interface AboutDialogProps {
  opened: boolean;
  onClose: () => void;
}

export function AboutDialog({ opened, onClose }: AboutDialogProps) {
  const { t } = useI18n();
  const [version, setVersion] = useState("0.1.0");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion("0.1.0"));
  }, []);

  return (
    <Modal opened={opened} onClose={onClose} title={t("aboutBusSpy")} centered size="lg">
      <Stack gap="md">
        <div>
          <Group gap="xs">
            <Text fw={800} size="lg">BusSpy</Text>
            <Badge color="blue" variant="light">v{version}</Badge>
          </Group>
          <Text c="dimmed" size="sm">
            {t("aboutSummary")}
          </Text>
        </div>

        <Divider />

        <div>
          <Text fw={700}>{t("releaseProtocol")}</Text>
          <Text c="dimmed" size="sm" style={{ whiteSpace: "pre-line" }}>
            {t("releaseProtocolBody")}
          </Text>
        </div>

        <div>
          <Text fw={700}>{t("updatePolicy")}</Text>
          <Text c="dimmed" size="sm" style={{ whiteSpace: "pre-line" }}>
            {t("updatePolicyBody")}
          </Text>
        </div>

        <div>
          <Text fw={700}>{t("platformSupport")}</Text>
          <Text c="dimmed" size="sm">
            macOS Apple Silicon / macOS Intel / Windows x64 / Linux x64
          </Text>
        </div>

        <Group justify="flex-end">
          <Button variant="light" color="gray" onClick={onClose}>
            {t("close")}
          </Button>
          <Button component="a" href={RELEASES_URL} target="_blank" rel="noreferrer">
            {t("openReleases")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
