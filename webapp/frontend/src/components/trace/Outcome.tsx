import { useEffect, useMemo, useRef, useState } from "react";
import type { Session, StreamEvent } from "./types";
import type { TraceSummary } from "../../types";
import {
  fmtDuration,
  fmtDurationCompact,
  shortenPath,
} from "./format";
import { FILE_EDIT_TOOLS, type SubagentEntry } from "./changes";

interface Props {
  session: Session;
  trace: TraceSummary;
  subagents: SubagentEntry[];
  subagentsLoading: boolean;
}

interface TouchedFile {
  path: string;
  kind: "new" | "mod";
}

// Aggressively shorten paths that fall outside cwd: keep the last few
// segments with a leading ellipsis so the row doesn't overflow the card.
function tightPath(absolute: string, root: string | null): string {
  const short = shortenPath(absolute, root);
  if (short !== absolute) return short;
  const parts = absolute.split("/").filter(Boolean);
  if (parts.length <= 3) return absolute;
  return "…/" + parts.slice(-3).join("/");
}

// Files touched = unique paths written to via Write / Edit / MultiEdit, taken
// across the parent stream AND every subagent stream. Treat the first write
// to a path as "new" only when we never observed a Read for that path
// anywhere in the combined trace — otherwise it's a "mod".
function deriveFiles(
  streams: StreamEvent[][],
  root: string | null,
): TouchedFile[] {
  const reads = new Set<string>();
  const writes: Array<{ path: string; name: string; ts: string }> = [];
  for (const stream of streams) {
    for (const e of stream) {
      if (e.kind !== "tool_use") continue;
      const fp =
        typeof e.input?.file_path === "string"
          ? (e.input.file_path as string)
          : null;
      if (!fp) continue;
      if (e.name === "Read") reads.add(fp);
      if (FILE_EDIT_TOOLS.has(e.name)) {
        writes.push({ path: fp, name: e.name, ts: e.ts });
      }
    }
  }
  writes.sort((a, b) => a.ts.localeCompare(b.ts));
  const kindByPath = new Map<string, "new" | "mod">();
  for (const w of writes) {
    if (kindByPath.has(w.path)) continue;
    const kind: "new" | "mod" =
      w.name === "Write" && !reads.has(w.path) ? "new" : "mod";
    kindByPath.set(w.path, kind);
  }
  const out: TouchedFile[] = [];
  for (const [path, kind] of kindByPath) {
    out.push({ path: tightPath(path, root), kind });
  }
  return out;
}

function lastAssistantText(stream: StreamEvent[]): string | null {
  for (let i = stream.length - 1; i >= 0; i--) {
    const e = stream[i];
    if (e.kind === "assistant_text" && e.text.trim()) return e.text.trim();
  }
  return null;
}

function StatCell({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="meta-cell outcome-stat">
      <div className="meta-label">{label}</div>
      <div className="meta-value">{value}</div>
      {sub && <div className="meta-sub">{sub}</div>}
    </div>
  );
}

const FILES_COLLAPSED = 6;

export function Outcome({
  session,
  trace,
  subagents,
  subagentsLoading,
}: Props) {
  const { meta, stream } = session;
  const isTextImport = meta.sourceFormat === "terminal";
  const start = meta.startedAt ? Date.parse(meta.startedAt) : 0;
  const end = meta.endedAt ? Date.parse(meta.endedAt) : 0;
  const wall = Math.max(0, end - start);
  const distinctToolCount = Object.keys(meta.toolCounts).length;
  const subStreams = useMemo(
    () => subagents.map((s) => s.stream),
    [subagents],
  );
  const subLoading = subagentsLoading;

  const files = useMemo(
    () => deriveFiles([stream, ...subStreams], meta.cwd),
    [stream, subStreams, meta.cwd],
  );

  const summary = lastAssistantText(stream);
  const linkedPr = trace.pr_url && trace.pr_number != null;

  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [summaryOverflow, setSummaryOverflow] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  // After render, check whether the line-clamp is actually hiding anything.
  // If not, suppress the "Show more" toggle so it doesn't appear for short
  // summaries that already fit.
  useEffect(() => {
    if (!summary) {
      setSummaryOverflow(false);
      return;
    }
    const el = summaryRef.current;
    if (!el) return;
    setSummaryOverflow(el.scrollHeight > el.clientHeight + 1);
  }, [summary, subLoading]);

  const [filesExpanded, setFilesExpanded] = useState(false);
  const visibleFiles = filesExpanded ? files : files.slice(0, FILES_COLLAPSED);
  const extraFiles = Math.max(0, files.length - FILES_COLLAPSED);

  return (
    <div className="outcome-grid">
      <section className="outcome-card">
        <div className="outcome-stats">
          {isTextImport ? (
            <StatCell
              label="Active Time"
              value="n/a"
              sub="not available for text imports"
            />
          ) : (
            <StatCell
              label="Active Time"
              value={fmtDurationCompact(meta.assistantThinkMs)}
              sub={`wall: ${fmtDuration(wall)}`}
            />
          )}
          <StatCell
            label="Turns"
            value={meta.userPromptCount}
            sub={`${meta.assistantTextCount} replies`}
          />
          <StatCell
            label="Tool calls"
            value={meta.toolCallCount}
            sub={`${distinctToolCount} distinct tools`}
          />
        </div>
        <h4>Result</h4>
        <span className={"outcome-status " + (linkedPr ? "ok" : "neutral")}>
          <span className="dot" />
          {linkedPr ? "Linked PR" : "Standalone session"}
        </span>
        {!linkedPr &&
          (summary ? (
            <>
              <div
                ref={summaryRef}
                className={
                  "outcome-summary" + (summaryExpanded ? " expanded" : "")
                }
              >
                {summary}
              </div>
              {summaryOverflow && (
                <button
                  type="button"
                  className="outcome-toggle"
                  onClick={() => setSummaryExpanded((v) => !v)}
                >
                  {summaryExpanded ? "Show less" : "Show more"}
                </button>
              )}
            </>
          ) : (
            <div className="outcome-summary outcome-summary--empty">
              No closing message in this trace.
            </div>
          ))}
        {linkedPr && (
          <a
            href={trace.pr_url!}
            target="_blank"
            rel="noreferrer"
            className="outcome-pr"
          >
            <span className="pr-num">PR #{trace.pr_number}</span>
            {trace.pr_title && (
              <span className="pr-title">{trace.pr_title}</span>
            )}
          </a>
        )}
      </section>

      <section className="outcome-card">
        <h4>
          Files touched · {files.length}
          {subLoading && (
            <span className="outcome-loading"> · loading subagents…</span>
          )}
        </h4>
        {files.length === 0 && !subLoading ? (
          <div className="outcome-empty">No file writes recorded.</div>
        ) : (
          <ul className="outcome-files">
            {visibleFiles.map((f) => (
              <li key={f.path} className="outcome-file">
                <span className={"outcome-badge " + f.kind}>
                  {f.kind === "new" ? "new" : "mod"}
                </span>
                <span className="outcome-path" title={f.path}>
                  {f.path}
                </span>
              </li>
            ))}
            {extraFiles > 0 && (
              <li>
                <button
                  type="button"
                  className="outcome-files-more"
                  onClick={() => setFilesExpanded((v) => !v)}
                  aria-expanded={filesExpanded}
                >
                  {filesExpanded ? "Show fewer" : `+ ${extraFiles} more`}
                </button>
              </li>
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
