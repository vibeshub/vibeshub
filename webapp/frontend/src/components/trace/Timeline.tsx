import { useMemo, useRef, useState, type MouseEvent } from "react";
import type { Session } from "./types";
import { toolCat } from "./tools";

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

interface Mark {
  x: number;
  cat: string;
}
interface Prompt {
  x: number;
}

function fmtHm(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function Timeline({ session }: Props) {
  const { stream, meta } = session;
  const start = meta.startedAt ? Date.parse(meta.startedAt) : 0;
  const end = meta.endedAt ? Date.parse(meta.endedAt) : 0;
  const duration = Math.max(1, end - start);

  const { marks, prompts } = useMemo(() => {
    const m: Mark[] = [];
    const p: Prompt[] = [];
    for (const e of stream) {
      const ts = e.kind === "pr_link" ? e.ts : (e as { ts?: string }).ts;
      if (!ts) continue;
      const t = Date.parse(ts);
      if (!Number.isFinite(t)) continue;
      const x = (t - start) / duration;
      if (e.kind === "tool_use") m.push({ x, cat: toolCat(e.name) });
      else if (e.kind === "user_prompt") p.push({ x });
    }
    return { marks: m, prompts: p };
  }, [stream, start, duration]);

  const bins = useMemo(() => {
    const acc: Array<Record<string, number>> = Array.from({ length: NB }, () => ({}));
    for (const m of marks) {
      const i = Math.min(NB - 1, Math.max(0, Math.floor(m.x * NB)));
      acc[i][m.cat] = (acc[i][m.cat] ?? 0) + 1;
    }
    return acc;
  }, [marks]);

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
    setHover({ x: px, t: start + px * duration });
  }

  function onClick(e: MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const target = start + px * duration;
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

  return (
    <div className="timeline-wrap">
      <div className="timeline-card">
        <div className="timeline-head">
          <h3>Activity</h3>
          <span className="span">
            {startLabel} → {endLabel} · {marks.length} tool calls ·{" "}
            {prompts.length} prompts
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
          {prompts.map((p, i) => (
            <g key={i}>
              <line
                x1={p.x * NB}
                x2={p.x * NB}
                y1="0"
                y2="62"
                stroke="var(--text-strong)"
                strokeWidth="0.5"
                vectorEffect="non-scaling-stroke"
                opacity="0.55"
              />
              <circle
                cx={p.x * NB}
                cy="62"
                r="1.6"
                fill="var(--text-strong)"
              />
            </g>
          ))}
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
          <span>{hover ? fmtHm(hover.t) : "·"}</span>
          <span>{endLabel}</span>
        </div>
      </div>
    </div>
  );
}
