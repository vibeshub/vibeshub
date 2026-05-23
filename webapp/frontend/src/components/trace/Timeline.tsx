import { useMemo, useRef, useState, type MouseEvent } from "react";
import type { Session } from "./types";
import { toolCat } from "./tools";
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
}

function fmtHm(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
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

export function Timeline({ session }: Props) {
  const { stream, meta } = session;
  const start = meta.startedAt ? Date.parse(meta.startedAt) : 0;
  const end = meta.endedAt ? Date.parse(meta.endedAt) : 0;

  const { marks, prompts } = useMemo(() => {
    const m: Mark[] = [];
    const p: number[] = [];
    for (const e of stream) {
      const ts = e.kind === "pr_link" ? e.ts : (e as { ts?: string }).ts;
      if (!ts) continue;
      const t = Date.parse(ts);
      if (!Number.isFinite(t)) continue;
      if (e.kind === "tool_use") m.push({ t, cat: toolCat(e.name) });
      else if (e.kind === "user_prompt") p.push(t);
    }
    return { marks: m, prompts: p };
  }, [stream]);

  const axis = useMemo(
    () => detectGap(marks.map((m) => m.t), start, end),
    [marks, start, end],
  );

  const bins = useMemo(() => {
    const acc: Array<Record<string, number>> = Array.from({ length: NB }, () => ({}));
    for (const m of marks) {
      const x = remap(m.t, axis, start, end);
      const i = Math.min(NB - 1, Math.max(0, Math.floor(x * NB)));
      acc[i][m.cat] = (acc[i][m.cat] ?? 0) + 1;
    }
    return acc;
  }, [marks, axis, start, end]);

  const maxBin = Math.max(
    1,
    ...bins.map((b) => Object.values(b).reduce((a, c) => a + c, 0)),
  );

  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);

  const startLabel = start ? fmtHm(start) : "";
  const endLabel = end ? fmtHm(end) : "";

  function onMouseMove(e: MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    setHover({ x: px, t: unmap(px, axis, start, end) });
  }

  function onClick(e: MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const target = unmap(px, axis, start, end);
    let best: { uuid: string; dist: number } | null = null;
    for (const ev of stream) {
      if (
        ev.kind !== "tool_use" &&
        ev.kind !== "user_prompt" &&
        ev.kind !== "assistant_text"
      ) {
        continue;
      }
      if (!ev.ts || !ev.uuid) continue;
      const d = Math.abs(Date.parse(ev.ts) - target);
      if (best === null || d < best.dist) {
        best = { uuid: ev.uuid, dist: d };
      }
    }
    if (best) {
      const el = document.querySelector(`[data-uuid="${best.uuid}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  const breakX = axis ? (PRE_FRAC + GAP_FRAC / 2) * NB : 0;
  const breakHalfW = axis ? (GAP_FRAC / 2) * NB : 0;

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
        <svg
          ref={svgRef}
          className="timeline-svg"
          viewBox={`0 0 ${NB} 70`}
          preserveAspectRatio="none"
          onMouseMove={onMouseMove}
          onMouseLeave={() => setHover(null)}
          onClick={onClick}
        >
          <rect x="0" y="0" width={NB} height="70" fill="transparent" />
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
            const total = Object.values(b).reduce((a, c) => a + c, 0);
            if (total === 0) return null;
            const fullH = (total / maxBin) * 48;
            let y = 56 - fullH;
            const rects = [];
            for (const cat of STACK_ORDER) {
              const n = b[cat] ?? 0;
              if (!n) continue;
              const h = (n / total) * fullH;
              rects.push(
                <rect
                  key={cat}
                  x={i + 0.15}
                  y={y}
                  width={0.7}
                  height={h}
                  fill={`var(--tool-${cat})`}
                />,
              );
              y += h;
            }
            return <g key={i}>{rects}</g>;
          })}
          {prompts.map((t, i) => {
            const x = remap(t, axis, start, end) * NB;
            return (
              <g key={i}>
                <line
                  x1={x}
                  x2={x}
                  y1="0"
                  y2="62"
                  stroke="var(--text-strong)"
                  strokeWidth="0.5"
                  vectorEffect="non-scaling-stroke"
                  opacity="0.55"
                />
                <circle
                  cx={x}
                  cy="62"
                  r="1.6"
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
              x1={hover.x * NB}
              x2={hover.x * NB}
              y1="0"
              y2="62"
              stroke="var(--accent)"
              strokeWidth="0.7"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        <div className="timeline-ticks">
          <span>{startLabel}</span>
          {axis ? (
            <>
              <span>{fmtHm(axis.gapStart)} ↓</span>
              <span>↑ {fmtHm(axis.gapEnd)}</span>
            </>
          ) : (
            <span>{hover ? fmtHm(hover.t) : "·"}</span>
          )}
          <span>{endLabel}</span>
        </div>
      </div>
    </div>
  );
}
