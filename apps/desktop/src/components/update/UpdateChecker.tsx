import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { getVersion } from "@tauri-apps/api/app";
import { useI18n } from "../../i18n";
import { openExternalUrl } from "../../tauri";

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

type UpdateStatus = "idle" | "available" | "latest" | "failed";

function normalizeVersion(version: string) {
  return version.trim().replace(/^v/i, "");
}

function formatVersion(version: string) {
  return `v${normalizeVersion(version)}`;
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
  const [status, setStatus] = useState<UpdateStatus>("idle");

  async function checkForUpdates(options: { manual: boolean; cancelled?: () => boolean }) {
    try {
      const [currentVersion, response] = await Promise.all([
        getVersion(),
        fetch(LATEST_RELEASE_URL, {
          headers: {
            Accept: "application/vnd.github+json",
          },
        }),
      ]);

      if (!response.ok) {
        if (options.manual && !options.cancelled?.()) {
          setStatus("failed");
          setOpened(true);
        }
        return;
      }

      const release = (await response.json()) as GithubRelease;
      const latestVersion = normalizeVersion(release.tag_name);
      const skippedVersion = window.localStorage.getItem(SKIPPED_VERSION_KEY);

      if (options.cancelled?.()) {
        return;
      }

      if (!options.manual && skippedVersion === latestVersion) {
        return;
      }

      if (compareVersions(latestVersion, currentVersion) <= 0) {
        if (options.manual) {
          setUpdateInfo({
            currentVersion,
            latestVersion: currentVersion,
            releaseName: t("alreadyLatest"),
            releaseUrl: release.html_url,
            releaseNotes: t("alreadyLatestDetail"),
          });
          setStatus("latest");
          setOpened(true);
        }
        return;
      }

      setUpdateInfo({
        currentVersion,
        latestVersion,
        releaseName: release.name || release.tag_name,
        releaseUrl: release.html_url,
        releaseNotes: trimReleaseNotes(release.body || ""),
      });
      setStatus("available");
      setOpened(true);
    } catch {
      if (options.manual && !options.cancelled?.()) {
        setStatus("failed");
        setOpened(true);
      }
    }
  }

  useEffect(() => {
    let cancelled = false;

    function handleManualCheck() {
      void checkForUpdates({ manual: true, cancelled: () => cancelled });
    }

    window.addEventListener("busspy:check-update", handleManualCheck);
    void checkForUpdates({ manual: false, cancelled: () => cancelled });

    return () => {
      cancelled = true;
      window.removeEventListener("busspy:check-update", handleManualCheck);
    };
  }, [t]);

  const releaseNotes = useMemo(() => updateInfo?.releaseNotes || t("updateNoNotes"), [t, updateInfo?.releaseNotes]);

  if (!updateInfo && status !== "failed") {
    return null;
  }

  return (
    <Modal opened={opened} onClose={() => setOpened(false)} title={status === "available" ? t("updateAvailable") : t("updateCheckResult")} centered size="md">
      <Stack gap="md">
        {status === "failed" ? (
          <Text c="dimmed" size="sm">{t("updateCheckFailed")}</Text>
        ) : (
          <>
            <Group gap="xs">
              <Badge color="gray" variant="light">
                {t("currentVersion")}: {formatVersion(updateInfo?.currentVersion ?? "0.0.0")}
              </Badge>
              <Badge color={status === "latest" ? "green" : "blue"} variant="light">
                {t("latestVersion")}: {formatVersion(updateInfo?.latestVersion ?? "0.0.0")}
              </Badge>
            </Group>

            <div>
              <Text fw={700}>{updateInfo?.releaseName}</Text>
              <Text c="dimmed" size="sm" style={{ whiteSpace: "pre-line" }}>
                {releaseNotes}
              </Text>
            </div>
          </>
        )}

        <Group justify="flex-end" gap="sm">
          {status === "available" && updateInfo ? (
            <>
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
              <Button onClick={() => void openExternalUrl(updateInfo.releaseUrl)}>
                {t("openDownloadPage")}
              </Button>
            </>
          ) : (
            <Button onClick={() => setOpened(false)}>{t("close")}</Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
