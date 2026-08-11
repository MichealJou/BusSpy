import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { Check, CloudDownload, Search } from "lucide-react";
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

interface DownloadTask {
  pack: string;
  status: "pending" | "downloading" | "done" | "failed";
  message?: string;
}

/** 器件下载管理器：搜索 → 勾选多个器件包 → 一键批量下载安装 */
export function PackDownloadModal({ opened, onClose, onInstalled, onLog, state }: PackDownloadModalProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PackSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tasks, setTasks] = useState<Record<string, DownloadTask>>({});
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 已安装的 Pack 集合（用于标记状态）
  const installedPacks = useMemo(() => new Set(state.packs.map((pack) => pack.name)), [state.packs]);

  // 勾选的唯一 Pack 列表
  const selectedPacks = useMemo(() => Array.from(selected), [selected]);

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

  function togglePack(pack: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pack)) {
        next.delete(pack);
      } else {
        next.add(pack);
      }
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = results.length > 0 && results.every((result) => next.has(result.pack));
      if (allSelected) {
        results.forEach((result) => next.delete(result.pack));
      } else {
        results.forEach((result) => next.add(result.pack));
      }
      return next;
    });
  }

  function isAllSelected() {
    return results.length > 0 && results.every((result) => selected.has(result.pack));
  }

  async function handleDownloadAll() {
    if (selectedPacks.length === 0 || downloading) {
      return;
    }
    setDownloading(true);
    setError(null);
    const nextTasks: Record<string, DownloadTask> = {};
    selectedPacks.forEach((pack) => {
      nextTasks[pack] = { pack, status: "pending" };
    });
    setTasks(nextTasks);

    // 串行批量下载（同一后端进程顺序执行）
    for (const pack of selectedPacks) {
      setTasks((prev) => ({ ...prev, [pack]: { pack, status: "downloading" } }));
      onLog(t("packDownloadStart").replace("{pack}", pack));
      try {
        await flashDownloadPack(pack);
        setTasks((prev) => ({ ...prev, [pack]: { pack, status: "done" } }));
        onLog(t("packDownloadDone").replace("{pack}", pack));
      } catch (err) {
        setTasks((prev) => ({ ...prev, [pack]: { pack, status: "failed", message: String(err) } }));
        onLog(t("packDownloadFail").replace("{pack}", pack).replace("{error}", String(err)));
      }
    }

    setDownloading(false);
    await onInstalled();
    // 全部成功则关闭；有失败保留弹窗展示状态
    const failed = Object.values(tasks).filter((task) => task.status === "failed").length;
    if (failed === 0) {
      setSelected(new Set());
      setTasks({});
      onClose();
    }
  }

  const pendingCount = selectedPacks.length;
  const doneCount = Object.values(tasks).filter((task) => task.status === "done").length;

  return (
    <Modal opened={opened} onClose={onClose} title={t("deviceManager")} size="xl" centered>
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
            <Group justify="space-between">
              <Text fz={12} c="dimmed">
                {t("packSearchResult").replace("{count}", String(results.length))}
              </Text>
              <Checkbox size="xs" label={t("selectAll")} checked={isAllSelected()} onChange={toggleAll} />
            </Group>

            <ScrollArea h={320}>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={{ width: 36 }} />
                    <Table.Th>{t("device")}</Table.Th>
                    <Table.Th>{t("installedPacks")}</Table.Th>
                    <Table.Th>Flash</Table.Th>
                    <Table.Th style={{ width: 130 }}>{t("downloadStatus")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {results.map((result) => {
                    const task = tasks[result.pack];
                    const installed = installedPacks.has(result.pack);
                    return (
                      <Table.Tr key={`${result.device}-${result.pack}`}>
                        <Table.Td>
                          <Checkbox
                            size="xs"
                            checked={selected.has(result.pack)}
                            onChange={() => togglePack(result.pack)}
                            disabled={downloading || installed}
                          />
                        </Table.Td>
                        <Table.Td style={{ fontFamily: "monospace" }}>{result.device}</Table.Td>
                        <Table.Td>
                          <Badge variant="light" size="xs">
                            {result.pack} v{result.version}
                          </Badge>
                        </Table.Td>
                        <Table.Td>{result.flashKb ? `${result.flashKb} KB` : "-"}</Table.Td>
                        <Table.Td>
                          {installed ? (
                            <Badge color="green" variant="light" size="xs" leftSection={<Check size={11} />}>
                              {t("packInstalled")}
                            </Badge>
                          ) : task?.status === "downloading" ? (
                            <Group gap={4}>
                              <Loader size={11} />
                              <Text fz={11} c="dimmed">
                                {t("downloading")}
                              </Text>
                            </Group>
                          ) : task?.status === "done" ? (
                            <Badge color="green" variant="light" size="xs">
                              {t("packDone")}
                            </Badge>
                          ) : task?.status === "failed" ? (
                            <Tooltip label={task.message}>
                              <Badge color="red" variant="light" size="xs">
                                {t("packFailed")}
                              </Badge>
                            </Tooltip>
                          ) : (
                            <Text fz={11} c="dimmed">
                              -
                            </Text>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>

            <Group justify="space-between">
              <Text fz={12} c="dimmed">
                {t("selectedCount").replace("{count}", String(pendingCount))}
                {doneCount > 0 && ` · ${t("downloadedCount").replace("{count}", String(doneCount))}`}
              </Text>
              <Button
                leftSection={downloading ? <Loader size={14} /> : <CloudDownload size={14} />}
                onClick={() => void handleDownloadAll()}
                loading={downloading}
                disabled={pendingCount === 0}
              >
                {t("downloadSelected")}
                {pendingCount > 0 ? ` (${pendingCount})` : ""}
              </Button>
            </Group>
            <Text fz={11} c="dimmed">
              {t("packDownloadHint")}
            </Text>
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
