import type { ToolResult } from "../types";
import { clip, shortenPath } from "../format";
import { IconFile } from "../icons";
import { DiffView } from "./DiffView";
import { buildWriteRows, extractPatch } from "../diff";
import { langFromPath } from "../highlight";

interface ReadProps {
  mode: "read";
  input: Record<string, unknown>;
  result: ToolResult | null;
  root: string | null;
}
interface WriteProps {
  mode: "write";
  input: Record<string, unknown>;
  result: ToolResult | null;
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
  const patch = extractPatch(props.result?.toolUseResult?.structuredPatch);
  const rows = buildWriteRows(props.input, patch);
  const lang = langFromPath(path);
  const added = rows.filter((r) => r.kind === "add").length;
  const removed = rows.filter((r) => r.kind === "del").length;
  return (
    <>
      <div className="file-card">
        <IconFile />
        <span className="file-path">{shortenPath(path, root)}</span>
        {(added > 0 || removed > 0) && (
          <span className="file-stats">
            {added > 0 && <span className="diff-stat-add">+{added}</span>}
            {removed > 0 && <span className="diff-stat-del">−{removed}</span>}
          </span>
        )}
      </div>
      {rows.length > 0 ? (
        <>
          <h4>Changes</h4>
          <DiffView rows={rows} lang={lang} />
        </>
      ) : null}
    </>
  );
}
