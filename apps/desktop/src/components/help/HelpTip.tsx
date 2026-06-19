import { ActionIcon, Tooltip } from "@mantine/core";
import { CircleHelp } from "lucide-react";

interface HelpTipProps {
  label: string;
}

export function HelpTip({ label }: HelpTipProps) {
  return (
    <Tooltip label={label} multiline maw={280} openDelay={180}>
      <ActionIcon className="help-tip" variant="subtle" color="gray" size="sm" aria-label={label}>
        <CircleHelp size={14} />
      </ActionIcon>
    </Tooltip>
  );
}
