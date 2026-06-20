import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { getVersion } from "@tauri-apps/api/app";
import { useI18n } from "../../i18n";

const LATEST_RELEASE_URL = "https://api.github.com/repos/MichealJou/BusSpy/releases/latest";
const SKIPPED_VERSION_KEY = "busspy.skippedUpdateVersion";

interface GithubRelease {
  tag_name: string;
  name?: string;
  html_url: string;
  body?: string;
}

interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseUrl: string;
  releaseNotes: string;
}

function normalizeVersion(version: string) {
  return version.trim().replace(/^v/i, "");
}

function compareVersions(left: string, right: string) {
  const leftParts = normalizeVersion(left).split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = normalizeVersion(right).split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

function trimReleaseNotes(notes: string) {
  const lines = notes
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.slice(0, 6).join("\n");
}

export function UpdateChecker() {
  const { t } = useI18n();
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkForUpdates() {
      try {
        const [currentVersion, response] = await Promise.all([
          getVersion(),
          fetch(LATEST_RELEASE_URL, {
            headers: {
              Accept: "application/vnd.github+json",
            },
          }),
        ]);

        if (!response.ok) return;

        const release = (await response.json()) as GithubRelease;
        const latestVersion = normalizeVersion(release.tag_name);
        const skippedVersion = window.localStorage.getItem(SKIPPED_VERSION_KEY);

        if (cancelled || skippedVersion === latestVersion || compareVersions(latestVersion, currentVersion) <= 0) {
          return;
        }

        setUpdateInfo({
          currentVersion,
          latestVersion,
          releaseName: release.name || release.tag_name,
          releaseUrl: release.html_url,
          releaseNotes: trimReleaseNotes(release.body || ""),
        });
        setOpened(true);
      } catch {
        // Update checks should never block normal app startup.
      }
    }

    void checkForUpdates();

    return () => {
      cancelled = true;
    };
  }, []);

  const releaseNotes = useMemo(() => updateInfo?.releaseNotes || t("updateNoNotes"), [t, updateInfo?.releaseNotes]);

  if (!updateInfo) {
    return null;
  }

  return (
    <Modal opened={opened} onClose={() => setOpened(false)} title={t("updateAvailable")} centered size="md">
      <Stack gap="md">
        <Group gap="xs">
          <Badge color="gray" variant="light">
            {t("currentVersion")}: {updateInfo.currentVersion}
          </Badge>
          <Badge color="blue" variant="light">
            {t("latestVersion")}: {updateInfo.latestVersion}
          </Badge>
        </Group>

        <div>
          <Text fw={700}>{updateInfo.releaseName}</Text>
          <Text c="dimmed" size="sm" style={{ whiteSpace: "pre-line" }}>
            {releaseNotes}
          </Text>
        </div>

        <Group justify="flex-end" gap="sm">
          <Button
            variant="subtle"
            color="gray"
            onClick={() => {
              window.localStorage.setItem(SKIPPED_VERSION_KEY, updateInfo.latestVersion);
              setOpened(false);
            }}
          >
            {t("skipVersion")}
          </Button>
          <Button variant="light" color="gray" onClick={() => setOpened(false)}>
            {t("remindLater")}
          </Button>
          <Button component="a" href={updateInfo.releaseUrl} target="_blank" rel="noreferrer">
            {t("openDownloadPage")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
