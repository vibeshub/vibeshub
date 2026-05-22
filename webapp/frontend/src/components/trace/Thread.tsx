import type { Session, StreamEvent } from "./types";
import { UserPrompt } from "./UserPrompt";
import { AssistantText } from "./AssistantText";
import { ThinkingBlock } from "./ThinkingBlock";
import { SystemEventRow } from "./SystemEventRow";
import { PrCard } from "./PrCard";
import { ToolCard } from "./tool/ToolCard";
import { progressByTool } from "./parser";

interface Props {
  session: Session;
  shortId: string;
  showSystemEvents: boolean;
}

function isSystemish(e: StreamEvent): boolean {
  return (
    e.kind === "attachment" ||
    e.kind === "system_event" ||
    e.kind === "file_snapshot" ||
    e.kind === "system_text"
  );
}

function buildNextPromptIndex(stream: StreamEvent[]): Array<string | null> {
  const next: Array<string | null> = new Array(stream.length).fill(null);
  let cur: string | null = null;
  for (let i = stream.length - 1; i >= 0; i--) {
    next[i] = cur;
    if (stream[i].kind === "user_prompt") {
      cur = (stream[i] as { text: string }).text;
    }
  }
  return next;
}

export function Thread({
  session,
  shortId,
  showSystemEvents,
}: Props) {
  const stream = session.stream;
  const root = session.meta.cwd;
  const totalPrompts = session.meta.userPromptCount;
  const agents = session.meta.agents ?? [];
  const nextPrompt = buildNextPromptIndex(stream);
  const promptUuids: string[] = [];
  const toolIds = new Set<string>();
  for (const ev of stream) {
    if (ev.kind === "user_prompt" && ev.uuid) promptUuids.push(ev.uuid);
    if (ev.kind === "tool_use") toolIds.add(ev.id);
  }
  const hooksByTool = progressByTool(stream);

  const out: React.ReactNode[] = [];
  let promptCounter = -1;

  for (let i = 0; i < stream.length; i++) {
    const e = stream[i];
    const key = `${e.kind}-${i}`;

    if (e.kind === "user_prompt") {
      promptCounter++;
      if (promptCounter > 0) {
        out.push(<div className="turn-sep" key={`sep-${i}`} />);
      }
      out.push(
        <UserPrompt
          event={e}
          idx={promptCounter}
          total={totalPrompts}
          nextPromptUuid={promptUuids[promptCounter + 1]}
          key={key}
        />,
      );
      continue;
    }
    if (e.kind === "assistant_text") {
      out.push(<AssistantText event={e} key={key} />);
      continue;
    }
    if (e.kind === "thinking") {
      out.push(<ThinkingBlock event={e} key={key} />);
      continue;
    }
    if (e.kind === "tool_use") {
      out.push(
        <ToolCard
          event={e}
          root={root}
          followingPrompt={nextPrompt[i]}
          shortId={shortId}
          agents={agents}
          progress={hooksByTool.get(e.id) ?? []}
          key={key}
        />,
      );
      continue;
    }
    if (e.kind === "pr_link") {
      out.push(<PrCard event={e} key={key} />);
      continue;
    }
    if (e.kind === "progress") {
      // Progress events for a tool in this stream are shown inside that
      // tool's card; only orphans (no parent tool here) render standalone.
      const orphan = !e.parentToolUseID || !toolIds.has(e.parentToolUseID);
      if (orphan && showSystemEvents) {
        out.push(<SystemEventRow event={e} key={key} />);
      }
      continue;
    }
    if (showSystemEvents && isSystemish(e)) {
      out.push(<SystemEventRow event={e} key={key} />);
    }
  }

  return <div className="thread">{out}</div>;
}
