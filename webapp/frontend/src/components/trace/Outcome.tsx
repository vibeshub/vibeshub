import type { Session, StreamEvent } from "./types";
import type { TraceSummary } from "../../types";
import { shortenPath, fmtTokens } from "./format";

interface Props {
  session: Session;
  trace: TraceSummary;
}

interface TouchedFile {
  path: string;
  kind: "new" | "mod";
}

// Files touched = unique paths written to via Write / Edit / MultiEdit.
// Mark "new" only when the first action on a path is Write and we never
// observed a prior Read for that path — otherwise treat it as "mod".
function deriveFiles(
  stream: StreamEvent[],
  root: string | null,
): TouchedFile[] {
  const seenRead = new Set<string>();
  const firstKind = new Map<string, "new" | "mod">();
  for (const e of stream) {
    if (e.kind !== "tool_use") continue;
    const fp =
      typeof e.input?.file_path === "string"
        ? (e.input.file_path as string)
        : null;
    if (e.name === "Read" && fp) seenRead.add(fp);
    if (e.name === "Write" || e.name === "Edit" || e.name === "MultiEdit") {
      if (!fp || firstKind.has(fp)) continue;
      const kind: "new" | "mod" =
        e.name === "Write" && !seenRead.has(fp) ? "new" : "mod";
      firstKind.set(fp, kind);
    }
  }
  const out: TouchedFile[] = [];
  for (const [path, kind] of firstKind) {
    out.push({ path: shortenPath(path, root), kind });
  }
  return out;
}

// Last assistant text in the stream, used as the trace's natural wrap-up.
function lastAssistantText(stream: StreamEvent[]): string | null {
  for (let i = stream.length - 1; i >= 0; i--) {
    const e = stream[i];
    if (e.kind === "assistant_text" && e.text.trim()) return e.text.trim();
  }
  return null;
}

function bashFailures(stream: StreamEvent[]): number {
  let n = 0;
  for (const e of stream) {
    if (e.kind === "tool_use" && e.name === "Bash" && e.result?.isError) n++;
  }
  return n;
}

function askCount(stream: StreamEvent[]): number {
  let n = 0;
  for (const e of stream) {
    if (e.kind === "tool_use" && e.name === "AskUserQuestion") n++;
  }
  return n;
}

// Per-million-token USD rates for the model families the viewer knows about.
// Token rates are volatile; rounded to current public list prices and used
// only to render an "est." cost — falls back to "—" for unknown models.
const MODEL_PRICES: Record<
  string,
  { input: number; cacheCreate: number; cacheRead: number; output: number }
> = {
  opus: { input: 15, cacheCreate: 18.75, cacheRead: 1.5, output: 75 },
  sonnet: { input: 3, cacheCreate: 3.75, cacheRead: 0.3, output: 15 },
  haiku: { input: 0.8, cacheCreate: 1.0, cacheRead: 0.08, output: 4 },
};

function modelFamily(model: string | null): keyof typeof MODEL_PRICES | null {
  if (!model) return null;
  const m = model.toLowerCase();
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  return null;
}

function estCost(
  tokens: { input: number; cacheCreate: number; cacheRead: number; output: number },
  model: string | null,
): string | null {
  const fam = modelFamily(model);
  if (!fam) return null;
  const p = MODEL_PRICES[fam];
  const usd =
    (tokens.input * p.input +
      tokens.cacheCreate * p.cacheCreate +
      tokens.cacheRead * p.cacheRead +
      tokens.output * p.output) /
    1_000_000;
  if (usd < 0.01) return `<$0.01`;
  if (usd < 10) return `$${usd.toFixed(2)}`;
  if (usd < 1000) return `$${usd.toFixed(1)}`;
  return `$${Math.round(usd)}`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

export function Outcome({ session, trace }: Props) {
  const { meta, stream } = session;
  const files = deriveFiles(stream, meta.cwd);
  const summary = lastAssistantText(stream);
  const fails = bashFailures(stream);
  const asks = askCount(stream);
  const cost = estCost(meta.tokens, meta.model);
  const linkedPr = trace.pr_url && trace.pr_number != null;
  const visibleFiles = files.slice(0, 6);
  const extraFiles = Math.max(0, files.length - visibleFiles.length);

  return (
    <div className="outcome-grid">
      <section className="outcome-card">
        <h4>Result</h4>
        <span className={"outcome-status " + (linkedPr ? "ok" : "neutral")}>
          <span className="dot" />
          {linkedPr ? "Linked PR" : "Standalone session"}
        </span>
        {summary ? (
          <div className="outcome-summary">{truncate(summary, 260)}</div>
        ) : (
          <div className="outcome-summary outcome-summary--empty">
            No closing message in this trace.
          </div>
        )}
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
        <h4>Files touched · {files.length}</h4>
        {files.length === 0 ? (
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
              <li className="outcome-files-more">+ {extraFiles} more</li>
            )}
          </ul>
        )}
      </section>

      <section className="outcome-card">
        <h4>Asks &amp; cost</h4>
        <div className="outcome-stat">
          <div className="outcome-stat-value">{asks}</div>
          <div className="outcome-stat-label">user questions surfaced</div>
        </div>
        <div className="outcome-stat outcome-stat--bordered">
          <div className="outcome-stat-value">
            {cost ?? fmtTokens(meta.tokens.output)}
          </div>
          <div className="outcome-stat-label">
            {cost ? "est. token cost" : "output tokens"}
          </div>
        </div>
        {fails > 0 && (
          <div className="outcome-fails">
            <span className="dot" />
            {fails} bash failure{fails === 1 ? "" : "s"}
          </div>
        )}
      </section>
    </div>
  );
}
