import { SegmentedControl, Table, Text } from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { HelpTip } from "../../../components/help/HelpTip";
import { useI18n } from "../../../i18n";
import { parseHexFrame, type FrameByteMark } from "../lib/protocolFrame";
import type { SerialConsoleState } from "../lib/types";

interface FrameMarkerPanelProps {
  state: SerialConsoleState;
}

export function FrameMarkerPanel({ state }: FrameMarkerPanelProps) {
  const { t } = useI18n();
  const [viewMode, setViewMode] = useState<"bytes" | "fields">("bytes");
  const [sourceMode, setSourceMode] = useState<"send" | "receive">("receive");
  const latestReceiveLog = useMemo(() => [...state.logs].reverse().find((log) => log.direction === "rx"), [state.logs]);
  const frameText = sourceMode === "send" ? state.sendText : latestReceiveLog?.hex ?? "";
  const marks = useMemo(() => parseHexFrame(frameText), [frameText]);
  const hint = sourceMode === "send" ? (state.sendHexMode ? t("frameMarkerEmpty") : t("frameMarkerHexOnly")) : t("receiveFrameEmpty");
  const hasFrame = sourceMode === "send" ? state.sendHexMode && state.sendText.trim() && marks.length > 0 : Boolean(latestReceiveLog?.hex && marks.length > 0);

  return (
    <div className="frame-marker">
      <div className="frame-marker-head">
        <div className="frame-marker-title-group">
          <Text className="frame-marker-title">{t("frameMarker")}</Text>
          <HelpTip label={t("frameMarkerHelp")} />
        </div>
        <div className="frame-marker-controls">
          <SegmentedControl
            className="frame-source-control"
            size="xs"
            data={[
              { value: "receive", label: t("receiveFrame") },
              { value: "send", label: t("sendFrame") },
            ]}
            value={sourceMode}
            onChange={(value) => setSourceMode(value as "send" | "receive")}
          />
          <SegmentedControl
            className="frame-view-control"
            size="xs"
            data={[
              { value: "bytes", label: t("byteView") },
              { value: "fields", label: t("fieldView") },
            ]}
            value={viewMode}
            onChange={(value) => setViewMode(value as "bytes" | "fields")}
          />
        </div>
        {hasFrame ? <Text className="frame-marker-summary">{`${t("byteIndex")} 0-${Math.max(0, marks.length - 1)}`}</Text> : <div />}
      </div>
      <div className="frame-view-body">
        {viewMode === "bytes" ? (
          hasFrame ? (
            <VirtualByteTable marks={marks} />
          ) : (
            <Text size="xs" c="dimmed" className="frame-marker-hint">
              {hint}
            </Text>
          )
        ) : (
          hasFrame ? (
            <Table className="frame-field-table" withTableBorder={false} withColumnBorders={false}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("byteIndex")}</Table.Th>
                  <Table.Th>{t("bytes")}</Table.Th>
                  <Table.Th>{t("field")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {marks.map((mark) => (
                  <Table.Tr key={`${mark.index}-${mark.value}-${mark.kind}`}>
                    <Table.Td>{mark.index}</Table.Td>
                    <Table.Td className="frame-field-byte">{mark.value}</Table.Td>
                    <Table.Td>{t(mark.kind)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : (
            <Text size="xs" c="dimmed" className="frame-marker-hint">
              {hint}
            </Text>
          )
        )}
      </div>
    </div>
  );
}

function VirtualByteTable({ marks }: { marks: FrameByteMark[] }) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(720);
  const columnWidth = 112;
  const overscan = 4;
  const totalWidth = marks.length * columnWidth;
  const startIndex = Math.max(0, Math.floor(scrollLeft / columnWidth) - overscan);
  const visibleCount = Math.ceil(viewportWidth / columnWidth) + overscan * 2;
  const endIndex = Math.min(marks.length, startIndex + visibleCount);
  const visibleMarks = marks.slice(startIndex, endIndex);
  const leftSpacerWidth = startIndex * columnWidth;
  const rightSpacerWidth = Math.max(0, (marks.length - endIndex) * columnWidth);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }

    function syncWidth() {
      setViewportWidth(node?.clientWidth ?? 720);
    }

    syncWidth();
    window.addEventListener("resize", syncWidth);
    return () => window.removeEventListener("resize", syncWidth);
  }, []);

  return (
    <div className="frame-virtual-table">
      <div
        className="frame-virtual-body horizontal"
        ref={scrollRef}
        onScroll={(event) => {
          setScrollLeft(event.currentTarget.scrollLeft);
          setViewportWidth(event.currentTarget.clientWidth);
        }}
      >
        <Table className="frame-byte-table single-row" withTableBorder={false} withColumnBorders style={{ width: totalWidth }}>
          <Table.Thead>
            <Table.Tr>
              {leftSpacerWidth > 0 ? <Table.Th className="frame-horizontal-spacer" style={{ width: leftSpacerWidth }} /> : null}
              {visibleMarks.map((mark) => (
                <Table.Th key={mark.index} style={{ width: columnWidth }}>
                  {mark.index}
                </Table.Th>
              ))}
              {rightSpacerWidth > 0 ? <Table.Th className="frame-horizontal-spacer" style={{ width: rightSpacerWidth }} /> : null}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            <Table.Tr>
              {leftSpacerWidth > 0 ? <Table.Td className="frame-horizontal-spacer" style={{ width: leftSpacerWidth }} /> : null}
              {visibleMarks.map((mark) => (
                <Table.Td key={`${mark.index}-${mark.value}`} className={`frame-byte-cell ${mark.kind}`} style={{ width: columnWidth }}>
                  <span className="frame-cell-value">{mark.value}</span>
                  <span className="frame-cell-field">{t(mark.kind)}</span>
                </Table.Td>
              ))}
              {rightSpacerWidth > 0 ? <Table.Td className="frame-horizontal-spacer" style={{ width: rightSpacerWidth }} /> : null}
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </div>
    </div>
  );
}
