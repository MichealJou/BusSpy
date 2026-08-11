import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
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
  CloudDownload,
  Cpu,
  MemoryStick,
  Package,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  flashDeviceTree,
  flashDownloadPack,
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

interface TreeRowProps {
  depth: number;
  label: string;
  count?: number;
  open?: boolean;
  onToggle?: () => void;
  selected?: boolean;
  badge?: string;
  /** 器件行：勾选 */
  checkable?: boolean;
  checked?: boolean;
  onCheck?: () => void;
  installed?: boolean;
  /** 内置器件（无 Pack 可下载） */
  builtin?: boolean;
  downloading?: boolean;
  downloadDone?: boolean;
  onDownload?: () => void;
  /** 分支行（厂商/系列）父类勾选 */
  branchCheckable?: boolean;
  branchChecked?: boolean;
  branchIndeterminate?: boolean;
  onBranchCheck?: () => void;
}

/** 树节点行：缩进 + 图标 + 名称 + 计数；器件行可勾选、行内下载；分支行可父类勾选 */
function TreeRow({
  depth,
  label,
  count,
  open,
  onToggle,
  selected,
  badge,
  checkable,
  checked,
  onCheck,
  installed,
  builtin,
  downloading,
  downloadDone,
  onDownload,
  branchCheckable,
  branchChecked,
  branchIndeterminate,
  onBranchCheck,
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
      {isBranch && branchCheckable && (
        <Checkbox
          size="xs"
          checked={branchChecked}
          indeterminate={branchIndeterminate}
          onChange={() => onBranchCheck?.()}
          onClick={(event) => event.stopPropagation()}
          aria-label={`选择 ${label} 全部`}
          style={{ flexShrink: 0 }}
        />
      )}
      {isBranch && <span className="pack-tree-count">{count}</span>}

      {!isBranch && checkable && !installed && (
        <Checkbox
          size="xs"
          checked={checked}
          onChange={() => onCheck?.()}
          onClick={(event) => event.stopPropagation()}
          aria-label={`勾选 ${label}`}
          style={{ flexShrink: 0 }}
        />
      )}

      {/* 内置器件（8051 等）无 Pack 可下载，不显示下载按钮 */}
      {!isBranch && !builtin && !installed && onDownload && (
        <Button
          size="compact-xs"
          variant="subtle"
          p={2}
          loading={downloading}
          disabled={downloading || downloadDone}
          color={downloadDone ? "green" : "blue"}
          aria-label={`下载 ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            onDownload?.();
          }}
          styles={{ root: { minHeight: 20, height: 20, flexShrink: 0 } }}
        >
          {downloadDone ? <Check size={12} /> : <CloudDownload size={12} />}
        </Button>
      )}
    </div>
  );
}

/** 同时下载的 Pack 数量上限（并发池） */
const MAX_CONCURRENT = 3;

/** 器件包管理器（Keil Devices 布局：左器件树 + 右详情 + 底部固定批量下载） */
export function PackDownloadModal({ opened, onClose, onInstalled, onLog: _onLog, state }: PackDownloadModalProps) {
  const { t } = useI18n();
  const [vendors, setVendors] = useState<DeviceVendor[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<DeviceInfo | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set()); // 底部批量下载勾选（pack）
  const [tasks, setTasks] = useState<Record<string, DownloadTask>>({});
  const [error, setError] = useState<string | null>(null);

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

  function togglePicked(pack: string) {
    if (installedPacks.has(pack)) {
      return;
    }
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(pack)) {
        next.delete(pack);
      } else {
        next.add(pack);
      }
      return next;
    });
  }

  /** 一组器件（厂商/系列下全部未装器件）的可勾选 pack 集合 */
  function groupPacks(devices: DeviceInfo[]): string[] {
    return devices
      .filter((device) => !device.builtin && !installedPacks.has(device.pack))
      .map((device) => device.pack);
  }

  /** 父类勾选：全选 / 全不选一组 pack */
  function toggleGroup(packs: string[]) {
    if (packs.length === 0) {
      return;
    }
    setPicked((prev) => {
      const next = new Set(prev);
      const allSelected = packs.every((pack) => next.has(pack));
      if (allSelected) {
        packs.forEach((pack) => next.delete(pack));
      } else {
        packs.forEach((pack) => next.add(pack));
      }
      return next;
    });
  }

  // 下载并发池：最多 MAX_CONCURRENT 个同时下载，其余排队自动推进
  const [queue, setQueue] = useState<string[]>([]);

  /** 请求下载（入队；已有下载/完成/在队中则忽略） */
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

  /** 实际执行下载（由调度器调用，不直接对外） */
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

  // 批量下载勾选的 pack：全部入队，交给并发池调度
  function downloadSelected() {
    if (picked.size === 0) {
      return;
    }
    const newPacks = Array.from(picked).filter(
      (pack) =>
        !installedPacks.has(pack) &&
        !queue.includes(pack) &&
        tasks[pack]?.status !== "downloading" &&
        tasks[pack]?.status !== "done",
    );
    setPicked(new Set());
    setQueue((prev) => [...prev, ...newPacks]);
  }

  const searching = query.trim() !== "";
  const totalCount = vendors.reduce(
    (sum, vendor) => sum + vendor.families.reduce((s, family) => s + family.devices.length, 0),
    0,
  );
  const doneCount = Object.values(tasks).filter((task) => task.status === "done").length;
  const activeCount = Object.values(tasks).filter((task) => task.status === "downloading").length;
  const selectedInstalled = selected ? installedPacks.has(selected.pack) : false;

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
      const vendorPacks = groupPacks(vendor.families.flatMap((family) => family.devices));
      const vendorSelected = vendorPacks.filter((pack) => picked.has(pack)).length;
      return (
        <div key={vendor.name}>
          <TreeRow
            depth={0}
            label={vendor.name}
            count={vendorCount}
            open={vendorOpen}
            onToggle={() => toggleVendor(vendor.name)}
            branchCheckable
            branchChecked={vendorPacks.length > 0 && vendorSelected === vendorPacks.length}
            branchIndeterminate={vendorSelected > 0 && vendorSelected < vendorPacks.length}
            onBranchCheck={() => toggleGroup(vendorPacks)}
          />
          {vendorOpen &&
            vendor.families.map((family) => {
              const familyOpen = searching || expandedFamilies.has(family.name);
              const familyPacks = groupPacks(family.devices);
              const familySelected = familyPacks.filter((pack) => picked.has(pack)).length;
              return (
                <div key={family.name}>
                  <TreeRow
                    depth={1}
                    label={family.name}
                    count={family.devices.length}
                    open={familyOpen}
                    onToggle={() => toggleFamily(family.name)}
                    branchCheckable
                    branchChecked={familyPacks.length > 0 && familySelected === familyPacks.length}
                    branchIndeterminate={familySelected > 0 && familySelected < familyPacks.length}
                    onBranchCheck={() => toggleGroup(familyPacks)}
                  />
                  {familyOpen &&
                    family.devices.map((device) => {
                      const task = tasks[device.pack];
                      const installed = installedPacks.has(device.pack);
                      return (
                        <TreeRow
                          key={device.name}
                          depth={2}
                          label={device.name}
                          badge={device.builtin ? t("packBuiltin") : undefined}
                          builtin={device.builtin}
                          selected={selected?.name === device.name}
                          onToggle={() => selectDevice(device, vendor.name, family.name)}
                          checkable={!device.builtin && !installed}
                          checked={picked.has(device.pack)}
                          onCheck={() => togglePicked(device.pack)}
                          installed={installed}
                          downloading={task?.status === "downloading"}
                          downloadDone={task?.status === "done"}
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
                disabled={selectedInstalled || task?.status === "done"}
                color={selectedInstalled || task?.status === "done" ? "green" : "blue"}
                styles={{ root: { minWidth: 130 } }}
              >
                {selectedInstalled || task?.status === "done" ? t("packInstalled") : t("installPack")}
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
        body: { maxHeight: "75vh", overflow: "hidden", display: "flex", flexDirection: "column" },
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
          {/* 左：器件树（行内勾选 + 下载） */}
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
              ) : (
                renderTree()
              )}
            </div>
          </div>

          {/* 右：器件详情 */}
          <div className="pack-detail-panel">{renderDetail()}</div>
        </div>

        {/* 底部固定批量下载栏 + 下载进度（始终可见） */}
        <div className="pack-download-bar">
          <Group justify="space-between" align="center" wrap="nowrap">
            <Text fz={12} c="dimmed" className="ellipsis" style={{ flex: 1, minWidth: 0 }}>
              {t("deviceCount").replace("{count}", String(totalCount))}
              {picked.size > 0 && ` · ${t("selectedCount").replace("{count}", String(picked.size))}`}
              {doneCount > 0 && ` · ${t("downloadedCount").replace("{count}", String(doneCount))}`}
              {queue.length > 0 && ` · 等待 ${queue.length}`}
              {activeCount > 0 && ` · 下载中 ${activeCount}/${MAX_CONCURRENT}`}
            </Text>
            <Button
              size="sm"
              leftSection={<CloudDownload size={14} />}
              onClick={downloadSelected}
              disabled={picked.size === 0}
              styles={{ root: { minWidth: 140, flexShrink: 0 } }}
            >
              {t("downloadSelected")}
              {picked.size > 0 ? ` (${picked.size})` : ""}
            </Button>
          </Group>

          {/* 下载进度（固定底部，始终可见） */}
          {Object.keys(tasks).length > 0 && (
            <Stack gap={4} mt={8}>
              {Object.entries(tasks)
                .filter(([, task]) => task.status === "downloading")
                .map(([pack, task]) => {
                  const doneMb = task.downloadedBytes ? (task.downloadedBytes / 1048576).toFixed(1) : "?";
                  const totalMb = task.totalBytes ? (task.totalBytes / 1048576).toFixed(1) : "?";
                  return (
                    <Tooltip
                      key={pack}
                      label={`${pack}\n${doneMb} MB / ${totalMb} MB · ${task.pct}%`}
                      multiline
                      withArrow
                    >
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
      </Stack>
    </Modal>
  );
}
