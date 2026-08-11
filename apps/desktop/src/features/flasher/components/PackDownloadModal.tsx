import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Progress,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  CloudDownload,
  Cpu,
  MemoryStick,
  Package,
  RefreshCw,
  RotateCcw,
  Search,
} from "lucide-react";
import {
  flashDeviceTree,
  flashDownloadPack,
  flashSearchDevices,
  type DeviceInfo,
  type DeviceVendor,
  type FlashEventPayload,
} from "../../../tauri";
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
  status: "downloading" | "done" | "failed";
  pct: number;
  downloadedBytes?: number;
  totalBytes?: number;
  message?: string;
}

/** 器件行下载状态（行内不转圈，排队/下载中统一小图标） */
type DownloadState = "idle" | "queued" | "downloading" | "done" | "failed";

interface TreeRowProps {
  depth: number;
  label: string;
  count?: number;
  open?: boolean;
  onToggle?: () => void;
  selected?: boolean;
  badge?: string;
  installed?: boolean;
  builtin?: boolean;
  downloadState?: DownloadState;
  onDownload?: () => void;
}

/** 树节点行：缩进 + 图标 + 名称 + 计数；器件行右侧下载状态图标（点击即入队） */
function TreeRow({
  depth,
  label,
  count,
  open,
  onToggle,
  selected,
  badge,
  installed,
  builtin,
  downloadState = "idle",
  onDownload,
}: TreeRowProps) {
  const isBranch = count !== undefined;
  return (
    <div
      className={`pack-tree-row${selected ? " selected" : ""}${isBranch ? " branch" : ""}`}
      onClick={onToggle}
      style={{ paddingLeft: depth * 16 + 6 }}
    >
      <span className="tree-icon">
        {isBranch ? (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <Cpu size={12} />}
      </span>
      <span className="pack-tree-label">{label}</span>
      {badge && (
        <Badge size="xs" color="blue" variant="light" style={{ flexShrink: 0 }}>
          {badge}
        </Badge>
      )}
      {isBranch && <span className="pack-tree-count">{count}</span>}

      {/* 器件行：下载状态图标（点击即入队；排队/下载中禁用不转圈，可连续点其他行） */}
      {!isBranch && !builtin && !installed && (
        <Button
          size="compact-xs"
          variant="subtle"
          p={2}
          disabled={downloadState === "queued" || downloadState === "downloading" || downloadState === "done"}
          color={downloadState === "done" ? "green" : downloadState === "failed" ? "red" : "blue"}
          aria-label={`下载 ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            onDownload?.();
          }}
          styles={{ root: { minHeight: 20, height: 20, flexShrink: 0 } }}
        >
          {downloadState === "done" ? (
            <Check size={12} />
          ) : downloadState === "queued" || downloadState === "downloading" ? (
            <Clock size={12} />
          ) : downloadState === "failed" ? (
            <RotateCcw size={12} />
          ) : (
            <CloudDownload size={12} />
          )}
        </Button>
      )}
    </div>
  );
}

/** 同时下载的 Pack 数量上限（并发池） */
const MAX_CONCURRENT = 3;

/** 器件包管理器（Keil 风格：左器件树 + 右详情 + 底部固定状态/进度；点器件即入队排队下载） */
export function PackDownloadModal({ opened, onClose, onInstalled, onLog: _onLog, state }: PackDownloadModalProps) {
  const { t } = useI18n();
  const [vendors, setVendors] = useState<DeviceVendor[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<DeviceInfo | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [tasks, setTasks] = useState<Record<string, DownloadTask>>({});
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<DeviceInfo[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchingIndex, setSearchingIndex] = useState(false);

  const installedPacks = useMemo(() => new Set(state.packs.map((pack) => pack.name)), [state.packs]);

  const filteredVendors = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return vendors;
    }
    return vendors
      .map((vendor) => ({
        ...vendor,
        families: vendor.families
          .map((family) => ({
            ...family,
            devices: family.devices.filter(
              (device) =>
                device.name.toLowerCase().includes(q) ||
                device.pack.toLowerCase().includes(q) ||
                device.vendor.toLowerCase().includes(q),
            ),
          }))
          .filter((family) => family.devices.length > 0),
      }))
      .filter((vendor) => vendor.families.length > 0);
  }, [vendors, query]);

  const loadTree = () => {
    setLoading(true);
    setError(null);
    flashDeviceTree()
      .then((result) => {
        setVendors(result.vendors);
        const st = result.vendors.find(
          (vendor) => vendor.name.includes("STMicroelectronics") || vendor.name.toLowerCase().startsWith("stmicro"),
        );
        setExpandedVendors(new Set(st ? [st.name] : []));
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (opened) {
      loadTree();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  // 搜索：防抖 250ms 后走 Rust 统一索引查询（限量扁平结果，避免大树渲染卡顿）
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchResults([]);
      setSearchTotal(0);
      return;
    }
    setSearchingIndex(true);
    const timer = setTimeout(() => {
      flashSearchDevices(q)
        .then((result) => {
          setSearchResults(result.results);
          setSearchTotal(result.total);
        })
        .catch(() => {
          setSearchResults([]);
          setSearchTotal(0);
        })
        .finally(() => setSearchingIndex(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  // pack.progress 事件（更新对应 pack 下载进度）
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    listen<FlashEventPayload>("flash-event", (event) => {
      const payload = event.payload;
      if (payload.event !== "pack.progress") {
        return;
      }
      const data = payload.data as { pack?: string; pct?: number; downloadedBytes?: number; totalBytes?: number };
      if (!data?.pack) {
        return;
      }
      setTasks((prev) => {
        const task = prev[data.pack!];
        if (!task || task.status !== "downloading") {
          return prev;
        }
        return {
          ...prev,
          [data.pack!]: {
            ...task,
            pct: data.pct ?? 0,
            downloadedBytes: data.downloadedBytes ?? task.downloadedBytes,
            totalBytes: data.totalBytes ?? task.totalBytes,
          },
        };
      });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  function toggleVendor(name: string) {
    setExpandedVendors((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  function toggleFamily(name: string) {
    setExpandedFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  function selectDevice(device: DeviceInfo, vendor: string, family: string) {
    setSelected(device);
    setExpandedVendors((prev) => new Set(prev).add(vendor));
    setExpandedFamilies((prev) => new Set(prev).add(family));
  }

  /** 点器件即入队（排队自动下载；可连续点多个） */
  function enqueueDownload(pack: string) {
    if (installedPacks.has(pack)) {
      return;
    }
    const task = tasks[pack];
    if (task?.status === "downloading" || task?.status === "done") {
      return;
    }
    if (queue.includes(pack)) {
      return;
    }
    setQueue((prev) => [...prev, pack]);
  }

  /** 实际执行下载（由调度器调用） */
  async function startDownload(pack: string) {
    setTasks((prev) => ({ ...prev, [pack]: { status: "downloading", pct: 0 } }));
    try {
      await flashDownloadPack(pack);
      setTasks((prev) => ({ ...prev, [pack]: { status: "done", pct: 100 } }));
      await onInstalled();
    } catch (err) {
      setTasks((prev) => ({ ...prev, [pack]: { status: "failed", pct: 0, message: String(err) } }));
    }
  }

  // 调度：保持 2-3 个并发，完成一个从队列补一个
  useEffect(() => {
    const active = Object.values(tasks).filter((task) => task.status === "downloading").length;
    const slots = Math.max(0, MAX_CONCURRENT - active);
    if (slots > 0 && queue.length > 0) {
      const batch = queue.slice(0, slots);
      setQueue((prev) => prev.slice(slots));
      for (const pack of batch) {
        void startDownload(pack);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, tasks]);

  const searching = query.trim() !== "";
  const totalCount = vendors.reduce(
    (sum, vendor) => sum + vendor.families.reduce((s, family) => s + family.devices.length, 0),
    0,
  );
  const doneCount = Object.values(tasks).filter((task) => task.status === "done").length;
  const activeCount = Object.values(tasks).filter((task) => task.status === "downloading").length;
  const selectedInstalled = selected ? installedPacks.has(selected.pack) : false;

  /** 搜索结果：索引查询的限量扁平列表（不展开大树，渲染量小不卡） */
  function renderSearchResults() {
    if (searchingIndex && searchResults.length === 0) {
      return (
        <Group gap={6} p={8}>
          <Loader size={13} />
          <Text fz={12} c="dimmed">
            {t("packSearching")}
          </Text>
        </Group>
      );
    }
    if (searchResults.length === 0) {
      return (
        <Text fz={12} c="dimmed" p={8}>
          {t("packSearchEmpty")}
        </Text>
      );
    }
    return (
      <>
        <Text fz={11} c="dimmed" p="6px 8px">
          {t("packSearchResult").replace("{count}", String(searchTotal))}
          {searchTotal > searchResults.length ? ` · ${t("packListCount").replace("{count}", String(searchResults.length))}` : ""}
        </Text>
        {searchResults.map((device) => {
          const task = tasks[device.pack];
          const installed = installedPacks.has(device.pack);
          const queued = queue.includes(device.pack);
          let downloadState: DownloadState = "idle";
          if (task?.status === "done") {
            downloadState = "done";
          } else if (task?.status === "downloading") {
            downloadState = "downloading";
          } else if (queued) {
            downloadState = "queued";
          } else if (task?.status === "failed") {
            downloadState = "failed";
          }
          return (
            <TreeRow
              key={device.name}
              depth={0}
              label={device.name}
              badge={device.vendor}
              selected={selected?.name === device.name}
              onToggle={() => selectDevice(device, device.vendor, device.family)}
              installed={installed}
              builtin={device.builtin}
              downloadState={downloadState}
              onDownload={() => enqueueDownload(device.pack)}
            />
          );
        })}
      </>
    );
  }

  function renderTree() {
    if (filteredVendors.length === 0) {
      return (
        <Text fz={12} c="dimmed" p={8}>
          {t("packSearchEmpty")}
        </Text>
      );
    }
    return filteredVendors.map((vendor) => {
      const vendorOpen = searching || expandedVendors.has(vendor.name);
      const vendorCount = vendor.families.reduce((sum, family) => sum + family.devices.length, 0);
      return (
        <div key={vendor.name}>
          <TreeRow
            depth={0}
            label={vendor.name}
            count={vendorCount}
            open={vendorOpen}
            onToggle={() => toggleVendor(vendor.name)}
          />
          {vendorOpen &&
            vendor.families.map((family) => {
              const familyOpen = searching || expandedFamilies.has(family.name);
              return (
                <div key={family.name}>
                  <TreeRow
                    depth={1}
                    label={family.name}
                    count={family.devices.length}
                    open={familyOpen}
                    onToggle={() => toggleFamily(family.name)}
                  />
                  {familyOpen &&
                    family.devices.map((device) => {
                      const task = tasks[device.pack];
                      const installed = installedPacks.has(device.pack);
                      const queued = queue.includes(device.pack);
                      let downloadState: DownloadState = "idle";
                      if (task?.status === "done") {
                        downloadState = "done";
                      } else if (task?.status === "downloading") {
                        downloadState = "downloading";
                      } else if (queued) {
                        downloadState = "queued";
                      } else if (task?.status === "failed") {
                        downloadState = "failed";
                      }
                      return (
                        <TreeRow
                          key={device.name}
                          depth={2}
                          label={device.name}
                          badge={device.builtin ? t("packBuiltin") : undefined}
                          selected={selected?.name === device.name}
                          onToggle={() => selectDevice(device, vendor.name, family.name)}
                          installed={installed}
                          builtin={device.builtin}
                          downloadState={downloadState}
                          onDownload={() => enqueueDownload(device.pack)}
                        />
                      );
                    })}
                </div>
              );
            })}
        </div>
      );
    });
  }

  function renderDetail() {
    if (!selected) {
      return (
        <div className="pack-empty">
          <Package size={30} className="empty-icon" />
          <span>{t("selectDeviceHint")}</span>
        </div>
      );
    }
    const device = selected;
    const task = tasks[device.pack];
    return (
      <>
        <div className="pack-detail-title">
          <span className="device-name">{device.name}</span>
          {selectedInstalled ? (
            <Badge color="green" variant="light" leftSection={<Check size={11} />}>
              {t("packInstalled")}
            </Badge>
          ) : device.builtin ? (
            <Badge color="blue" variant="light">
              {t("packBuiltin")}
            </Badge>
          ) : (
            <Badge color="gray" variant="light">
              {t("packNotInstalled")}
            </Badge>
          )}
        </div>
        <div className="pack-detail-meta">
          {device.vendor} · {device.family}
        </div>

        <div className="pack-detail-props">
          <div className="pack-prop">
            <Cpu size={15} className="prop-icon" />
            <div>
              <div className="prop-name">Flash</div>
              <div className="prop-value">{device.flashKb ? `${device.flashKb} KB` : "-"}</div>
            </div>
          </div>
          <div className="pack-prop">
            <MemoryStick size={15} className="prop-icon" />
            <div>
              <div className="prop-name">RAM</div>
              <div className="prop-value">{device.ramKb ? `${device.ramKb} KB` : "-"}</div>
            </div>
          </div>
        </div>

        <div className="pack-detail-pack">
          <Package size={14} className="prop-icon" />
          <span className="ellipsis">
            {device.pack}
            {device.version ? ` v${device.version}` : ""}
          </span>
        </div>

        {!device.builtin && (
          <div className="pack-detail-actions">
            {task?.status === "downloading" ? (
              <div className="install-progress">
                <Progress value={task.pct} size="sm" striped animated />
                <Text fz={11} c="dimmed" mt={4}>
                  {t("downloading")} {task.pct}%
                </Text>
              </div>
            ) : (
              <Button
                size="sm"
                leftSection={
                  selectedInstalled || task?.status === "done" ? <Check size={14} /> : <CloudDownload size={14} />
                }
                onClick={() => enqueueDownload(device.pack)}
                disabled={selectedInstalled || task?.status === "done" || queue.includes(device.pack)}
                color={selectedInstalled || task?.status === "done" ? "green" : "blue"}
                styles={{ root: { minWidth: 130 } }}
              >
                {selectedInstalled || task?.status === "done"
                  ? t("packInstalled")
                  : queue.includes(device.pack)
                    ? t("queuedLabel")
                    : t("installPack")}
              </Button>
            )}
            {task?.status === "failed" && task.message && (
              <Text fz={12} c="red">
                {task.message}
              </Text>
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("deviceManager")}
      size="xl"
      centered
      styles={{
        body: { height: "70vh", overflow: "hidden", display: "flex", flexDirection: "column" },
      }}
    >
      <Stack gap={10} style={{ flex: 1, minHeight: 0 }}>
        <Group gap={8}>
          <TextInput
            style={{ flex: 1 }}
            size="xs"
            placeholder={t("packSearchPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            leftSection={<Search size={13} />}
          />
          <Button size="xs" variant="subtle" leftSection={<RefreshCw size={13} />} onClick={loadTree} loading={loading}>
            {t("refresh")}
          </Button>
        </Group>

        {error && (
          <Alert color="red" variant="light" p="sm">
            <Text fz={12}>{error}</Text>
          </Alert>
        )}

        <div className="pack-modal-body">
          {/* 左：器件树（点器件即入队下载） */}
          <div className="pack-tree-panel">
            <div className="pack-tree-header">
              <span>{t("devicesTitle")}</span>
              <span className="tree-total">{t("deviceCount").replace("{count}", String(totalCount))}</span>
            </div>
            <div className="pack-tree-scroll">
              {loading && vendors.length === 0 ? (
                <Group gap={6} p={8}>
                  <Loader size={14} />
                  <Text fz={12} c="dimmed">
                    {t("packSearching")}
                  </Text>
                </Group>
              ) : query.trim() ? (
                renderSearchResults()
              ) : (
                renderTree()
              )}
            </div>
          </div>

          {/* 右：器件详情 */}
          <div className="pack-detail-panel">{renderDetail()}</div>
        </div>
      </Stack>

      {/* 底部固定状态栏（始终可见）：下载中 / 排队 / 已完成 + 进度 */}
      <div className="pack-download-bar">
        <Group justify="space-between" align="center" wrap="nowrap">
          <Text fz={12} c="dimmed" className="ellipsis" style={{ flex: 1, minWidth: 0 }}>
            {t("deviceCount").replace("{count}", String(totalCount))}
            {activeCount > 0 && ` · ${t("downloading")} ${activeCount}/${MAX_CONCURRENT}`}
            {queue.length > 0 && ` · ${t("queuedLabel")} ${queue.length}`}
            {doneCount > 0 && ` · ${t("downloadedCount").replace("{count}", String(doneCount))}`}
          </Text>
        </Group>

        {Object.keys(tasks).length > 0 && (
          <Stack gap={4} mt={8}>
            {Object.entries(tasks)
              .filter(([, task]) => task.status === "downloading")
              .map(([pack, task]) => {
                const doneMb = task.downloadedBytes ? (task.downloadedBytes / 1048576).toFixed(1) : "?";
                const totalMb = task.totalBytes ? (task.totalBytes / 1048576).toFixed(1) : "?";
                return (
                  <Tooltip key={pack} label={`${pack}\n${doneMb} MB / ${totalMb} MB · ${task.pct}%`} multiline withArrow>
                    <div>
                      <Progress value={task.pct} size="xs" striped animated />
                      <Text fz={11} c="dimmed" mt={2} className="ellipsis">
                        {t("downloading")} {pack} {task.pct}%
                      </Text>
                    </div>
                  </Tooltip>
                );
              })}
            {Object.entries(tasks)
              .filter(([, task]) => task.status === "failed")
              .map(([pack, task]) => (
                <Text key={pack} fz={11} c="red">
                  {t("packFailed")}: {pack} — {task.message}
                </Text>
              ))}
          </Stack>
        )}
      </div>
    </Modal>
  );
}
