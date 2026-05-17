import type { CSSProperties } from "react";
import type { Session } from "./types";
import { fmtDuration, fmtDurationCompact, fmtTokens } from "./format";
import { toolCat, toolLabel } from "./tools";
import { Timeline } from "./Timeline";

interface Props {
  session: Session;
}

function HeroEyebrow({ session }: Props) {
  const meta = session.meta;
  const id = meta.sessionId ? meta.sessionId.slice(0, 8) : "";
  const date = meta.startedAt
    ? new Date(meta.startedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";
  return (
    <div className="hero-eyebrow">
      <span className="dot" />
      <span>SESSION · {id}</span>
      {date && (
        <>
          <span>·</span>
          <span>{date}</span>
        </>
      )}
    </div>
  );
}

function MetaStrip({ session }: Props) {
  const meta = session.meta;
  const start = meta.startedAt ? Date.parse(meta.startedAt) : 0;
  const end = meta.endedAt ? Date.parse(meta.endedAt) : 0;
  const wall = Math.max(0, end - start);
  const tokensTotal =
    meta.tokens.input + meta.tokens.cacheCreate + meta.tokens.output;
  return (
    <div className="meta-wrap">
      <div className="meta-strip">
        <div className="meta-cell">
          <div className="meta-label">Duration</div>
          <div className="meta-value">
            {fmtDurationCompact(meta.assistantThinkMs)}
          </div>
          <div className="meta-sub">wall: {fmtDuration(wall)}</div>
        </div>
        <div className="meta-cell">
          <div className="meta-label">Turns</div>
          <div className="meta-value">{meta.userPromptCount}</div>
          <div className="meta-sub">{meta.assistantTextCount} replies</div>
        </div>
        <div className="meta-cell">
          <div className="meta-label">Tool calls</div>
          <div className="meta-value">{meta.toolCallCount}</div>
          <div className="meta-sub">
            {Object.keys(meta.toolCounts).length} distinct tools
          </div>
        </div>
        <div className="meta-cell">
          <div className="meta-label">Tokens</div>
          <div className="meta-value">
            {fmtTokens(tokensTotal + meta.tokens.cacheRead)}
          </div>
          <div className="meta-sub">
            {fmtTokens(meta.tokens.output)} out ·{" "}
            {fmtTokens(meta.tokens.cacheRead)} cache
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaLine({ session }: Props) {
  const meta = session.meta;
  const items: Array<{ k: string; v: string }> = [];
  if (meta.model) items.push({ k: "model", v: meta.model });
  if (meta.gitBranch) items.push({ k: "branch", v: meta.gitBranch });
  if (meta.cwd) items.push({ k: "cwd", v: meta.cwd });
  if (meta.version) items.push({ k: "cli", v: meta.version });
  if (meta.permissionMode)
    items.push({ k: "permissions", v: meta.permissionMode });
  if (items.length === 0) return null;
  return (
    <div className="meta-wrap">
      <div className="metaline">
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

function ToolsChips({ session }: Props) {
  const counts = session.meta.toolCounts;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return (
    <div className="tools-chips">
      <span className="tools-chips-label">tools</span>
      {entries.map(([name, n]) => {
        const cat = toolCat(name);
        const style = {
          ["--dot" as string]: `var(--tool-${cat})`,
        } as CSSProperties;
        return (
          <span className="tool-chip" key={name} style={style}>
            <span className="dot" />
            {toolLabel(name)}
            <span className="count">{n}</span>
          </span>
        );
      })}
    </div>
  );
}

export function Hero({ session }: Props) {
  const meta = session.meta;
  return (
    <section>
      <div className="hero">
        <HeroEyebrow session={session} />
        <h1 className="hero-title">{meta.aiTitle || "Untitled session"}</h1>
        {meta.firstPrompt && (
          <div className="hero-prompt">
            <span className="hero-prompt-tag">User</span>
            <div className="hero-prompt-body">{meta.firstPrompt}</div>
          </div>
        )}
      </div>
      <MetaStrip session={session} />
      <MetaLine session={session} />
      <ToolsChips session={session} />
      <Timeline session={session} />
    </section>
  );
}
