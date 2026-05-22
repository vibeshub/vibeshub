import { useState } from "react";
import type { AgentSummary, ProgressEvent, ToolUseEvent } from "../types";
import { fmtTimeOfDay } from "../format";
import { formatBreakdown } from "../tools";
import { Chev } from "../icons";
import { ToolCard } from "./ToolCard";

// One tool call inside a group, carrying the per-call props ToolCard needs.
export interface ToolGroupItem {
  event: ToolUseEvent;
  followingPrompt: string | null;
  progress: ProgressEvent[];
}

interface Props {
  items: ToolGroupItem[];
  root: string | null;
  shortId: string;
  agents: AgentSummary[];
}

// A run of consecutive tool calls, collapsed into one summary line.
export function ToolGroup({ items, root, shortId, agents }: Props) {
  const [open, setOpen] = useState(false);
  const n = items.length;
  const breakdown = formatBreakdown(items.map((it) => it.event.name));
  const isErr = items.some((it) => !!it.event.result?.isError);
  const firstTs = items[0]?.event.ts;

  return (
    <div className={"tool-group" + (open ? " is-open" : "")}>
      <button
        className="tool-group-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        type="button"
      >
        <Chev />
        <span className="tool-group-count">
          {n} tool call{n === 1 ? "" : "s"}
        </span>
        <span className="tool-group-breakdown">{breakdown}</span>
        {isErr && <span className="tool-error-dot" title="error" />}
        <span className="tool-meta-r">{fmtTimeOfDay(firstTs)}</span>
      </button>
      {open && (
        <div className="tool-group-body">
          {items.map((it) => (
            <ToolCard
              event={it.event}
              root={root}
              followingPrompt={it.followingPrompt}
              shortId={shortId}
              agents={agents}
              progress={it.progress}
              key={it.event.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
