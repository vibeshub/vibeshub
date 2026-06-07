# Chapter Navigation Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make digest chapters the persistent left-rail navigation spine of the trace viewer (replacing the prompt rail when chapters exist), with a per-chapter duration bar and tool-count/duration meta so the rail doubles as a story arc.

**Architecture:** Frontend-only. A new `ChapterRail` component mirrors the existing `PromptRail` (sticky aside, `IntersectionObserver` current-tracking, click-to-jump). Per-chapter metrics are computed in the browser by a pure helper that walks the session stream between chapter anchors. `TraceViewer` picks `ChapterRail` when `ai_digest.chapters` exist, else `PromptRail`. Chapter dividers gain stable ids so the rail can target them, including the previously-missing case where an anchor is a `tool_use` inside a collapsed tool group. The now-duplicate "JUMP TO" chips are removed from `DigestPanel`.

**Tech Stack:** React + TypeScript, Vite, Vitest + Testing Library (jsdom), CSS in `styles/viewer.css` and CSS modules.

**Spec:** `docs/superpowers/specs/2026-06-07-chapter-navigation-rail-design.md`

**Working directory for all commands:** `webapp/frontend`

---

## File Structure

- Create: `src/components/trace/chapterMetrics.ts` — pure helper: per-chapter tool count + duration from the stream.
- Create: `src/components/trace/ChapterRail.tsx` — the sticky chapter rail (spine + arc).
- Create: `src/tests/trace/chapterMetrics.test.ts` — metric unit tests.
- Create: `src/tests/trace/ChapterRail.test.tsx` — rail render/click tests.
- Create: `src/tests/trace/Thread.test.tsx` — divider-for-collapsed-tool-anchor test.
- Modify: `src/components/trace/ChapterDivider.tsx` (+ `.module.css`) — stable `id` + scroll offset.
- Modify: `src/components/trace/Thread.tsx` — pass `anchorUuid`; emit divider for collapsed tool anchors.
- Modify: `src/components/trace/TraceViewer.tsx` — choose ChapterRail vs PromptRail.
- Modify: `src/styles/viewer.css` — `.chapterrail*` rules.
- Modify: `src/components/trace/DigestPanel.tsx` (+ `.module.css`) — remove the chapter chip rail.
- Modify: `src/tests/trace/DigestPanel.test.tsx` — drop chapter-chip tests, add regression guard.
- Modify: `src/tests/routes/TraceView.test.tsx` — rail-selection tests; fix one stale comment.
- Modify: `src/components/trace/vite.config.ts` is NOT touched here; the demo proxy revert is Task 8.

---

## Task 1: `chapterMetrics` pure helper

**Files:**
- Create: `src/components/trace/chapterMetrics.ts`
- Test: `src/tests/trace/chapterMetrics.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tests/trace/chapterMetrics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { chapterMetrics } from "../../components/trace/chapterMetrics";
import type { StreamEvent } from "../../components/trace/types";
import type { DigestChapter } from "../../types";

const up = (uuid: string, ts: string): StreamEvent =>
  ({ kind: "user_prompt", text: "x", ts, uuid }) as StreamEvent;
const tool = (uuid: string, ts: string): StreamEvent =>
  ({
    kind: "tool_use", name: "Bash", input: {}, id: uuid, ts, msgId: "m",
    uuid, result: null,
  }) as StreamEvent;
const at = (uuid: string, ts: string): StreamEvent =>
  ({ kind: "assistant_text", text: "x", ts, msgId: "m", uuid }) as StreamEvent;

const chapters = (uuids: string[]): DigestChapter[] =>
  uuids.map((u, i) => ({ anchor_uuid: u, title: `C${i}`, caption: "" }));

const STREAM: StreamEvent[] = [
  up("a", "2026-01-01T00:00:00Z"),
  tool("t1", "2026-01-01T00:00:10Z"),
  tool("t2", "2026-01-01T00:00:20Z"),
  at("b", "2026-01-01T00:01:00Z"),
  tool("t3", "2026-01-01T00:01:30Z"),
];

describe("chapterMetrics", () => {
  it("counts tool_use events within each chapter span", () => {
    const m = chapterMetrics(STREAM, chapters(["a", "b"]));
    expect(m.get("a")!.toolCount).toBe(2);
    expect(m.get("b")!.toolCount).toBe(1);
  });

  it("computes anchor-to-next-anchor duration, last chapter to last event", () => {
    const m = chapterMetrics(STREAM, chapters(["a", "b"]));
    expect(m.get("a")!.durationMs).toBe(60000);
    expect(m.get("b")!.durationMs).toBe(30000);
  });

  it("omits chapters whose anchor is absent from the stream", () => {
    const m = chapterMetrics(STREAM, chapters(["a", "zzz"]));
    expect(m.has("zzz")).toBe(false);
    // Only "a" resolves, so its span runs to the end: 3 tools.
    expect(m.get("a")!.toolCount).toBe(3);
  });

  it("sorts anchors by stream position so spans are never negative", () => {
    const m = chapterMetrics(STREAM, chapters(["b", "a"]));
    expect(m.get("a")!.toolCount).toBe(2);
    expect(m.get("b")!.toolCount).toBe(1);
    expect(m.get("a")!.durationMs).toBe(60000);
  });

  it("returns null duration when timestamps are missing", () => {
    const noTs: StreamEvent[] = [up("a", ""), tool("t", "")];
    const m = chapterMetrics(noTs, chapters(["a"]));
    expect(m.get("a")!.durationMs).toBeNull();
    expect(m.get("a")!.toolCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/trace/chapterMetrics.test.ts`
