import { useState } from "react";
import { Alert, Badge, Button, Group, Loader, Modal, ScrollArea, Stack, Table, Text, TextInput, Tooltip } from "@mantine/core";
import { Download, Search } from "lucide-react";
import { flashDownloadPack, flashSearchPacks, type PackSearchResult } from "../../../tauri";
import { useI18n } from "../../../i18n";
import type { FlasherStore } from "../lib/types";

interface PackDownloadModalProps {
  opened: boolean;
  onClose: () => void;
  onInstalled: () => Promise<void>;
  onLog: (message: string) => void;
  state: FlasherStore;
}

/** 在线器件包下载器：搜索器件型号 → 自动下载对应官方 Pack → 自动安装 */
export function PackDownloadModal({ opened, onClose, onInstalled, onLog, state }: PackDownloadModalProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PackSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [downloadingPack, setDownloadingPack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    if (!query.trim()) {
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const result = await flashSearchPacks(query.trim());
      setResults(result.results);
      if (result.results.length === 0) {
        setError(t("packSearchEmpty"));
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSearching(false);
    }
  }

  async function handleDownload(pack: string) {
    setDownloadingPack(pack);
    setError(null);
    try {
      onLog(t("packDownloadStart").replace("{pack}", pack));
      await flashDownloadPack(pack);
      onLog(t("packDownloadDone").replace("{pack}", pack));
      await onInstalled();
      onClose();
    } catch (err) {
      setError(String(err));
      onLog(t("packDownloadFail").replace("{pack}", pack).replace("{error}", String(err)));
    } finally {
      setDownloadingPack(null);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={t("packDownloader")} size="lg" centered>
      <Stack gap={10}>
        <Group gap={8}>
          <TextInput
            style={{ flex: 1 }}
            size="xs"
            placeholder={t("packSearchPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void handleSearch();
              }
            }}
          />
          <Button size="xs" leftSection={<Search size={13} />} onClick={() => void handleSearch()} loading={searching}>
            {t("packSearch")}
          </Button>
        </Group>

        {error && (
          <Alert color="red" variant="light" p="sm">
            <Text fz={12}>{error}</Text>
          </Alert>
        )}

        {results.length > 0 && (
          <>
            <Text fz={12} c="dimmed">
              {t("packSearchResult").replace("{count}", String(results.length))}
            </Text>
            <ScrollArea h={300}>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t("device")}</Table.Th>
                    <Table.Th>{t("installedPacks")}</Table.Th>
                    <Table.Th>Flash</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {results.map((result) => (
                    <Table.Tr key={`${result.device}-${result.pack}`}>
                      <Table.Td style={{ fontFamily: "monospace" }}>{result.device}</Table.Td>
                      <Table.Td>
                        <Badge variant="light" size="xs">
                          {result.pack} v{result.version}
                        </Badge>
                      </Table.Td>
                      <Table.Td>{result.flashKb ? `${result.flashKb} KB` : "-"}</Table.Td>
                      <Table.Td>
                        <Button
                          size="compact-xs"
                          variant="light"
                          leftSection={downloadingPack === result.pack ? <Loader size={12} /> : <Download size={12} />}
                          onClick={() => void handleDownload(result.pack)}
                          loading={downloadingPack === result.pack}
                          disabled={downloadingPack !== null}
                        >
                          {t("packDownload")}
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
            <Tooltip label={t("packDownloadHint")} multiline w={280}>
              <Text fz={11} c="dimmed">
                {t("packDownloadHint")}
              </Text>
            </Tooltip>
          </>
        )}

        {searching && (
          <Group gap={6}>
            <Loader size={14} />
            <Text fz={12} c="dimmed">
              {t("packSearching")}
            </Text>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}
