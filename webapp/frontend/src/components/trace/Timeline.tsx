import { useMemo, useRef, useState, type MouseEvent } from "react";
import type { Session } from "./types";
import { formatBreakdown, toolCat } from "./tools";
import { fmtDuration } from "./format";

interface Props {
  session: Session;
}

const NB = 140;
const STACK_ORDER = [
  "read",
  "bash",
  "write",
  "task",
  "agent",
  "skill",
  "ask",
  "other",
] as const;

const CAT_LABEL: Record<string, string> = {
  read: "Read",
  write: "Write",
  bash: "Bash",
  agent: "Subagent",
  skill: "Skill",
  task: "Task",
  ask: "Ask",
  other: "Other",
};

// Prompt markers win over bin hover within this many bin widths so the thin
// vertical line stays grabbable next to a dense bar.
const PROMPT_HOVER_BINS = 1.5;

// Broken-axis layout: pre-gap takes the first PRE_FRAC of width, the gap
// marker takes GAP_FRAC, post-gap takes the rest. Tuned to keep clusters
// breathable while making the elision obvious.
const PRE_FRAC = 0.46;
const GAP_FRAC = 0.08;
const POST_FRAC = 1 - PRE_FRAC - GAP_FRAC;

// A gap is worth compressing when it's both a meaningful share of the
// session AND a wall-clock interval the eye will notice as a hole.
const GAP_DURATION_RATIO = 0.2;
const GAP_MIN_MS = 10 * 60 * 1000;

interface BrokenAxis {
  gapMs: number;
  gapStart: number;
  gapEnd: number;
  sessionStart: number;
  sessionEnd: number;
}

interface Mark {
  t: number;
  cat: string;
  name: string;
}

interface PromptMark {
  t: number;
  text: string;
  uuid: string;
}

interface Bin {
  total: number;
  catCounts: Record<string, number>;
  toolNames: string[];
  promptIdxs: number[];
}

type Hover =
  | { kind: "bin"; binIdx: number; t: number; cx: number }
  | { kind: "prompt"; promptIdx: number; t: number; cx: number }
  | null;

function fmtHm(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtHms(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// Find the largest gap between consecutive event timestamps; return it only
// if it qualifies as worth compressing.
function detectGap(
  times: number[],
  sessionStart: number,
  sessionEnd: number,
): BrokenAxis | null {
  if (times.length < 2) return null;
  const sorted = [...times].sort((a, b) => a - b);
  let max = 0;
  let start = 0;
  let end = 0;
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i] - sorted[i - 1];
    if (g > max) {
      max = g;
      start = sorted[i - 1];
      end = sorted[i];
    }
  }
  const duration = Math.max(1, sessionEnd - sessionStart);
  if (max < GAP_MIN_MS || max / duration < GAP_DURATION_RATIO) return null;
  return { gapMs: max, gapStart: start, gapEnd: end, sessionStart, sessionEnd };
}

// Map a timestamp to its [0,1] x-coordinate on the compressed axis. Without
// an axis, this collapses to linear scaling.
function remap(ms: number, axis: BrokenAxis | null, sessionStart: number, sessionEnd: number): number {
  const duration = Math.max(1, sessionEnd - sessionStart);
  if (!axis) return (ms - sessionStart) / duration;
  if (ms <= axis.gapStart) {
    const span = Math.max(1, axis.gapStart - axis.sessionStart);
    return ((ms - axis.sessionStart) / span) * PRE_FRAC;
  }
  if (ms >= axis.gapEnd) {
    const span = Math.max(1, axis.sessionEnd - axis.gapEnd);
    return PRE_FRAC + GAP_FRAC + ((ms - axis.gapEnd) / span) * POST_FRAC;
  }
  return PRE_FRAC + GAP_FRAC / 2;
}