Expected: FAIL — "Failed to resolve import" / `chapterMetrics is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/trace/chapterMetrics.ts`:

```ts
import type { StreamEvent } from "./types";
import type { DigestChapter } from "../../types";

export interface ChapterMetric {
  anchorUuid: string;
  /** Number of tool_use events in the chapter's span. */
  toolCount: number;
  /** Wall-clock ms in the span, or null when timestamps are unavailable. */
  durationMs: number | null;
}

function parseTs(e: StreamEvent | undefined): number | null {
  const ts = (e as { ts?: string } | undefined)?.ts;
  if (!ts) return null;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : null;
}

/**
 * Per-chapter tool count and duration, computed by walking the stream
 * between consecutive resolved chapter anchors. Chapters whose anchor uuid
 * is absent from the stream are omitted (the rail renders those title-only).
 * Anchors are sorted by stream position so out-of-order anchors never
 * produce a negative span.
 */
export function chapterMetrics(
  stream: StreamEvent[],
  chapters: DigestChapter[],
): Map<string, ChapterMetric> {
  const index = new Map<string, number>();
  stream.forEach((e, i) => {
    const uuid = (e as { uuid?: string }).uuid;
    if (uuid && !index.has(uuid)) index.set(uuid, i);
  });

  const resolved = chapters
    .map((c) => ({ uuid: c.anchor_uuid, pos: index.get(c.anchor_uuid) }))
    .filter((r): r is { uuid: string; pos: number } => r.pos !== undefined)
    .sort((a, b) => a.pos - b.pos);

  const out = new Map<string, ChapterMetric>();
  for (let k = 0; k < resolved.length; k++) {
    const start = resolved[k].pos;
    const end = k + 1 < resolved.length ? resolved[k + 1].pos : stream.length;

    let toolCount = 0;
    let lastTs: number | null = null;
    for (let i = start; i < end; i++) {
      if (stream[i].kind === "tool_use") toolCount++;
      const t = parseTs(stream[i]);
      if (t !== null) lastTs = t;
    }

    let durationMs: number | null = null;
    const startTs = parseTs(stream[start]);
    if (startTs !== null) {
      const endTs = end < stream.length ? parseTs(stream[end]) : lastTs;
      if (endTs !== null) durationMs = Math.max(0, endTs - startTs);
    }

    out.set(resolved[k].uuid, { anchorUuid: resolved[k].uuid, toolCount, durationMs });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/trace/chapterMetrics.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/trace/chapterMetrics.ts src/tests/trace/chapterMetrics.test.ts
git commit -m "$(cat <<'EOF'
Add chapterMetrics helper: per-chapter tool count + duration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `ChapterDivider` stable id + scroll offset

**Files:**
- Modify: `src/components/trace/ChapterDivider.tsx`
- Modify: `src/components/trace/ChapterDivider.module.css`
- Test: `src/tests/trace/ChapterDivider.test.tsx`

- [ ] **Step 1: Write the failing test**

Append this test to `src/tests/trace/ChapterDivider.test.tsx` (inside the existing `describe`):

```tsx
  it("exposes a chapter-<uuid> id when anchorUuid is set", () => {
    const { container } = render(
      <ChapterDivider title="Frame" caption="x" anchorUuid="u1" />,
    );
    expect(container.querySelector("#chapter-u1")).not.toBeNull();
  });

  it("omits the id when anchorUuid is absent", () => {
    const { container } = render(<ChapterDivider title="Frame" caption="x" />);
    expect(container.querySelector("[id^='chapter-']")).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/trace/ChapterDivider.test.tsx`
Expected: FAIL — `#chapter-u1` not found (component ignores the new prop).

- [ ] **Step 3: Write minimal implementation**

Replace the entire body of `src/components/trace/ChapterDivider.tsx` with:

```tsx
import styles from "./ChapterDivider.module.css";

interface Props {
  title: string;
  caption: string;
  /** When set, the divider gets id="chapter-<uuid>" as the rail's scroll
   *  and IntersectionObserver target. */
  anchorUuid?: string;
}

export function ChapterDivider({ title, caption, anchorUuid }: Props) {
  return (
    <div
      className={styles.divider}
      id={anchorUuid ? `chapter-${anchorUuid}` : undefined}
    >
      <div className={styles.title}>{title}</div>
      {caption && <div className={styles.caption}>{caption}</div>}
    </div>
  );
}
```

Add `scroll-margin-top` to the `.divider` rule in `src/components/trace/ChapterDivider.module.css` so a jumped-to chapter clears the sticky header:

```css
.divider {
  margin: 22px 0 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle, #e5e5e5);
  /* Clear the sticky viewer header when scrolled to from the chapter rail. */
  scroll-margin-top: 140px;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/trace/ChapterDivider.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/trace/ChapterDivider.tsx src/components/trace/ChapterDivider.module.css src/tests/trace/ChapterDivider.test.tsx
git commit -m "$(cat <<'EOF'
ChapterDivider: stable chapter-<uuid> id + scroll-margin offset

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `Thread` emits divider for collapsed tool-call anchors

A chapter can anchor on a `tool_use`. In the default collapsed mode that tool lives inside a `ToolGroup` and never passes through `pushEvent`, so today no divider (and no scroll target) is emitted for it. This task fixes that and threads `anchorUuid` into every divider.

**Files:**
- Modify: `src/components/trace/Thread.tsx`
- Test: `src/tests/trace/Thread.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/tests/trace/Thread.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Thread } from "../../components/trace/Thread";
import type { Session } from "../../components/trace/types";
import type { TraceDigest } from "../../types";

function makeSession(): Session {
  return {
    meta: {
      sessionId: "s", aiTitle: null, firstPrompt: null, cwd: "/repo",
      gitBranch: null, model: null, modelLabel: null, sourceFormat: null,
      version: null, permissionMode: null, startedAt: null, endedAt: null,
      prLink: null,
      tokens: { input: 0, cacheCreate: 0, cacheRead: 0, output: 0 },
      assistantThinkMs: 0, toolCounts: {}, toolCallCount: 1,
      userPromptCount: 1, assistantTextCount: 0, agents: [],
    },
    stream: [
      { kind: "user_prompt", text: "do it", ts: "2026-01-01T00:00:00Z", uuid: "p1" },
      {
        kind: "tool_use", name: "Bash", input: { command: "ls" },
        id: "tool1", ts: "2026-01-01T00:00:05Z", msgId: "m1", uuid: "tool1",
        result: null,
      },
    ],
  };
}

const digest: TraceDigest = {
  ask: "a", decisions: "d", files: "f", tests: "t", dead_ends: "e",
  chapters: [{ anchor_uuid: "tool1", title: "Run it", caption: "Runs the command." }],
};

describe("Thread chapter anchors", () => {
  it("emits a chapter divider for a tool_use anchor in a collapsed group", () => {
    const { container } = render(
      <Thread
        session={makeSession()}
        shortId="abc"
        showSystemEvents={false}
        expandToolCalls={false}
        digest={digest}
      />,
    );
    expect(container.querySelector("#chapter-tool1")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/trace/Thread.test.tsx`
Expected: FAIL — `#chapter-tool1` not found (collapsed tool anchor emits no divider).

- [ ] **Step 3: Write minimal implementation**

In `src/components/trace/Thread.tsx`, in `pushEvent`, pass `anchorUuid` to the divider. Replace the existing divider push inside `pushEvent`:

```tsx
    if (uuid && chaptersByUuid.has(uuid)) {
      const chapter = chaptersByUuid.get(uuid)!;
      out.push(
        <ChapterDivider
          title={chapter.title}
          caption={chapter.caption}
          key={`chapter-${uuid}`}
        />,
      );
    }
```

with:

```tsx
    if (uuid && chaptersByUuid.has(uuid)) {
      const chapter = chaptersByUuid.get(uuid)!;
      out.push(
        <ChapterDivider
          title={chapter.title}
          caption={chapter.caption}
          anchorUuid={uuid}
          key={`chapter-${uuid}`}
        />,
      );
    }
```

Then, in the `tool_use` branch, handle the collapsed-anchor case. Replace:

```tsx
      if (!expandToolCalls) {
        pendingRun.push(item);
      } else {
```

with:

```tsx
      if (!expandToolCalls) {
        // A chapter can anchor on a tool_use. In collapsed mode the tool is
        // folded into a ToolGroup and never passes through pushEvent, so emit
        // its divider here (flushing the prior run so the divider sits before
        // the group this tool starts).
        if (e.uuid && chaptersByUuid.has(e.uuid)) {
          flushRun();
          const chapter = chaptersByUuid.get(e.uuid)!;
          out.push(
            <ChapterDivider
              title={chapter.title}
              caption={chapter.caption}
              anchorUuid={e.uuid}
              key={`chapter-${e.uuid}`}
            />,
          );
        }
        pendingRun.push(item);
      } else {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/trace/Thread.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/components/trace/Thread.tsx src/tests/trace/Thread.test.tsx
git commit -m "$(cat <<'EOF'
Thread: emit chapter divider for tool_use anchors in collapsed groups

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `ChapterRail` component + styles

**Files:**
- Create: `src/components/trace/ChapterRail.tsx`
- Modify: `src/styles/viewer.css`
- Test: `src/tests/trace/ChapterRail.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/tests/trace/ChapterRail.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChapterRail } from "../../components/trace/ChapterRail";
import type { Session, StreamEvent } from "../../components/trace/types";
import type { TraceDigest } from "../../types";

function sessionWith(stream: StreamEvent[]): Session {
  return {
    meta: {
      sessionId: "s", aiTitle: null, firstPrompt: null, cwd: null,
      gitBranch: null, model: null, modelLabel: null, sourceFormat: null,
      version: null, permissionMode: null, startedAt: null, endedAt: null,
      prLink: null,
      tokens: { input: 0, cacheCreate: 0, cacheRead: 0, output: 0 },
      assistantThinkMs: 0, toolCounts: {}, toolCallCount: 0,
      userPromptCount: 0, assistantTextCount: 0, agents: [],
    },
    stream,
  };
}

const up = (uuid: string, ts: string): StreamEvent =>
  ({ kind: "user_prompt", text: "x", ts, uuid }) as StreamEvent;
const tool = (uuid: string, ts: string): StreamEvent =>
  ({
    kind: "tool_use", name: "Bash", input: {}, id: uuid, ts, msgId: "m",
    uuid, result: null,
  }) as StreamEvent;

const digest = (chapters: TraceDigest["chapters"]): TraceDigest =>
  ({ ask: "a", decisions: "d", files: "f", tests: "t", dead_ends: "e", chapters });

const STREAM: StreamEvent[] = [
  up("a", "2026-01-01T00:00:00Z"),
  tool("t1", "2026-01-01T00:00:10Z"),
  up("b", "2026-01-01T00:01:00Z"),
  tool("t2", "2026-01-01T00:01:10Z"),
  tool("t3", "2026-01-01T00:01:20Z"),
];
const TWO = digest([
  { anchor_uuid: "a", title: "First", caption: "" },
  { anchor_uuid: "b", title: "Second", caption: "" },
]);

describe("ChapterRail", () => {
  it("renders a row per chapter with tool-count and duration meta", () => {
    render(<ChapterRail session={sessionWith(STREAM)} digest={TWO} />);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.getByText("1t · 1m")).toBeInTheDocument();
    expect(screen.getByText("2t · 20s")).toBeInTheDocument();
  });

  it("sizes bars relative to the longest chapter (longest = 100%)", () => {
    const { container } = render(
      <ChapterRail session={sessionWith(STREAM)} digest={TWO} />,
    );
    const fills = container.querySelectorAll<HTMLElement>(".chapterrail-fill");
    expect(fills[0].style.width).toBe("100%");
    const w2 = parseFloat(fills[1].style.width);
    expect(w2).toBeGreaterThan(0);
    expect(w2).toBeLessThan(100);
  });

  it("scrolls to the chapter divider on click", async () => {
    const user = userEvent.setup();
    const scrollSpy = vi.fn();
    vi.spyOn(document, "getElementById").mockImplementation((id) =>
      id === "chapter-a" ? ({ scrollIntoView: scrollSpy } as unknown as HTMLElement) : null,
    );
    render(<ChapterRail session={sessionWith(STREAM)} digest={TWO} />);
    await user.click(screen.getByText("First"));
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("shows tool count only when timestamps are missing", () => {
    render(
      <ChapterRail
        session={sessionWith([up("a", ""), tool("t1", ""), tool("t2", "")])}
        digest={digest([{ anchor_uuid: "a", title: "Only", caption: "" }])}
      />,
    );
    expect(screen.getByText("2t")).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  it("renders an unresolved-anchor chapter title-only (never dropped)", () => {
    const { container } = render(
      <ChapterRail
        session={sessionWith([up("a", "2026-01-01T00:00:00Z")])}
        digest={digest([{ anchor_uuid: "ghost", title: "Ghost", caption: "" }])}
      />,
    );
    expect(screen.getByText("Ghost")).toBeInTheDocument();
    expect(container.querySelector(".chapterrail-arc")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/trace/ChapterRail.test.tsx`
Expected: FAIL — "Failed to resolve import" for `ChapterRail`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/trace/ChapterRail.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "./types";
import type { TraceDigest } from "../../types";
import { chapterMetrics } from "./chapterMetrics";

interface Props {
  session: Session;
  digest: TraceDigest;
}

function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m${String(rem).padStart(2, "0")}s` : `${m}m`;
}

export function ChapterRail({ session, digest }: Props) {
  const chapters = digest.chapters;

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

  // Track the current chapter by observing the divider elements; the topmost
  // one in the active band wins. Mirrors PromptRail.
  useEffect(() => {
    if (chapters.length === 0 || typeof window === "undefined") return;
    if (typeof IntersectionObserver === "undefined") return;
    const positions = new Map<string, number>();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).id;
          if (!id.startsWith("chapter-")) continue;
          const uuid = id.slice("chapter-".length);
          if (entry.isIntersecting) positions.set(uuid, entry.boundingClientRect.top);
          else positions.delete(uuid);
        }
        let best: { uuid: string; top: number } | null = null;
        for (const [uuid, top] of positions) {
          if (best === null || top < best.top) best = { uuid, top };
        }
        if (best) setCurrentUuid(best.uuid);
      },
      { rootMargin: "-140px 0px -55% 0px", threshold: 0 },
    );
    for (const c of chapters) {
      const el = document.getElementById(`chapter-${c.anchor_uuid}`);
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
    const el = document.getElementById(`chapter-${uuid}`);
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
          const meta = m
            ? m.durationMs != null
              ? `${m.toolCount}t · ${fmtDur(m.durationMs)}`
              : `${m.toolCount}t`
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
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
```

Append these rules to `src/styles/viewer.css` (place them right after the `.promptrail*` block, near line 360):

```css
.vibeshub-viewer .chapterrail {
  position: sticky;
  top: 64px;
  align-self: start;
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-height: calc(100vh - 88px);
}
.vibeshub-viewer .chapterrail-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 0 4px 12px;
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: 8px;
}
.vibeshub-viewer .chapterrail-count {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text);
  font-weight: 600;
}
.vibeshub-viewer .chapterrail-label {
  font-family: var(--font-mono);
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
}
.vibeshub-viewer .chapterrail-list {
  list-style: none;
  margin: 0;
  padding: 0 4px 0 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  scrollbar-width: thin;
}
.vibeshub-viewer .chapterrail-item {
  display: grid;
  grid-template-columns: 22px 1fr;
  gap: 10px;
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 6px;
  padding: 8px 10px 10px;
  color: inherit;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.vibeshub-viewer .chapterrail-item:hover {
  background: var(--bg-subtle);
}
.vibeshub-viewer .chapterrail-item.cur {
  background: var(--accent-soft);
  border-color: color-mix(in oklab, var(--accent) 35%, transparent);
}
.vibeshub-viewer .chapterrail-n {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-faint);
  padding-top: 1px;
  text-align: right;
}
.vibeshub-viewer .chapterrail-item.cur .chapterrail-n {
  color: var(--accent-strong);
  font-weight: 600;
}
.vibeshub-viewer .chapterrail-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.vibeshub-viewer .chapterrail-title {
  font-size: 12.5px;
  line-height: 1.35;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vibeshub-viewer .chapterrail-arc {
  display: flex;
  align-items: center;
  gap: 8px;
}
.vibeshub-viewer .chapterrail-bar {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--bg-subtle);
  overflow: hidden;
}
.vibeshub-viewer .chapterrail-fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--accent);
}
.vibeshub-viewer .chapterrail-meta {
  font-family: var(--font-mono);
  font-size: 9.5px;
  color: var(--text-faint);
  white-space: nowrap;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/trace/ChapterRail.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/trace/ChapterRail.tsx src/styles/viewer.css src/tests/trace/ChapterRail.test.tsx
git commit -m "$(cat <<'EOF'
Add ChapterRail: chapter navigation spine with duration bars

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire `ChapterRail` into `TraceViewer`

**Files:**
- Modify: `src/components/trace/TraceViewer.tsx`
- Test: `src/tests/routes/TraceView.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add these two tests inside the existing `describe("DigestPanel integration", ...)` block in `src/tests/routes/TraceView.test.tsx`:

```tsx
  it("renders the chapter rail (not the prompt rail) when chapters present", async () => {
    const digest = {
      ask: "a", decisions: "d", files: "f", tests: "t", dead_ends: "e",
      chapters: [
        { anchor_uuid: "779d4aa7-6138-4b55-93bb-0747bbebb8fa",
          title: "Frame the ask", caption: "x" },
      ],
    };
    mockFetchSequence({
      trace_id: "id", short_id: SHORT_ID, owner_login: "alice",
      repo_full_name: "alice/repo", pr_number: 7,
      pr_url: "https://github.com/alice/repo/pull/7", pr_title: "Add thing",
      platform: "claude-code", byte_size: FIXTURE.length, message_count: 100,
      created_at: "2026-05-17T00:00:00Z", is_private: false, ai_digest: digest,
    });
    const { container } = renderAt(`/alice/repo/pull/7/${SHORT_ID}`);
    await waitFor(() =>
      expect(container.querySelector(".chapterrail")).not.toBeNull(),
    );
    expect(container.querySelector(".promptrail")).toBeNull();
  });

  it("falls back to the prompt rail when the digest has no chapters", async () => {
    const digest = {
      ask: "a", decisions: "d", files: "f", tests: "t", dead_ends: "e",
      chapters: [],
    };
    mockFetchSequence({
      trace_id: "id", short_id: SHORT_ID, owner_login: "alice",
      repo_full_name: "alice/repo", pr_number: 7,
      pr_url: "https://github.com/alice/repo/pull/7", pr_title: "Add thing",
      platform: "claude-code", byte_size: FIXTURE.length, message_count: 100,
      created_at: "2026-05-17T00:00:00Z", is_private: false, ai_digest: digest,
    });
    const { container } = renderAt(`/alice/repo/pull/7/${SHORT_ID}`);
    await waitFor(() =>
      expect(screen.queryByText(/Loading trace/i)).not.toBeInTheDocument(),
    );
    expect(container.querySelector(".promptrail")).not.toBeNull();
    expect(container.querySelector(".chapterrail")).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tests/routes/TraceView.test.tsx`
Expected: FAIL — the first new test finds no `.chapterrail` (TraceViewer always renders PromptRail).

- [ ] **Step 3: Write minimal implementation**

In `src/components/trace/TraceViewer.tsx`, add the import after the `PromptRail` import:

```tsx
import { ChapterRail } from "./ChapterRail";
```

Replace this line:

```tsx
          <PromptRail session={session} />
```

with:

```tsx
          {trace.ai_digest?.chapters?.length ? (
            <ChapterRail session={session} digest={trace.ai_digest} />
          ) : (
            <PromptRail session={session} />
          )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tests/routes/TraceView.test.tsx`
Expected: PASS. (The existing "renders ChapterDivider above the anchored event" test still passes: "Frame the ask" now appears once in the ChapterRail and once in the inline ChapterDivider, so `getAllByText(...).length >= 2` holds.)

- [ ] **Step 5: Fix the stale comment in the existing divider test**

In the same file, in the test `"renders ChapterDivider above the anchored event when chapters present"`, update the trailing comment so it names the rail, not the panel. Replace:

```tsx
    // The title appears twice — once in the DigestPanel jump rail, once in
    // the ChapterDivider above the anchored event.
    expect(screen.getAllByText("Frame the ask").length).toBeGreaterThanOrEqual(2);
```

with:

```tsx
    // The title appears twice — once in the ChapterRail, once in the
    // ChapterDivider above the anchored event.
    expect(screen.getAllByText("Frame the ask").length).toBeGreaterThanOrEqual(2);
```

- [ ] **Step 6: Re-run the file and commit**

Run: `npx vitest run src/tests/routes/TraceView.test.tsx`
Expected: PASS.

```bash
git add src/components/trace/TraceViewer.tsx src/tests/routes/TraceView.test.tsx
git commit -m "$(cat <<'EOF'
TraceViewer: use ChapterRail when chapters exist, else PromptRail

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Remove the duplicate "JUMP TO" chips from `DigestPanel`

Chapter navigation is now owned by the rail. Drop the chip rail from the digest panel so there is one home for it.

**Files:**
- Modify: `src/components/trace/DigestPanel.tsx`
- Modify: `src/components/trace/DigestPanel.module.css`
- Test: `src/tests/trace/DigestPanel.test.tsx`

- [ ] **Step 1: Update the test to the new contract**

Replace the entire contents of `src/tests/trace/DigestPanel.test.tsx` with:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { DigestPanel } from "../../components/trace/DigestPanel";
import type { TraceDigest } from "../../types";

const sampleDigest: TraceDigest = {
  ask: "Add /healthcheck",
  decisions: "Inline in main.py",
  files: "webapp/backend/app/main.py",
  tests: "test_health.py",
  dead_ends: "Considered a new router; YAGNI",
  chapters: [
    { anchor_uuid: "u1", title: "Frame", caption: "User asks." },
    { anchor_uuid: "u2", title: "Land", caption: "Patch shipped." },
  ],
};

describe("DigestPanel", () => {
  it("renders all five bullets", () => {
    render(<DigestPanel digest={sampleDigest} />);
    expect(screen.getByText(/Ask/i)).toBeInTheDocument();
    expect(screen.getByText("Add /healthcheck")).toBeInTheDocument();
    expect(screen.getByText("Inline in main.py")).toBeInTheDocument();
    expect(screen.getByText("webapp/backend/app/main.py")).toBeInTheDocument();
    expect(screen.getByText("test_health.py")).toBeInTheDocument();
    expect(screen.getByText("Considered a new router; YAGNI")).toBeInTheDocument();
  });

  it("does not render chapter jump chips (owned by the rail now)", () => {
    render(<DigestPanel digest={sampleDigest} />);
    expect(screen.queryByText("Frame")).not.toBeInTheDocument();
    expect(screen.queryByText("Land")).not.toBeInTheDocument();
    expect(screen.queryByText(/Jump to/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/trace/DigestPanel.test.tsx`
Expected: FAIL — "Frame"/"Land" still render (the chip rail is still in the component).

- [ ] **Step 3: Remove the chip rail from the component**

Replace the entire contents of `src/components/trace/DigestPanel.tsx` with:

```tsx
import type { TraceDigest } from "../../types";
import styles from "./DigestPanel.module.css";

interface Props {
  digest: TraceDigest;
}

const BULLETS: Array<{ key: keyof Omit<TraceDigest, "chapters">; label: string }> = [
  { key: "ask", label: "Ask" },
  { key: "decisions", label: "Key decisions" },
  { key: "files", label: "Files touched" },
  { key: "tests", label: "Tests added" },
  { key: "dead_ends", label: "Dead ends" },
];

export function DigestPanel({ digest }: Props) {
  return (
    <div className={styles.wrap}>
      <section className={styles.panel}>
        <div className={styles.eyebrow}>Digest</div>
        <div className={styles.bullets}>
          {BULLETS.map(({ key, label }) => (
            <div className={styles.row} key={key}>
              <div className={styles.label}>{label}</div>
              <div className={styles.value}>{digest[key]}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
```

Then delete the now-unused chip styles from `src/components/trace/DigestPanel.module.css`: remove the `.rail`, `.railLabel`, `.chapters`, `.chapter`, and `.chapter:hover` rule blocks. Leave `.wrap`, `.panel`, `.eyebrow`, `.bullets`, `.row`, `.label`, and `.value` intact.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/trace/DigestPanel.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/trace/DigestPanel.tsx src/components/trace/DigestPanel.module.css src/tests/trace/DigestPanel.test.tsx
git commit -m "$(cat <<'EOF'
DigestPanel: drop the duplicate JUMP TO chip rail (owned by ChapterRail)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Full suite + typecheck

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: PASS — all suites green, including the existing `TraceView`, `ChapterDivider`, and `DigestPanel` suites.

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: no errors, clean exit.

- [ ] **Step 3: Fix anything red, then re-run**

If any test or type error appears, fix it at its source (do not weaken assertions), then re-run Steps 1-2 until both are clean. No commit if nothing changed.

---

## Task 8: Restore the demo proxy in `vite.config.ts`

During design, `vite.config.ts` was pointed at prod (`https://vibeshub.ai`) to demo against real data. Restore the local backend target before this branch is reviewed.

**Files:**
- Modify: `src/../vite.config.ts` (i.e. `webapp/frontend/vite.config.ts`)

- [ ] **Step 1: Restore the original proxy**

In `webapp/frontend/vite.config.ts`, replace:

```ts
    proxy: {
      // Demo against real prod data. Restore "http://127.0.0.1:8000" for local backend.
      "/api": {
        target: "https://vibeshub.ai",
        changeOrigin: true,
        secure: true,
      },
    },
```

with:

```ts
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
```

- [ ] **Step 2: Verify the working tree is otherwise clean**

Run: `git status --short`
Expected: only `vite.config.ts` modified (now reverted to the committed baseline; `git diff webapp/frontend/vite.config.ts` should show no remaining changes vs HEAD on main for that file). If `git diff` shows the file matches its original committed state, there is nothing to commit for it.

- [ ] **Step 3: Confirm**

The demo proxy is gone; no commit is needed for `vite.config.ts` (it now matches its baseline). The feature is implemented across Tasks 1-6 with passing tests and a clean typecheck.

---

## Self-Review

**Spec coverage:**
- §4.1 ChapterRail → Task 4. §4.2 metrics → Task 1. §4.3 stable divider id + collapsed-tool-anchor fix → Tasks 2, 3. §4.4 current tracking → Task 4 (IntersectionObserver on `#chapter-<uuid>`). §4.5 click-to-jump → Task 4. §4.6 TraceViewer wiring + fallback → Task 5. §4.7 DigestPanel cleanup → Task 6. §4.8 styling → Task 4. §5 fallback chart → Tasks 5 (rail selection) and 4 (degraded-timestamp + unresolved-anchor cases tested). §6 testing → covered per task.
- Refinement vs spec §4.2: an unresolved-anchor chapter is rendered **title-only**, never dropped (so the rail always reflects the full chapter list and the existing `getByText("Frame")` integration test keeps passing). The spec text is updated to match.

**Placeholder scan:** none — every code/test step has complete content and exact commands.

**Type consistency:** `chapterMetrics(stream, chapters) -> Map<string, ChapterMetric>` defined in Task 1 and consumed identically in Task 4; `ChapterMetric.{anchorUuid,toolCount,durationMs}` names match; `ChapterDivider` `anchorUuid?` prop added in Task 2 and passed in Task 3; `ChapterRail` props `{session, digest}` match the call site in Task 5.
