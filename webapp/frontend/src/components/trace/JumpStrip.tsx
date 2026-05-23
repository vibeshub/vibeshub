import { useEffect, useMemo, useRef, useState } from "react";
import type { Session, UserPromptEvent } from "./types";

interface Props {
  session: Session;
}

function previewText(e: UserPromptEvent): string {
  if (e.command) {
    return e.command.args
      ? `${e.command.name} ${e.command.args}`
      : e.command.name;
  }
  return e.text;
}

export function JumpStrip({ session }: Props) {
  const prompts = useMemo(() => {
    const out: UserPromptEvent[] = [];
    for (const e of session.stream) {
      if (e.kind === "user_prompt" && e.uuid) out.push(e);
    }
    return out;
  }, [session.stream]);

  const [currentUuid, setCurrentUuid] = useState<string | null>(
    prompts[0]?.uuid ?? null,
  );
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Track which prompt is currently in view by remembering each observed
  // prompt's screen position; the topmost visible one wins.
  useEffect(() => {
    if (prompts.length === 0 || typeof window === "undefined") return;
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
    for (const p of prompts) {
      const el = document.querySelector(`[data-uuid="${p.uuid}"]`);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [prompts]);

  // Auto-scroll the current chip into view inside the horizontal strip.
  useEffect(() => {
    if (!currentUuid) return;
    const root = scrollerRef.current;
    if (!root) return;
    const chip = root.querySelector(
      `[data-prompt-uuid="${currentUuid}"]`,
    ) as HTMLElement | null;
    if (!chip) return;
    const left = chip.offsetLeft;
    const right = left + chip.offsetWidth;
    let target: number | null = null;
    if (left < root.scrollLeft + 24) {
      target = Math.max(0, left - 24);
    } else if (right > root.scrollLeft + root.clientWidth - 24) {
      target = right - root.clientWidth + 24;
    }
    if (target === null) return;
    // jsdom doesn't implement Element.scrollTo; fall back to plain assignment.
    if (typeof root.scrollTo === "function") {
      root.scrollTo({ left: target, behavior: "smooth" });
    } else {
      root.scrollLeft = target;
    }
  }, [currentUuid]);

  if (prompts.length < 2) return null;

  function jumpTo(uuid: string) {
    const el = document.querySelector(`[data-uuid="${uuid}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <nav className="jumpstrip" aria-label="Prompt navigation">
      <div className="jumpstrip-inner">
        <span className="jumpstrip-label">prompts</span>
        <div className="jumpstrip-scroll" ref={scrollerRef}>
          {prompts.map((p, i) => {
            const cur = p.uuid === currentUuid;
            return (
              <button
                key={p.uuid}
                type="button"
                data-prompt-uuid={p.uuid}
                className={"jumpchip" + (cur ? " cur" : "")}
                onClick={() => jumpTo(p.uuid)}
                title={previewText(p)}
                aria-current={cur ? "true" : undefined}
              >
                <span className="n">{i + 1}</span>
                <span className="pv">{previewText(p)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
