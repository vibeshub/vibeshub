import type { ToolResult } from "../types";
import { clip, shortenPath } from "../format";
import { IconFile } from "../icons";

interface ReadProps {
  mode: "read";
  input: Record<string, unknown>;
  result: ToolResult | null;
  root: string | null;
}
interface WriteProps {
  mode: "write";
  input: Record<string, unknown>;
  root: string | null;
}

type Props = ReadProps | WriteProps;

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function readOutput(result: ToolResult | null): string {
  if (!result) return "";
  const c = result.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((b) => {
        if (typeof b === "string") return b;
        if (b && typeof b === "object") {
          const o = b as Record<string, unknown>;
          return asString(o.text) || asString(o.content);
        }
        return "";
      })
      .join("\n");
  }
  return "";
}

export function FileBody(props: Props) {
  const root = props.root;
  if (props.mode === "read") {
    const path = asString(props.input.file_path) || asString(props.input.path);
    const out = readOutput(props.result);
    const lineCount = out ? out.split("\n").length : null;
    return (
      <>
        <div className="file-card">
          <IconFile />
          <span className="file-path">{shortenPath(path, root)}</span>
          {lineCount != null && (
            <span className="file-stats">{lineCount} lines</span>
          )}
        </div>
        {out && (
          <>
            <h4>Preview</h4>
            <div className="bash-out">{clip(out, 8000)}</div>
          </>
        )}
      </>
    );
  }

  const path = asString(props.input.file_path) || asString(props.input.path);
  const content =
    asString(props.input.content) || asString(props.input.new_string);
  const lineCount = content ? content.split("\n").length : null;
  return (
    <>
      <div className="file-card">
        <IconFile />
        <span className="file-path">{shortenPath(path, root)}</span>
        {lineCount != null && (
          <span className="file-stats">{lineCount} lines</span>
        )}
      </div>
      {content && (
        <>
          <h4>Content</h4>
          <div className="bash-out">{clip(content, 10000)}</div>
        </>
      )}
    </>
  );
}
