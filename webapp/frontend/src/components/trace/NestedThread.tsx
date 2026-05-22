import type { Session } from "./types";
import { AssistantText } from "./AssistantText";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCard } from "./tool/ToolCard";
import { progressByTool } from "./parser";

interface Props {
  session: Session;
  shortId: string;
}

// Stripped-down Thread variant for subagent traces:
//   - no UserPrompt numbering (the dispatch prompt is shown by the parent
//     AgentBody, and subagent inner user records are just the synthetic
//     dispatch echo)
//   - no turn separators
//   - no PrCard
//   - same tool/assistant/thinking rendering
//
// shortId and the subagent session's own agents list are forwarded into
// ToolCard so any nested Agent tool use can lazy-fetch its own subagent
// trace recursively.
export function NestedThread({ session, shortId }: Props) {
  const stream = session.stream;
  const root = session.meta.cwd;
  const agents = session.meta.agents ?? [];
  const hooksByTool = progressByTool(stream);

  const out: React.ReactNode[] = [];
  for (let i = 0; i < stream.length; i++) {
    const e = stream[i];
    const key = `nested-${e.kind}-${i}`;
    if (e.kind === "assistant_text") {
      out.push(<AssistantText event={e} key={key} />);
    } else if (e.kind === "thinking") {
      out.push(<ThinkingBlock event={e} key={key} />);
    } else if (e.kind === "tool_use") {
      out.push(
        <ToolCard
          event={e}
          root={root}
          followingPrompt={null}
          shortId={shortId}
          agents={agents}
          progress={hooksByTool.get(e.id) ?? []}
          key={key}
        />,
      );
    }
    // Intentionally skip user_prompt, system events, attachments — the
    // subagent's synthetic user is just the dispatch prompt echo, and
    // system events are noise inside a nested thread.
  }

  return <div className="nested-thread">{out}</div>;
}
