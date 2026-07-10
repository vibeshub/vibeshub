import { Link } from "react-router-dom";
import type { Session } from "./types";
import type { TraceSummary } from "../../types";
import { fmtDuration, fmtTokens } from "./format";
import { Timeline } from "./Timeline";
import { Outcome } from "./Outcome";
import { HeroTitle, titleSource } from "./HeroTitle";
import { DigestPanel } from "./DigestPanel";
import type { SubagentEntry } from "./changes";

interface Props {
  session: Session;
  trace: TraceSummary;
  rawHref: string;
  subagents: SubagentEntry[];
  subagentsLoading: boolean;
  canEdit?: boolean;
  onTraceUpdated?: (trace: TraceSummary) => void;
  onOpenFile?: (path: string) => void;
}

function HeroEyebrow({
  session,
  trace,
  rawHref,
}: Pick<Props, "session" | "trace" | "rawHref">) {
  const meta = session.meta;
  const id = meta.sessionId ? meta.sessionId.slice(0, 8) : "";
  const date = meta.startedAt
    ? new Date(meta.startedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";
  const repoParts = trace.repo_full_name?.split("/") ?? [];

  return (
    <div className="hero-eyebrow">
      <span className="dot" />
      {repoParts.length === 2 && (
        <>
          <Link
            to={`/${repoParts[0]}/${repoParts[1]}`}
            className="hero-eyebrow-repo"
          >
            {trace.repo_full_name}
          </Link>
          <span>·</span>
        </>
      )}
      <span>{trace.platform === "codex" ? "Codex CLI" : trace.platform === "cursor" ? "Cursor" : trace.platform}</span>
      <span>·</span>
      <span>{id ? `SESSION · ${id}` : "SESSION"}</span>
      {date && (
        <>
          <span>·</span>
          <span>{date.toUpperCase()}</span>
        </>
      )}
      <span className="hero-eyebrow-spacer" />
      <span className="hero-eyebrow-actions">
        {trace.pr_url && (
          <a href={trace.pr_url} target="_blank" rel="noreferrer">
            View on GitHub ↗
          </a>
        )}
        <a href={rawHref}>Raw JSONL</a>
      </span>
    </div>
  );
}

function HeroBadges({ session, trace }: Pick<Props, "session" | "trace">) {
  const meta = session.meta;
  const sizeKb = Math.max(1, Math.round(trace.byte_size / 1024));
  const sizeLabel =
    sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;
  const uploadedAt = new Date(trace.created_at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const hasPr = trace.pr_url && trace.pr_number != null;
  const start = meta.startedAt ? Date.parse(meta.startedAt) : 0;
  const end = meta.endedAt ? Date.parse(meta.endedAt) : 0;
  const wall = start && end ? Math.max(0, end - start) : 0;
  return (
    <div className="hero-badges">
      {hasPr && (
        <a
          href={trace.pr_url!}
          target="_blank"
          rel="noreferrer"
          className="hero-pr"
        >
          <span className="hero-pr-num">#{trace.pr_number}</span>
          {trace.pr_title && (
            <span className="hero-pr-title">{trace.pr_title}</span>
          )}
        </a>
      )}
      <span className="hero-tag">
        {meta.userPromptCount} {meta.userPromptCount === 1 ? "prompt" : "prompts"}
      </span>
      {meta.assistantTextCount > 0 && (
        <span className="hero-tag">{meta.assistantTextCount} replies</span>
      )}
      <span className="hero-tag">{meta.toolCallCount} tool calls</span>
      {wall > 0 && <span className="hero-tag">{fmtDuration(wall)}</span>}
      <span className="hero-tag">{sizeLabel}</span>
      {trace.is_private && (
        <span className="hero-tag hero-tag--private">🔒 Private</span>
      )}
      <span className="hero-tag hero-tag--quiet">
        uploaded {uploadedAt} by{" "}
        <Link to={`/${trace.owner_login}`}>@{trace.owner_login}</Link>
      </span>
    </div>
  );
}

export function MetaLine({ session }: { session: Session }) {
  const meta = session.meta;
  const items: Array<{ k: string; v: string }> = [];
  // Terminal exports have no canonical model id, only the banner label; show
  // whichever we have.
  const modelVal = meta.model ?? meta.modelLabel;
  if (modelVal) items.push({ k: "model", v: modelVal });
  if (meta.gitBranch) items.push({ k: "branch", v: meta.gitBranch });
  if (meta.cwd) items.push({ k: "cwd", v: meta.cwd });
  if (meta.version) items.push({ k: "cli", v: meta.version });
  if (meta.permissionMode)
    items.push({ k: "permissions", v: meta.permissionMode });
  const t = meta.tokens;
  const tokensTotal = t.input + t.cacheCreate + t.output + t.cacheRead;
  if (tokensTotal > 0) {
    items.push({
      k: "tokens",
      v: `${fmtTokens(tokensTotal)} (${fmtTokens(t.output)} out · ${fmtTokens(t.cacheRead)} cache)`,
    });
  }
  const imported = meta.sourceFormat === "terminal";
  if (items.length === 0 && !imported) return null;
  return (
    <div className="meta-wrap">
      <div className="metaline">
        {imported && (
          <span
            className="metaline-item meta-import-chip"
            title="Reconstructed from a Claude Code text export. Token counts, timings, and thinking are not available."
          >
            Imported from text export
          </span>
        )}
        {items.map((it, i) => (
          <span className="metaline-item" key={i}>
            <span className="kv-key">{it.k}</span>
            <span className="kv-val">{it.v}</span>
            {i < items.length - 1 && (
              <span className="metaline-sep">·</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Hero({
  session,
  trace,
  rawHref,
  subagents,
  subagentsLoading,
  canEdit,
  onTraceUpdated,
  onOpenFile,
}: Props) {
  const meta = session.meta;
  // The ask quote repeats the opening prompt under the title; show it whenever
  // the title came from anywhere other than that prompt.
  const source = titleSource(trace, meta.aiTitle, meta.firstPrompt);
  const showAsk =
    !!meta.firstPrompt && source !== "prompt" && source !== "none";
  return (
    <section>
      <div className="hero">
        <HeroEyebrow session={session} trace={trace} rawHref={rawHref} />
        <HeroTitle
          trace={trace}
          aiTitle={meta.aiTitle}
          firstPrompt={meta.firstPrompt}
          canEdit={!!canEdit}
          onUpdated={onTraceUpdated ?? (() => {})}
        />
        {showAsk && (
          <div className="hero-ask">
            <span className="who">user</span>
            <span className="q">{meta.firstPrompt}</span>
          </div>
        )}
        <HeroBadges session={session} trace={trace} />
      </div>
      {trace.ai_digest && <DigestPanel digest={trace.ai_digest} />}
      <Outcome
        session={session}
        trace={trace}
        subagents={subagents}
        subagentsLoading={subagentsLoading}
        onOpenFile={onOpenFile}
      />
      <MetaLine session={session} />
      <Timeline session={session} />
    </section>
  );
}
