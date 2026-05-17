import { clip } from "../format";

interface Props {
  input: Record<string, unknown>;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function AgentBody({ input }: Props) {
  const subagent = asString(input.subagent_type) || "general";
  const model = asString(input.model) || "default";
  const description = asString(input.description);
  const prompt = asString(input.prompt);
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
    </div>
  );
}
