import type { Session } from "./types";
import { AssistantText } from "./AssistantText";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCard } from "./tool/ToolCard";

interface Props {
  session: Session;
  shortId: string;
  showReasoning: boolean;
}

// Stripped-down Thread variant for subagent traces:
//   - no UserPrompt numbering (the dispatch prompt is shown by the parent
//     AgentBody, and subagent inner user records are just the synthetic
//     dispatch echo)
//   - no turn separators
//   - no PrCard
//   - same tool/assistant/thinking rendering
//
// NOTE: shortId is accepted for forward compatibility with Task 4.3, which
// will thread it through ToolCard so nested AgentBody instances can issue
// the right lazy-fetch requests. For now, ToolCard does not accept these
// props yet; once 4.3 lands, this component will forward shortId (and the
// session's agents list) into ToolCard.
export function NestedThread({ session, shortId: _shortId, showReasoning }: Props) {
  const stream = session.stream;
  const root = session.meta.cwd;

  const out: React.ReactNode[] = [];
  for (let i = 0; i < stream.length; i++) {
    const e = stream[i];
    const key = `nested-${e.kind}-${i}`;
    if (e.kind === "assistant_text") {
      out.push(<AssistantText event={e} key={key} />);
    } else if (e.kind === "thinking") {
      if (showReasoning) out.push(<ThinkingBlock event={e} key={key} />);
    } else if (e.kind === "tool_use") {
      // TODO Task 4.3: pass shortId + agents once ToolCard accepts them so
      // nested AgentBody can fetch its own subagent traces.
      out.push(
        <ToolCard
          event={e}
          root={root}
          followingPrompt={null}
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
