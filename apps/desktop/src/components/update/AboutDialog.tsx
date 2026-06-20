import { useEffect, useState } from "react";
import { Badge, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { getVersion } from "@tauri-apps/api/app";
import { useI18n } from "../../i18n";

export type AboutSection = "about" | "protocol" | "policy";

interface AboutDialogProps {
  opened: boolean;
  onClose: () => void;
  section: AboutSection;
}

export function AboutDialog({ opened, onClose, section }: AboutDialogProps) {
  const { t } = useI18n();
  const [version, setVersion] = useState("0.1.0");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion("0.1.0"));
  }, []);

  const title = section === "protocol" ? t("releaseProtocol") : section === "policy" ? t("updatePolicy") : t("aboutBusSpy");

  return (
    <Modal opened={opened} onClose={onClose} title={title} centered size="md">
      <Stack gap="md">
        {section === "about" ? (
          <>
            <div>
              <Group gap="xs">
                <Text fw={800} size="lg">BusSpy</Text>
                <Badge color="blue" variant="light">v{version}</Badge>
              </Group>
              <Text c="dimmed" size="sm">
                {t("aboutSummary")}
              </Text>
            </div>
            <div>
              <Text fw={700}>{t("author")}</Text>
              <Text c="dimmed" size="sm">Felix Chou</Text>
            </div>
            <div>
              <Text fw={700}>{t("platformSupport")}</Text>
              <Text c="dimmed" size="sm">
                macOS Apple Silicon / macOS Intel / Windows x64 / Linux x64
              </Text>
            </div>
            <Text c="dimmed" size="sm" style={{ whiteSpace: "pre-line" }}>
              {t("aboutDetail")}
            </Text>
          </>
        ) : null}

        {section === "protocol" ? (
          <div>
            <Group gap="xs" mb={8}>
              <Badge color="green" variant="light">SemVer</Badge>
              <Badge color="gray" variant="light">MAJOR.MINOR.PATCH</Badge>
            </Group>
            <Text c="dimmed" size="sm" style={{ whiteSpace: "pre-line" }}>
              {t("releaseProtocolBody")}
            </Text>
          </div>
        ) : null}

        {section === "policy" ? (
          <Text c="dimmed" size="sm" style={{ whiteSpace: "pre-line" }}>
            {t("updatePolicyBody")}
          </Text>
        ) : null}

        <Group justify="flex-end">
          <Button variant="light" color="gray" onClick={onClose}>
            {t("close")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