// Inverse of remap, used to translate a hovered x-pixel back to a real time.
function unmap(x: number, axis: BrokenAxis | null, sessionStart: number, sessionEnd: number): number {
  const duration = Math.max(1, sessionEnd - sessionStart);
  if (!axis) return sessionStart + x * duration;
  if (x <= PRE_FRAC) {
    return axis.sessionStart + (x / PRE_FRAC) * (axis.gapStart - axis.sessionStart);
  }
  if (x >= PRE_FRAC + GAP_FRAC) {
    return axis.gapEnd + ((x - PRE_FRAC - GAP_FRAC) / POST_FRAC) * (axis.sessionEnd - axis.gapEnd);
  }
  // Inside the elided gap — fall back to the midpoint so the readout doesn't
  // pretend to be precise.
  return axis.gapStart + axis.gapMs / 2;
}

// A three-minute session plots as two slivers and dead air; only sessions
// long enough to have shape earn the chart's vertical space.
const TIMELINE_MIN_MS = 10 * 60 * 1000;

export function Timeline({ session }: Props) {
  const { meta } = session;
  const start = meta.startedAt ? Date.parse(meta.startedAt) : 0;
  const end = meta.endedAt ? Date.parse(meta.endedAt) : 0;
  if (!start || !end || end - start < TIMELINE_MIN_MS) return null;
  return <TimelineChart session={session} />;
}

