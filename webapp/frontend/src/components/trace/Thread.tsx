import type { Session, StreamEvent } from "./types";
import { UserPrompt } from "./UserPrompt";
import { AssistantText } from "./AssistantText";
import { ThinkingBlock } from "./ThinkingBlock";
import { SystemEventRow } from "./SystemEventRow";
import { PrCard } from "./PrCard";
import { ToolCard } from "./tool/ToolCard";

interface Props {
  session: Session;
  showReasoning: boolean;
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
  showReasoning,
  showSystemEvents,
}: Props) {
  const stream = session.stream;
  const root = session.meta.cwd;
  const totalPrompts = session.meta.userPromptCount;
  const nextPrompt = buildNextPromptIndex(stream);
  const promptUuids: string[] = [];
  for (const ev of stream) {
    if (ev.kind === "user_prompt" && ev.uuid) promptUuids.push(ev.uuid);
  }

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
      if (showReasoning) out.push(<ThinkingBlock event={e} key={key} />);
      continue;
    }
    if (e.kind === "tool_use") {
      out.push(
        <ToolCard
          event={e}
          root={root}
          followingPrompt={nextPrompt[i]}
          key={key}
        />,
      );
      continue;
    }
    if (e.kind === "pr_link") {
      out.push(<PrCard event={e} key={key} />);
      continue;
    }
    if (showSystemEvents && isSystemish(e)) {
      out.push(<SystemEventRow event={e} key={key} />);
    }
  }

  return <div className="thread">{out}</div>;
}
