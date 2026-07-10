import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "./types";
import type { TraceDigest } from "../../types";
import { chapterMetrics } from "./chapterMetrics";
import type { ChapterFileStat } from "./chapterLink";

interface Props {
  session: Session;
  digest: TraceDigest;
  /** Files each chapter touched, keyed by anchor_uuid (from filesByChapter). */
  chapterFiles?: Map<string, ChapterFileStat[]>;
  /** Opens a file's diff in the Changes tab. */
  onOpenFile?: (path: string) => void;
}

function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m${String(rem).padStart(2, "0")}s` : `${m}m`;
}

export function ChapterRail({ session, digest, chapterFiles, onOpenFile }: Props) {
  const chapters = digest.chapters;
  const anchorId = (uuid: string) => `chapter-${uuid}`;

  const metrics = useMemo(
    () => chapterMetrics(session.stream, chapters),
    [session.stream, chapters],
  );

  const maxDur = useMemo(() => {
    let max = 0;
    for (const m of metrics.values()) if (m.durationMs) max = Math.max(max, m.durationMs);
    return max;
  }, [metrics]);

  const maxTools = useMemo(() => {
    let max = 0;
    for (const m of metrics.values()) max = Math.max(max, m.toolCount);
    return max;
  }, [metrics]);

  const [currentUuid, setCurrentUuid] = useState<string | null>(
    chapters[0]?.anchor_uuid ?? null,
  );
  const scrollerRef = useRef<HTMLOListElement>(null);

  // Track the current chapter by observing the anchor elements of whichever
  // column is showing; the topmost one in the active band wins. Mirrors
  // PromptRail.
  useEffect(() => {
    if (chapters.length === 0 || typeof window === "undefined") return;
    if (typeof IntersectionObserver === "undefined") return;
    const prefix = "chapter-";
    const positions = new Map<string, number>();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).id;
          if (!id.startsWith(prefix)) continue;
          const uuid = id.slice(prefix.length);
          if (entry.isIntersecting) positions.set(uuid, entry.boundingClientRect.top);
          else positions.delete(uuid);
        }
        let best: { uuid: string; top: number } | null = null;
        for (const [uuid, top] of positions) {
          if (best === null || top < best.top) best = { uuid, top };
        }
        if (best) setCurrentUuid(best.uuid);
      },
      // Keep this top offset in sync with ChapterDivider's scroll-margin-top:
      // both encode the sticky viewer-header height.
      { rootMargin: "-140px 0px -55% 0px", threshold: 0 },
    );
    for (const c of chapters) {
      const el = document.getElementById(`${prefix}${c.anchor_uuid}`);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [chapters]);

  // Keep the active row visible inside the rail's own scroller (never the doc).
  useEffect(() => {
    if (!currentUuid) return;
    const root = scrollerRef.current;
    if (!root) return;
    const row = root.querySelector(
      `[data-chapter-uuid="${currentUuid}"]`,
    ) as HTMLElement | null;
    if (!row) return;
    const top = row.offsetTop;
    const bot = top + row.offsetHeight;
    const viewTop = root.scrollTop;
    const viewBot = viewTop + root.clientHeight;
    let target: number | null = null;
    if (top < viewTop + 12) target = Math.max(0, top - 12);
    else if (bot > viewBot - 12) target = bot - root.clientHeight + 12;
    if (target === null) return;
    if (typeof root.scrollTo === "function") root.scrollTo({ top: target, behavior: "smooth" });
    else root.scrollTop = target;
  }, [currentUuid]);

  if (chapters.length === 0) return null;

  function jumpTo(uuid: string) {
    const el = document.getElementById(anchorId(uuid));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <aside className="chapterrail" aria-label="Chapter navigation">
      <div className="chapterrail-head">
        <span className="chapterrail-count">{chapters.length}</span>
        <span className="chapterrail-label">chapters</span>
      </div>
      <ol className="chapterrail-list" ref={scrollerRef}>
        {chapters.map((c, i) => {
          const cur = c.anchor_uuid === currentUuid;
          const m = metrics.get(c.anchor_uuid);
          let pct = 0;
          if (m) {
            if (maxDur > 0 && m.durationMs) pct = (m.durationMs / maxDur) * 100;
            else if (maxDur === 0 && maxTools > 0) pct = (m.toolCount / maxTools) * 100;
          }
          const tools = m
            ? `${m.toolCount} ${m.toolCount === 1 ? "tool" : "tools"}`
            : "";
          const meta = m
            ? m.durationMs != null && m.durationMs >= 1000
              ? `${tools} · ${fmtDur(m.durationMs)}`
              : tools
            : "";
          return (
            <li key={c.anchor_uuid}>
              <button
                type="button"
                data-chapter-uuid={c.anchor_uuid}
                className={"chapterrail-item" + (cur ? " cur" : "")}
                onClick={() => jumpTo(c.anchor_uuid)}
                aria-current={cur ? "true" : undefined}
              >
                <span className="chapterrail-n">{i + 1}</span>
                <span className="chapterrail-body">
                  <span className="chapterrail-title">{c.title}</span>
                  {m && (
                    <span className="chapterrail-arc">
                      <span className="chapterrail-bar">
                        <span className="chapterrail-fill" style={{ width: `${pct}%` }} />
                      </span>
                      {meta && <span className="chapterrail-meta">{meta}</span>}
                    </span>
                  )}
                </span>
              </button>
              {(() => {
                const files = chapterFiles?.get(c.anchor_uuid) ?? [];
                if (files.length === 0) return null;
                const shown = files.slice(0, 2);
                return (
                  <span className="chapterrail-files">
                    {shown.map((f) => (
                      <button
                        key={f.path}
                        type="button"
                        className="chapterrail-file"
                        title={`View diff: ${f.path}`}
                        onClick={() => onOpenFile?.(f.path)}
                      >
                        {f.path.split("/").pop()}
                      </button>
                    ))}
                    {files.length > shown.length && (
                      <span className="chapterrail-file-more">
                        +{files.length - shown.length}
                      </span>
                    )}
                  </span>
                );
              })()}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
