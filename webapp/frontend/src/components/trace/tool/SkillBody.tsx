import { IconSkill } from "../icons";
import { clip } from "../format";
import type { ToolResult } from "../types";

interface Props {
  input: Record<string, unknown>;
  result: ToolResult | null;
}

export function SkillBody({ input, result }: Props) {
  const skill = typeof input.skill === "string" ? input.skill : "";
  const injected = result?.injectedText;
  return (
    <>
      <div className="file-card">
        <IconSkill />
        <span className="file-path mono">{skill}</span>
      </div>
      {injected && (
        <details>
          <summary className="subagent-summary">Skill body</summary>
          <div className="subagent-prompt">{clip(injected, 8000)}</div>
        </details>
      )}
    </>
  );
}
