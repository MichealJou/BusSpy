import { ActionIcon, Button, Checkbox, Combobox, Group, InputBase, Modal, SegmentedControl, Select, Tabs, Text, TextInput, Tooltip, useCombobox } from "@mantine/core";
import { Pencil, RotateCcw, Send } from "lucide-react";
import { useRef } from "react";
import { useState } from "react";
import { HelpTip } from "../../../components/help/HelpTip";
import { useI18n } from "../../../i18n";
import { intervals, quickCommands } from "../lib/constants";
import { bytesToHex } from "../lib/format";
import type { SerialConsoleState } from "../lib/types";
import { FrameMarkerPanel } from "./FrameMarkerPanel";

interface SendPanelProps {
  state: SerialConsoleState;
}

export function SendPanel({ state }: SendPanelProps) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [labelModalOpened, setLabelModalOpened] = useState(false);
  const [labelName, setLabelName] = useState("");
  const sendMemoryCombobox = useCombobox({
    onDropdownClose: () => sendMemoryCombobox.resetSelectedOption(),
  });

  const sendQuery = state.sendText.trim().toLowerCase();
  const labeledTexts = new Set(state.commandLabels.map((item) => item.text));
  const matchesQuery = (value: string) => !sendQuery || value.toLowerCase().includes(sendQuery);
  const memoryOptions = [
    ...state.commandLabels
      .filter((item) => matchesQuery(item.name) || matchesQuery(item.text))
      .map((item) => (
        <Combobox.Option value={`label:${item.id}`} key={`label-${item.id}`}>
          <span className="command-option-name">{item.name}</span>
          <span className="command-option-code">{item.text}</span>
        </Combobox.Option>
      )),
    ...state.history
      .filter((item) => !labeledTexts.has(item))
      .filter(matchesQuery)
      .map((item) => (
        <Combobox.Option value={item} key={item}>
          {item}
        </Combobox.Option>
      )),
  ];

  return (
    <>
      <div className="send-card">
        <div className="panel-header compact">
          <div className="send-title-group">
            <Text className="section-title">{t("sendData")}</Text>
            <HelpTip label={t("sendHelp")} />
            <Text className={state.sendAnalysis.isValidHex ? "send-byte-count" : "send-byte-count invalid"}>
              {t("chars")} {state.sendAnalysis.chars} · {t("bytes")} {state.sendAnalysis.bytes}
              {state.sendHexMode ? ` · ${t("hexBytes")} ${state.sendAnalysis.hexBytes}` : ""}
              {!state.sendAnalysis.isValidHex ? ` · ${t("invalidHex")}` : ""}
            </Text>
          </div>
          <Group gap="sm" className="send-options">
            <SegmentedControl
              className="send-mode-control"
              aria-label={t("sendMode")}
              data={[
                { value: "text", label: t("textMode") },
                { value: "hex", label: "HEX" },
              ]}
              value={state.sendHexMode ? "hex" : "text"}
              onChange={(value) => state.setSendHexMode(value === "hex")}
            />
            <Checkbox label={t("addNewline")} checked={state.appendNewline} onChange={(event) => state.setAppendNewline(event.currentTarget.checked)} disabled={state.sendHexMode} />
            <Checkbox label={t("timedSend")} checked={state.timedSend} onChange={(event) => state.setTimedSend(event.currentTarget.checked)} disabled={!state.isConnected} />
            <Select
              className="interval-select"
              data={intervals.map((item) => ({ value: item, label: `${item} ms` }))}
              value={state.intervalMs}
              onChange={(value) => state.setIntervalMs(value ?? "1000")}
            />
          </Group>
        </div>
        <div className="send-row">
          <Combobox
            store={sendMemoryCombobox}
            onOptionSubmit={(value) => {
              if (value.startsWith("label:")) {
                const label = state.commandLabels.find((item) => String(item.id) === value.slice("label:".length));
                if (label) {
                  state.setSendHexMode(label.hex);
                  state.setSendText(label.text);
                }
                sendMemoryCombobox.closeDropdown();
                return;
              }
              state.setSendText(value);
              sendMemoryCombobox.closeDropdown();
            }}
          >
            <Combobox.Target>
              <InputBase
                className="send-input"
                placeholder={state.sendHexMode ? t("hexPlaceholder") : t("sendPlaceholder")}
                value={state.sendText}
                onChange={(event) => {
                  state.setSendText(event.currentTarget.value);
                  sendMemoryCombobox.openDropdown();
                }}
                onClick={() => sendMemoryCombobox.openDropdown()}
                onFocus={() => sendMemoryCombobox.openDropdown()}
                onBlur={() => {
                  state.rememberSendText();
                  sendMemoryCombobox.closeDropdown();
                }}
                rightSection={<Combobox.Chevron />}
                rightSectionPointerEvents="none"
              />
            </Combobox.Target>
            <Combobox.Dropdown>
              <Combobox.Options>
                {memoryOptions.length > 0 ? memoryOptions : <Combobox.Empty>{t("memoryEmpty")}</Combobox.Empty>}
              </Combobox.Options>
            </Combobox.Dropdown>
          </Combobox>
          <Tooltip label={t("addCommandLabel")}>
            <ActionIcon
              className="label-edit-button"
              variant="light"
              disabled={!state.sendText.trim()}
              onClick={() => {
                setLabelName("");
                setLabelModalOpened(true);
              }}
            >
              <Pencil size={16} />
            </ActionIcon>
          </Tooltip>
          <div className="send-actions">
            <Button className="send-button" leftSection={<Send size={16} />} disabled={!state.isConnected || !state.sendText.trim()} onClick={() => void state.sendCurrentText()}>
              {t("send")}
            </Button>
            <Button className="send-button" variant="light" color="gray" leftSection={<RotateCcw size={16} />} onClick={() => void state.runLoopbackTest()}>
              {t("selfTest")}
            </Button>
          </div>
        </div>
        <div className="send-extra-row">
          <input
            ref={fileInputRef}
            className="hidden-file-input"
            type="file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (!file) {
                return;
              }
              if (state.sendHexMode) {
                file.arrayBuffer().then((buffer) => {
                  state.setSendText(bytesToHex(Array.from(new Uint8Array(buffer))));
                });
              } else {
                file.text().then(state.setSendText);
              }
              event.currentTarget.value = "";
            }}
          />
          <Group gap={4} className="send-file-group">
            <Button variant="light" color="gray" className="file-button" onClick={() => fileInputRef.current?.click()}>
              {t("sendFile")}
            </Button>
            <HelpTip label={t("sendFileHelp")} />
          </Group>
          <Text size="xs" c="dimmed" className="checksum-label">{t("checksum")}</Text>
          <HelpTip label={t("checksumHelp")} />
          <Select
            className="checksum-select"
            aria-label={t("checksum")}
            data={[
              { value: "none", label: "None" },
              { value: "sum", label: "SUM" },
              { value: "xor", label: "XOR" },
              { value: "crc8", label: "CRC8" },
              { value: "crc16", label: "CRC16" },
              { value: "modbus-crc16", label: "Modbus CRC16" },
            ]}
            value={state.checksumType}
            onChange={(value) => state.setChecksumType(value ?? "none")}
          />
          <Group gap="xs" className="checksum-range">
            <Text size="xs" c="dimmed">{t("checksumRange")}</Text>
            <HelpTip label={t("checksumRangeHelp")} />
            <TextInput aria-label={t("checksumStart")} value={state.checksumStart} onChange={(event) => state.setChecksumStart(event.currentTarget.value)} />
            <Text size="xs" c="dimmed">-</Text>
            <TextInput aria-label={t("checksumEnd")} value={state.checksumEnd} onChange={(event) => state.setChecksumEnd(event.currentTarget.value)} />
          </Group>
        </div>
      </div>

      <Modal opened={labelModalOpened} onClose={() => setLabelModalOpened(false)} title={t("addCommandLabel")} centered>
        <TextInput
          label={t("commandLabel")}
          placeholder={t("commandLabelPlaceholder")}
          value={labelName}
          onChange={(event) => setLabelName(event.currentTarget.value)}
          data-autofocus
        />
        <Group justify="flex-end" mt="md">
          <Button variant="light" color="gray" onClick={() => setLabelModalOpened(false)}>
            {t("cancel")}
          </Button>
          <Button
            disabled={!labelName.trim()}
            onClick={() => {
              void state.saveCurrentCommandLabel(labelName.trim()).then(() => {
                setLabelName("");
                setLabelModalOpened(false);
              });
            }}
          >
            {t("save")}
          </Button>
        </Group>
      </Modal>

      <Tabs defaultValue="quick" className="quick-tabs">
        <Tabs.List>
          <Tabs.Tab value="quick">{t("quickCommands")}</Tabs.Tab>
          <Tabs.Tab value="history">{t("sendHistory")}</Tabs.Tab>
          <Tabs.Tab value="parser">{t("parser")}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="quick">
          <div className="quick-grid">
            {quickCommands.map((item) => (
              <Button
                key={item}
                variant="light"
                color="gray"
                onClick={() => {
                  state.setSendText(item);
                  if (state.isConnected) {
                    void state.sendCurrentText(item);
                  }
                }}
              >
                {item}
              </Button>
            ))}
          </div>
        </Tabs.Panel>
        <Tabs.Panel value="history">
          <div className="history-list">
            {state.history.length > 0 ? (
              <Button variant="light" color="red" onClick={state.clearSendHistory}>
                {t("clearMemory")}
              </Button>
            ) : null}
            {state.history.length === 0 ? (
              <Text size="sm" c="dimmed">
                {t("emptyHistory")}
              </Text>
            ) : (
              state.history.map((item) => (
                <Button key={item} variant="subtle" color="gray" onClick={() => state.setSendText(item)}>
                  {item}
                </Button>
              ))
            )}
          </div>
        </Tabs.Panel>
        <Tabs.Panel value="parser">
          <FrameMarkerPanel state={state} />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}
