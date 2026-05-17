import type { ToolResult } from "../types";
import { clip } from "../format";

interface Props {
  input: Record<string, unknown>;
  result: ToolResult | null;
}

function resultText(result: ToolResult | null): string {
  if (!result) return "";
  const c = result.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((b) => {
        if (typeof b === "string") return b;
        if (b && typeof b === "object") {
          const o = b as Record<string, unknown>;
          return typeof o.text === "string"
            ? o.text
            : typeof o.content === "string"
              ? o.content
              : "";
        }
        return "";
      })
      .join("\n");
  }
  const r = result.toolUseResult;
  if (r?.stdout) {
    return r.stderr ? `${r.stdout}\n${r.stderr}` : r.stdout;
  }
  return "";
}

export function BashBody({ input, result }: Props) {
  const cmd = typeof input.command === "string" ? input.command : "";
  const desc = typeof input.description === "string" ? input.description : "";
  const outText = resultText(result);
  const isErr = !!result?.isError;
  return (
    <>
      {desc && <div className="tool-body-desc">{desc}</div>}
      <h4>Command</h4>
      <div className="bash-block">
        <span className="bash-prompt">$ </span>
        <span className="bash-cmd">{cmd}</span>
      </div>
      {outText && (
        <>
          <h4>Output</h4>
          <div className={"bash-out" + (isErr ? " err" : "")}>
            {clip(outText, 12000)}
          </div>
        </>
      )}
    </>
  );
}
