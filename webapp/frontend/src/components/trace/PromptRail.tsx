import { useEffect, useMemo, useRef, useState } from "react";
import type { Session, UserPromptEvent } from "./types";

interface Props {
  session: Session;
}

interface RailItem {
  uuid: string;
  preview: string;
  timeLabel: string;
  toolCount: number;
}

function previewText(e: UserPromptEvent): string {
  if (e.command) {
    return e.command.args
      ? `${e.command.name} ${e.command.args}`
      : e.command.name;
  }
  return e.text;
}

function fmtHm(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function PromptRail({ session }: Props) {
  const items = useMemo<RailItem[]>(() => {
    const out: RailItem[] = [];
    let currentIdx = -1;
    for (const e of session.stream) {
      if (e.kind === "user_prompt" && e.uuid) {
        const ts = e.ts ? Date.parse(e.ts) : NaN;
        out.push({
          uuid: e.uuid,
          preview: previewText(e),
          timeLabel: Number.isFinite(ts) ? fmtHm(ts) : "",
          toolCount: 0,
        });
        currentIdx = out.length - 1;
      } else if (e.kind === "tool_use" && currentIdx >= 0) {
        out[currentIdx].toolCount += 1;
      }
    }
    return out;
  }, [session.stream]);

  const [currentUuid, setCurrentUuid] = useState<string | null>(
    items[0]?.uuid ?? null,
  );
  const scrollerRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (items.length === 0 || typeof window === "undefined") return;
    if (typeof IntersectionObserver === "undefined") return;
    const positions = new Map<string, number>();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const uuid = (entry.target as HTMLElement).dataset.uuid;
          if (!uuid) continue;
          if (entry.isIntersecting) {
            positions.set(uuid, entry.boundingClientRect.top);
          } else {
            positions.delete(uuid);
          }
        }
        let best: { uuid: string; top: number } | null = null;
        for (const [uuid, top] of positions) {
          if (best === null || top < best.top) best = { uuid, top };
        }
        if (best) setCurrentUuid(best.uuid);
      },
      { rootMargin: "-140px 0px -55% 0px", threshold: 0 },
    );
    for (const it of items) {
      const el = document.querySelector(`[data-uuid="${it.uuid}"]`);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [items]);

  // Keep the active rail row visible without yanking the page; only scroll the
  // rail's own scroll container, not the document.
  useEffect(() => {
    if (!currentUuid) return;
    const root = scrollerRef.current;
    if (!root) return;
    const row = root.querySelector(
      `[data-prompt-uuid="${currentUuid}"]`,
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
    if (typeof root.scrollTo === "function") {
      root.scrollTo({ top: target, behavior: "smooth" });
    } else {
      root.scrollTop = target;
    }
  }, [currentUuid]);

  if (items.length === 0) return null;

  function jumpTo(uuid: string) {
    const el = document.querySelector(`[data-uuid="${uuid}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <aside className="promptrail" aria-label="Prompt navigation">
      <div className="promptrail-head">
        <span className="promptrail-count">{items.length}</span>
        <span className="promptrail-label">prompts</span>
      </div>
      <ol className="promptrail-list" ref={scrollerRef}>
        {items.map((it, i) => {
          const cur = it.uuid === currentUuid;
          return (
            <li key={it.uuid}>
              <button
                type="button"
                data-prompt-uuid={it.uuid}
                className={"promptrail-item" + (cur ? " cur" : "")}
                onClick={() => jumpTo(it.uuid)}
                aria-current={cur ? "true" : undefined}
              >
                <span className="promptrail-n">{i + 1}</span>
                <span className="promptrail-body">
                  <span className="promptrail-preview">{it.preview}</span>
                  <span className="promptrail-meta">
                    {it.timeLabel && <span>{it.timeLabel}</span>}
                    {it.timeLabel && it.toolCount > 0 && (
                      <span className="promptrail-sep">·</span>
                    )}
                    {it.toolCount > 0 && (
                      <span>
                        {it.toolCount} tool{it.toolCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
