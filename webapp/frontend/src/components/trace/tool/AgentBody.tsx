import { useState } from "react";
import { clip } from "../format";
import { fetchAgentJsonl } from "../../../api";
import { buildSession, parseJsonl } from "../parser";
import type { AgentSummary, Session } from "../types";
import { NestedThread } from "../NestedThread";

interface Props {
  input: Record<string, unknown>;
  toolUseId: string;
  shortId: string;
  agents: AgentSummary[];
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function AgentBody({ input, toolUseId, shortId, agents }: Props) {
  const subagent = asString(input.subagent_type) || "general";
  const model = asString(input.model) || "default";
  const description = asString(input.description);
  const prompt = asString(input.prompt);

  const linked = agents.find((a) => a.tool_use_id === toolUseId) ?? null;

  const [expanded, setExpanded] = useState(false);
  const [nested, setNested] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onToggle() {
    if (!linked) return;
    const next = !expanded;
    setExpanded(next);
    if (next && nested === null && !loading && !error) {
      setLoading(true);
      try {
        const jsonl = await fetchAgentJsonl(shortId, linked.agent_id);
        setNested(buildSession(parseJsonl(jsonl)));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="subagent-card">
      <div className="subagent-head">
        <span className="dot" />
        Subagent · {subagent} · {model}
      </div>
      {description && <div className="subagent-desc">{description}</div>}
      {prompt && (
        <details>
          <summary className="subagent-summary">Dispatch prompt</summary>
          <div className="subagent-prompt">{clip(prompt, 6000)}</div>
        </details>
      )}
      {linked && (
        <button
          type="button"
          className="subagent-expand-btn"
          onClick={onToggle}
          aria-expanded={expanded}
        >
          {expanded
            ? `▾ Hide subagent trace (${linked.message_count} msgs)`
            : `▸ Open subagent trace (${linked.message_count} msgs)`}
        </button>
      )}
      {expanded && loading && <div className="subagent-loading">Loading…</div>}
      {expanded && error && (
        <div className="subagent-error">Failed to load: {error}</div>
      )}
      {expanded && nested && (
        <NestedThread session={nested} shortId={shortId} showReasoning={false} />
      )}
    </div>
  );
}