function TimelineChart({ session }: Props) {
  const { stream, meta } = session;
  const start = meta.startedAt ? Date.parse(meta.startedAt) : 0;
  const end = meta.endedAt ? Date.parse(meta.endedAt) : 0;

  const { marks, prompts } = useMemo(() => {
    const m: Mark[] = [];
    const p: PromptMark[] = [];
    for (const e of stream) {
      const ts = e.kind === "pr_link" ? e.ts : (e as { ts?: string }).ts;
      if (!ts) continue;
      const t = Date.parse(ts);
      if (!Number.isFinite(t)) continue;
      if (e.kind === "tool_use") m.push({ t, cat: toolCat(e.name), name: e.name });
      else if (e.kind === "user_prompt") p.push({ t, text: e.text ?? "", uuid: e.uuid });
    }
    return { marks: m, prompts: p };
  }, [stream]);

  const axis = useMemo(
    () => detectGap(marks.map((m) => m.t), start, end),
    [marks, start, end],
  );

  const bins = useMemo<Bin[]>(() => {
    const acc: Bin[] = Array.from({ length: NB }, () => ({
      total: 0,
      catCounts: {},
      toolNames: [],
      promptIdxs: [],
    }));
    for (const m of marks) {
      const x = remap(m.t, axis, start, end);
      const i = Math.min(NB - 1, Math.max(0, Math.floor(x * NB)));
      acc[i].catCounts[m.cat] = (acc[i].catCounts[m.cat] ?? 0) + 1;
      acc[i].toolNames.push(m.name);
      acc[i].total += 1;
    }
    prompts.forEach((p, idx) => {
      const x = remap(p.t, axis, start, end);
      const i = Math.min(NB - 1, Math.max(0, Math.floor(x * NB)));
      acc[i].promptIdxs.push(idx);
    });
    return acc;
  }, [marks, prompts, axis, start, end]);

  const maxBin = Math.max(1, ...bins.map((b) => b.total));

  const presentCats = useMemo(() => {
    const s = new Set<string>();
    for (const m of marks) s.add(m.cat);
    return STACK_ORDER.filter((c) => s.has(c));
  }, [marks]);

  const promptXs = useMemo(
    () => prompts.map((p) => remap(p.t, axis, start, end) * NB),
    [prompts, axis, start, end],
  );

  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Hover>(null);

  const startLabel = start ? fmtHm(start) : "";
  const endLabel = end ? fmtHm(end) : "";

  const breakX = axis ? (PRE_FRAC + GAP_FRAC / 2) * NB : 0;
  const breakHalfW = axis ? (GAP_FRAC / 2) * NB : 0;
  // Bins falling inside the elided gap have nothing to describe.
  const inBreak = (i: number) =>
    axis !== null && Math.abs(i + 0.5 - breakX) <= breakHalfW;

  function onMouseMove(e: MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const x = ratio * NB;

    // Prompt markers win when the cursor is within PROMPT_HOVER_BINS, so the
    // hairline prompt indicator is reachable next to a tall bar.
    let nearestP = -1;
    let nearestDist = Infinity;
    for (let i = 0; i < promptXs.length; i++) {
      const d = Math.abs(promptXs[i] - x);
      if (d < nearestDist) {
        nearestDist = d;
        nearestP = i;
      }
    }
    if (nearestP !== -1 && nearestDist <= PROMPT_HOVER_BINS) {
      setHover({
        kind: "prompt",
        promptIdx: nearestP,
        t: prompts[nearestP].t,
        cx: promptXs[nearestP],
      });
      return;
    }

    const binIdx = Math.min(NB - 1, Math.max(0, Math.floor(x)));
    if (inBreak(binIdx)) {
      setHover(null);
      return;
    }
    const bin = bins[binIdx];
    if (!bin || (bin.total === 0 && bin.promptIdxs.length === 0)) {
      setHover(null);
      return;
    }
    setHover({
      kind: "bin",
      binIdx,
      t: unmap((binIdx + 0.5) / NB, axis, start, end),
      cx: binIdx + 0.5,
    });
  }

  function onClick() {
    if (!hover) return;
    if (hover.kind === "prompt") {
      const el = document.querySelector(
        `[data-uuid="${prompts[hover.promptIdx].uuid}"]`,
      );
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // Bin clicks resolve to the nearest event in time — but tools inside
    // collapsed tool-groups don't render a [data-uuid], so we'd silently
    // no-op. Filter to events that actually have a mounted target.
    const target = hover.t;
    let best: { el: Element; dist: number } | null = null;
    for (const ev of stream) {
      if (
        ev.kind !== "tool_use" &&
        ev.kind !== "user_prompt" &&
        ev.kind !== "assistant_text"
      ) {
        continue;
      }
      if (!ev.ts || !ev.uuid) continue;
      const el = document.querySelector(`[data-uuid="${ev.uuid}"]`);
      if (!el) continue;
      const d = Math.abs(Date.parse(ev.ts) - target);
      if (best === null || d < best.dist) {
        best = { el, dist: d };
      }
    }
    if (best) {
      best.el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  const tooltip = useMemo(() => {
    if (!hover) return null;
    const ratio = hover.cx / NB;
    const anchor: "start" | "end" | "center" =
      ratio < 0.12 ? "start" : ratio > 0.88 ? "end" : "center";
    if (hover.kind === "prompt") {
      const p = prompts[hover.promptIdx];
      const preview =
        (p.text || "").trim().split("\n")[0].slice(0, 80) || "(empty prompt)";
      return {
        anchor,
        title: `Prompt ${hover.promptIdx + 1} of ${prompts.length} · ${fmtHms(hover.t)}`,
        preview,
        breakdown: null as string | null,
        meta: null as string | null,
      };
    }
    const bin = bins[hover.binIdx];
    const meta =
      bin.promptIdxs.length > 0
        ? `${bin.promptIdxs.length} prompt${bin.promptIdxs.length === 1 ? "" : "s"} here`
        : null;
    return {
      anchor,
      title: `${fmtHm(hover.t)} · ${bin.total} tool call${bin.total === 1 ? "" : "s"}`,
      preview: null as string | null,
      breakdown: bin.total > 0 ? formatBreakdown(bin.toolNames) : null,
      meta,
    };
  }, [hover, bins, prompts]);

  return (
    <div className="timeline-wrap">
      <div className="timeline-card">
        <div className="timeline-head">
          <h3>Activity</h3>
          <span className="span">
            {startLabel} → {endLabel} · {marks.length} tool calls ·{" "}
            {prompts.length} prompts
            {axis && (
              <span className="timeline-gap-label">
                {fmtDuration(axis.gapMs)} idle
              </span>
            )}
          </span>
        </div>
        <div className="timeline-chart">
          {tooltip && (
            <div
              className="timeline-tooltip"
              data-anchor={tooltip.anchor}
              style={{ left: `${(hover!.cx / NB) * 100}%` }}
              role="tooltip"
            >
              <div className="timeline-tooltip-title">{tooltip.title}</div>
              {tooltip.breakdown && (
                <div className="timeline-tooltip-breakdown">
                  {tooltip.breakdown}
                </div>
              )}
              {tooltip.preview && (
                <div className="timeline-tooltip-preview">
                  {tooltip.preview}
                </div>
              )}
              {tooltip.meta && (
                <div className="timeline-tooltip-meta">{tooltip.meta}</div>
              )}
            </div>
          )}
          <svg
            ref={svgRef}
            className={`timeline-svg${hover ? " is-hovering" : ""}`}
            viewBox={`0 0 ${NB} 70`}
            preserveAspectRatio="none"
            onMouseMove={onMouseMove}
            onMouseLeave={() => setHover(null)}
            onClick={onClick}
          >
            <rect x="0" y="0" width={NB} height="70" fill="transparent" />
            {hover?.kind === "bin" && (
              <rect
                x={hover.binIdx}
                y={0}
                width={1}
                height={56}
                fill="var(--accent)"
                opacity="0.10"
                pointerEvents="none"
              />
            )}
            <line
              x1="0"
              x2={NB}
              y1="56"
              y2="56"
              stroke="var(--border)"
              strokeWidth="0.5"
              vectorEffect="non-scaling-stroke"
            />
            {bins.map((b, i) => {
              if (b.total === 0) return null;
              const fullH = (b.total / maxBin) * 48;
              let y = 56 - fullH;
              const isHovered = hover?.kind === "bin" && hover.binIdx === i;
              const dimmed = hover?.kind === "bin" && !isHovered;
              const rects = [];
              for (const cat of STACK_ORDER) {
                const n = b.catCounts[cat] ?? 0;
                if (!n) continue;
                const h = (n / b.total) * fullH;
                rects.push(
                  <rect
                    key={cat}
                    x={i + 0.15}
                    y={y}
                    width={0.7}
                    height={h}
                    fill={`var(--tool-${cat})`}
                    opacity={dimmed ? 0.55 : 1}
                  />,
                );
                y += h;
              }
              return <g key={i}>{rects}</g>;
            })}
            {prompts.map((_p, i) => {
              const x = promptXs[i];
              const isHovered =
                hover?.kind === "prompt" && hover.promptIdx === i;
              return (
                <g key={i}>
                  <line
                    x1={x}
                    x2={x}
                    y1="0"
                    y2="62"
                    stroke="var(--text-strong)"
                    strokeWidth={isHovered ? 1.1 : 0.5}
                    vectorEffect="non-scaling-stroke"
                    opacity={isHovered ? 0.95 : 0.55}
                  />
                  <circle
                    cx={x}
                    cy="62"
                    r={isHovered ? 2.3 : 1.6}
                    fill="var(--text-strong)"
                  />
                </g>
              );
            })}
            {axis && (
              <g
                transform={`translate(${breakX}, 0)`}
                pointerEvents="none"
              >
                <rect
                  x={-breakHalfW}
                  y={0}
                  width={breakHalfW * 2}
                  height={70}
                  fill="var(--bg-subtle)"
                  opacity="0.85"
                />
                <path
                  d={`M ${-breakHalfW * 0.6} 6 L ${breakHalfW * 0.2} 22 L ${-breakHalfW * 0.6} 38 L ${breakHalfW * 0.2} 54`}
                  stroke="var(--border-strong)"
                  fill="none"
                  strokeWidth="0.6"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={`M ${-breakHalfW * 0.2} 6 L ${breakHalfW * 0.6} 22 L ${-breakHalfW * 0.2} 38 L ${breakHalfW * 0.6} 54`}
                  stroke="var(--border-strong)"
                  fill="none"
                  strokeWidth="0.6"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )}
            {hover && (
              <line
                x1={hover.cx}
                x2={hover.cx}
                y1="0"
                y2="62"
                stroke="var(--accent)"
                strokeWidth="0.7"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
          </svg>
        </div>
        <div className="timeline-ticks">
          <span>{startLabel}</span>
          {axis ? (
            <>
              <span>{fmtHm(axis.gapStart)} ↓</span>
              <span>↑ {fmtHm(axis.gapEnd)}</span>
            </>
          ) : (
            <span>·</span>
          )}
          <span>{endLabel}</span>
        </div>
        {presentCats.length > 0 && (
          <div className="timeline-legend">
            {presentCats.map((c) => (
              <span key={c} className="timeline-legend-chip">
                <span
                  className="timeline-legend-swatch"
                  style={{ background: `var(--tool-${c})` }}
                />
                {CAT_LABEL[c]}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
