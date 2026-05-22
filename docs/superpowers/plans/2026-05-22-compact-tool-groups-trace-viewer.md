# Compact Tool Groups for the Trace Viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Compact` toggle to the trace viewer that folds each run of consecutive tool calls into a single expandable summary line, cutting scrolling.

**Architecture:** A `Compact` pill toggle (state in `TraceViewer`, not persisted) is added next to `Show system events`. When on, `Thread` accumulates consecutive `tool_use` events into runs and renders one new `ToolGroup` component per run instead of individual `ToolCard`s. `ToolGroup` shows a collapsed summary line (count + per-tool breakdown + error dot + first-call time) and, when expanded, renders the run's `ToolCard`s — each still independently expandable. Runs are flushed (ended) whenever a rendered non-tool event (`user_prompt`, `assistant_text`, `thinking`, `pr_link`, or a visible system/progress row) is encountered.

**Tech Stack:** React + TypeScript, Vite, Vitest + @testing-library/react. Frontend lives in `webapp/frontend`.

**Working directory for all commands:** `/Users/bhavya/git/vibeshub/webapp/frontend`

**Spec:** `docs/superpowers/specs/2026-05-22-compact-tool-groups-trace-viewer-design.md`

---

## File Structure

- `src/components/trace/tools.ts` — *modify*: add pure `formatBreakdown` helper.
- `src/components/trace/ThreadControls.tsx` — *modify*: add `Compact` toggle.
- `src/components/trace/TraceViewer.tsx` — *modify*: add `compact` state, wire to `ThreadControls` and `Thread`.
- `src/components/trace/tool/ToolGroup.tsx` — *create*: collapsed group line + expanded `ToolCard` list.
- `src/components/trace/Thread.tsx` — *modify*: accept `compact`, accumulate runs, emit `ToolGroup`.
- `src/styles/viewer.css` — *modify*: append `.tool-group` styles.
- `src/tests/tools.test.ts` — *create*: unit tests for `formatBreakdown`.
- `src/tests/routes/TraceView.test.tsx` — *modify*: add toggle + grouping integration tests.

---

## Task 1: `formatBreakdown` helper

**Files:**
- Modify: `src/components/trace/tools.ts`
- Test: `src/tests/tools.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/tests/tools.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatBreakdown } from "../components/trace/tools";

describe("formatBreakdown", () => {
  it("counts tools and orders them by first appearance", () => {
    expect(formatBreakdown(["Bash", "Read", "Bash", "Edit"])).toBe(
      "2 Bash · 1 Read · 1 Edit",
    );
  });

  it("uses friendly tool labels from TOOL_META", () => {
    expect(formatBreakdown(["AskUserQuestion", "Agent"])).toBe(
      "1 Ask user · 1 Subagent",
    );
  });

  it("returns an empty string when given no tools", () => {
    expect(formatBreakdown([])).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/tools.test.ts`
Expected: FAIL — `formatBreakdown` is not exported from `tools.ts`.

- [ ] **Step 3: Add the implementation**

Append to `src/components/trace/tools.ts`, before the final `export { TOOL_META };` line (so it sits with the other helpers):

```ts
/**
 * "3 Bash · 2 Read · 1 Edit" — counts tool calls by friendly label,
 * ordered by first appearance. Empty string for an empty list.
 */
export function formatBreakdown(names: string[]): string {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const name of names) {
    const label = toolLabel(name);
    if (!counts.has(label)) order.push(label);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return order.map((label) => `${counts.get(label)} ${label}`).join(" · ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/tools.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/trace/tools.ts src/tests/tools.test.ts
git commit -m "Add formatBreakdown helper for tool-group summaries"
```

---

## Task 2: `Compact` toggle

**Files:**
- Modify: `src/components/trace/ThreadControls.tsx`
- Modify: `src/components/trace/TraceViewer.tsx`
- Test: `src/tests/routes/TraceView.test.tsx`

- [ ] **Step 1: Write the failing test**

In `src/tests/routes/TraceView.test.tsx`, add this `it` block inside the `describe("TraceView", ...)` block, after the existing first test ("renders the hero title..."):

```ts
  it("renders a Compact toggle in the thread controls", async () => {
    mockFetchSequence({
      trace_id: "id",
      short_id: SHORT_ID,
      owner_login: "alice",
      repo_full_name: "alice/repo",
      pr_number: 7,
      pr_url: "https://github.com/alice/repo/pull/7",
      pr_title: "Add thing",
      platform: "claude-code",
      byte_size: FIXTURE.length,
      message_count: 100,
      created_at: "2026-05-17T00:00:00Z",
      is_private: false,
    });

    renderAt(`/alice/repo/pull/7/${SHORT_ID}`);

    expect(
      await screen.findByRole("button", { name: /compact/i }),
    ).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/routes/TraceView.test.tsx -t "Compact toggle"`
Expected: FAIL — no button named "Compact".

- [ ] **Step 3: Add the `Compact` toggle to `ThreadControls`**

Replace the entire contents of `src/components/trace/ThreadControls.tsx` with:

```tsx
interface Props {
  showSystemEvents: boolean;
  setShowSystemEvents: (v: boolean) => void;
  compact: boolean;
  setCompact: (v: boolean) => void;
}

function Toggle({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      className={"toggle" + (on ? " on" : "")}
      onClick={onClick}
      type="button"
      aria-pressed={on}
    >
      <span className="check" />
      {label}
    </button>
  );
}

export function ThreadControls({
  showSystemEvents,
  setShowSystemEvents,
  compact,
  setCompact,
}: Props) {
  return (
    <div className="thread-controls">
      <Toggle
        on={showSystemEvents}
        onClick={() => setShowSystemEvents(!showSystemEvents)}
        label="Show system events"
      />
      <Toggle
        on={compact}
        onClick={() => setCompact(!compact)}
        label="Compact"
      />
    </div>
  );
}
```

- [ ] **Step 4: Add `compact` state to `TraceViewer`**

In `src/components/trace/TraceViewer.tsx`, after the existing `showSystemEvents` state line (`const [showSystemEvents, setShowSystemEvents] = useState(false);`), add:

```tsx
  const [compact, setCompact] = useState(false);
```

Then replace the `<ThreadControls .../>` element with:

```tsx
          <ThreadControls
            showSystemEvents={showSystemEvents}
            setShowSystemEvents={setShowSystemEvents}
            compact={compact}
            setCompact={setCompact}
          />
```

(Leave the `<Thread .../>` element unchanged in this task — it gets the `compact` prop in Task 3.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/tests/routes/TraceView.test.tsx -t "Compact toggle"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/trace/ThreadControls.tsx src/components/trace/TraceViewer.tsx src/tests/routes/TraceView.test.tsx
git commit -m "Add a Compact toggle to the trace viewer thread controls"
```

---

## Task 3: `ToolGroup` component, `Thread` grouping, and styles

**Files:**
- Create: `src/components/trace/tool/ToolGroup.tsx`
- Modify: `src/components/trace/Thread.tsx`
- Modify: `src/components/trace/TraceViewer.tsx`
- Modify: `src/styles/viewer.css`
- Test: `src/tests/routes/TraceView.test.tsx`

- [ ] **Step 1: Write the failing integration tests**

In `src/tests/routes/TraceView.test.tsx`, add `fireEvent` to the existing testing-library import so the line reads:

```ts
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
```

Then add these three `it` blocks inside the `describe("TraceView", ...)` block, after the "Compact toggle" test from Task 2:

```ts
  it("folds consecutive tool calls into group lines when Compact is on", async () => {
    mockFetchSequence({
      trace_id: "id",
      short_id: SHORT_ID,
      owner_login: "alice",
      repo_full_name: "alice/repo",
      pr_number: 7,
      pr_url: "https://github.com/alice/repo/pull/7",
      pr_title: "Add thing",
      platform: "claude-code",
      byte_size: FIXTURE.length,
      message_count: 100,
      created_at: "2026-05-17T00:00:00Z",
      is_private: false,
    });

    renderAt(`/alice/repo/pull/7/${SHORT_ID}`);

    const toggle = await screen.findByRole("button", { name: /compact/i });

    // Off by default — no tool-group summary lines.
    expect(
      screen.queryAllByRole("button", { name: /tool call/i }),
    ).toHaveLength(0);

    fireEvent.click(toggle);

    // On — runs of consecutive tool calls collapse into group lines.
    expect(
      screen.getAllByRole("button", { name: /tool call/i }).length,
    ).toBeGreaterThan(0);
  });

  it("expands a tool group to reveal the individual tool cards", async () => {
    mockFetchSequence({
      trace_id: "id",
      short_id: SHORT_ID,
      owner_login: "alice",
      repo_full_name: "alice/repo",
      pr_number: 7,
      pr_url: "https://github.com/alice/repo/pull/7",
      pr_title: "Add thing",
      platform: "claude-code",
      byte_size: FIXTURE.length,
      message_count: 100,
      created_at: "2026-05-17T00:00:00Z",
      is_private: false,
    });

    renderAt(`/alice/repo/pull/7/${SHORT_ID}`);

    const toggle = await screen.findByRole("button", { name: /compact/i });
    fireEvent.click(toggle);

    const groups = screen.getAllByRole("button", { name: /tool call/i });
    const before = screen.getAllByRole("button").length;

    fireEvent.click(groups[0]);

    expect(groups[0]).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("button").length).toBeGreaterThan(before);
  });

  it("renders a lone tool call as its own group when Compact is on", async () => {
    mockFetchSequence({
      trace_id: "id",
      short_id: SHORT_ID,
      owner_login: "alice",
      repo_full_name: "alice/repo",
      pr_number: 7,
      pr_url: "https://github.com/alice/repo/pull/7",
      pr_title: "Add thing",
      platform: "claude-code",
      byte_size: FIXTURE.length,
      message_count: 100,
      created_at: "2026-05-17T00:00:00Z",
      is_private: false,
    });

    renderAt(`/alice/repo/pull/7/${SHORT_ID}`);

    const toggle = await screen.findByRole("button", { name: /compact/i });
    fireEvent.click(toggle);

    // The fixture has tool calls isolated between assistant text — each
    // renders as a group of one.
    expect(screen.getAllByText("1 tool call").length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tests/routes/TraceView.test.tsx`
Expected: the three new tests FAIL — `Thread` does not yet group tool calls, so no `/tool call/i` buttons exist. The pre-existing tests still PASS.

- [ ] **Step 3: Create the `ToolGroup` component**

Create `src/components/trace/tool/ToolGroup.tsx`:

```tsx
import { useState } from "react";
import type { AgentSummary, ProgressEvent, ToolUseEvent } from "../types";
import { fmtTimeOfDay } from "../format";
import { formatBreakdown } from "../tools";
import { Chev } from "../icons";
import { ToolCard } from "./ToolCard";

// One tool call inside a group, carrying the per-call props ToolCard needs.
export interface ToolGroupItem {
  event: ToolUseEvent;
  followingPrompt: string | null;
  progress: ProgressEvent[];
}

interface Props {
  items: ToolGroupItem[];
  root: string | null;
  shortId: string;
  agents: AgentSummary[];
}

// A run of consecutive tool calls, collapsed into one summary line.
export function ToolGroup({ items, root, shortId, agents }: Props) {
  const [open, setOpen] = useState(false);
  const n = items.length;
  const breakdown = formatBreakdown(items.map((it) => it.event.name));
  const isErr = items.some((it) => !!it.event.result?.isError);
  const firstTs = items[0]?.event.ts;

  return (
    <div className={"tool-group" + (open ? " is-open" : "")}>
      <button
        className="tool-group-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        type="button"
      >
        <Chev />
        <span className="tool-group-count">
          {n} tool call{n === 1 ? "" : "s"}
        </span>
        <span className="tool-group-breakdown">{breakdown}</span>
        {isErr && <span className="tool-error-dot" title="error" />}
        <span className="tool-meta-r">{fmtTimeOfDay(firstTs)}</span>
      </button>
      {open && (
        <div className="tool-group-body">
          {items.map((it, i) => (
            <ToolCard
              event={it.event}
              root={root}
              followingPrompt={it.followingPrompt}
              shortId={shortId}
              agents={agents}
              progress={it.progress}
              key={i}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `Thread.tsx` to group runs**

Replace the entire contents of `src/components/trace/Thread.tsx` with:

```tsx
import type { Session, StreamEvent } from "./types";
import { UserPrompt } from "./UserPrompt";
import { AssistantText } from "./AssistantText";
import { ThinkingBlock } from "./ThinkingBlock";
import { SystemEventRow } from "./SystemEventRow";
import { PrCard } from "./PrCard";
import { ToolCard } from "./tool/ToolCard";
import { ToolGroup, type ToolGroupItem } from "./tool/ToolGroup";
import { progressByTool } from "./parser";

interface Props {
  session: Session;
  shortId: string;
  showSystemEvents: boolean;
  compact: boolean;
}

function isSystemish(e: StreamEvent): boolean {
  return (
    e.kind === "attachment" ||
    e.kind === "system_event" ||
    e.kind === "file_snapshot" ||
    e.kind === "system_text"
  );
}

function buildNextPromptIndex(stream: StreamEvent[]): Array<string | null> {
  const next: Array<string | null> = new Array(stream.length).fill(null);
  let cur: string | null = null;
  for (let i = stream.length - 1; i >= 0; i--) {
    next[i] = cur;
    if (stream[i].kind === "user_prompt") {
      cur = (stream[i] as { text: string }).text;
    }
  }
  return next;
}

export function Thread({
  session,
  shortId,
  showSystemEvents,
  compact,
}: Props) {
  const stream = session.stream;
  const root = session.meta.cwd;
  const totalPrompts = session.meta.userPromptCount;
  const agents = session.meta.agents ?? [];
  const nextPrompt = buildNextPromptIndex(stream);
  const promptUuids: string[] = [];
  const toolIds = new Set<string>();
  for (const ev of stream) {
    if (ev.kind === "user_prompt" && ev.uuid) promptUuids.push(ev.uuid);
    if (ev.kind === "tool_use") toolIds.add(ev.id);
  }
  const hooksByTool = progressByTool(stream);

  const out: React.ReactNode[] = [];
  let promptCounter = -1;

  // Compact mode accumulates consecutive tool calls; flushRun() emits the
  // accumulated run as one ToolGroup and is called before any non-tool node.
  let pendingRun: ToolGroupItem[] = [];
  const flushRun = () => {
    if (pendingRun.length === 0) return;
    const run = pendingRun;
    pendingRun = [];
    out.push(
      <ToolGroup
        items={run}
        root={root}
        shortId={shortId}
        agents={agents}
        key={`group-${run[0].event.id}`}
      />,
    );
  };

  for (let i = 0; i < stream.length; i++) {
    const e = stream[i];
    const key = `${e.kind}-${i}`;

    if (e.kind === "user_prompt") {
      flushRun();
      promptCounter++;
      if (promptCounter > 0) {
        out.push(<div className="turn-sep" key={`sep-${i}`} />);
      }
      out.push(
        <UserPrompt
          event={e}
          idx={promptCounter}
          total={totalPrompts}
          nextPromptUuid={promptUuids[promptCounter + 1]}
          key={key}
        />,
      );
      continue;
    }
    if (e.kind === "assistant_text") {
      flushRun();
      out.push(<AssistantText event={e} key={key} />);
      continue;
    }
    if (e.kind === "thinking") {
      flushRun();
      out.push(<ThinkingBlock event={e} key={key} />);
      continue;
    }
    if (e.kind === "tool_use") {
      const item: ToolGroupItem = {
        event: e,
        followingPrompt: nextPrompt[i],
        progress: hooksByTool.get(e.id) ?? [],
      };
      if (compact) {
        pendingRun.push(item);
      } else {
        out.push(
          <ToolCard
            event={e}
            root={root}
            followingPrompt={item.followingPrompt}
            shortId={shortId}
            agents={agents}
            progress={item.progress}
            key={key}
          />,
        );
      }
      continue;
    }
    if (e.kind === "pr_link") {
      flushRun();
      out.push(<PrCard event={e} key={key} />);
      continue;
    }
    if (e.kind === "progress") {
      // Progress events for a tool in this stream are shown inside that
      // tool's card; only orphans (no parent tool here) render standalone.
      const orphan = !e.parentToolUseID || !toolIds.has(e.parentToolUseID);
      if (orphan && showSystemEvents) {
        flushRun();
        out.push(<SystemEventRow event={e} key={key} />);
      }
      continue;
    }
    if (showSystemEvents && isSystemish(e)) {
      flushRun();
      out.push(<SystemEventRow event={e} key={key} />);
    }
  }
  flushRun();

  return <div className="thread">{out}</div>;
}
```

- [ ] **Step 5: Pass `compact` from `TraceViewer` to `Thread`**

In `src/components/trace/TraceViewer.tsx`, replace the `<Thread .../>` element with:

```tsx
          <Thread
            session={session}
            shortId={shortId}
            showSystemEvents={showSystemEvents}
            compact={compact}
          />
```

- [ ] **Step 6: Append `.tool-group` styles**

Append to the end of `src/styles/viewer.css`:

```css

/* ---------- compact tool groups ---------- */
/* A run of consecutive tool calls collapsed into one summary line.
   Visually matches the collapsed tool-card head. */
.vibeshub-viewer .tool-group {
  margin: 6px 0;
  padding-left: 36px;
  position: relative;
}
.vibeshub-viewer .tool-group-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  width: 100%;
  text-align: left;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: border-color 120ms ease;
}
.vibeshub-viewer .tool-group-head:hover {
  border-color: var(--border-strong);
}
.vibeshub-viewer .tool-group.is-open .tool-group-head {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}
.vibeshub-viewer .tool-group-head .chev {
  width: 14px;
  height: 14px;
  color: var(--text-faint);
  transition: transform 160ms ease;
  flex: none;
}
.vibeshub-viewer .tool-group.is-open .tool-group-head .chev {
  transform: rotate(90deg);
}
.vibeshub-viewer .tool-group-count {
  font-size: 11.5px;
  font-family: var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  flex: none;
  white-space: nowrap;
}
.vibeshub-viewer .tool-group-breakdown {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  color: var(--text-faint);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Nested cards sit indented under the group head rather than at the
   thread's left gutter. */
.vibeshub-viewer .tool-group-body {
  border: 1px solid var(--border);
  border-top: none;
  border-bottom-left-radius: var(--radius);
  border-bottom-right-radius: var(--radius);
  padding: 2px 0 4px;
}
.vibeshub-viewer .tool-group-body .tool-card {
  padding-left: 14px;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/tests/routes/TraceView.test.tsx`
Expected: PASS — all tests, including the three new grouping tests.

- [ ] **Step 8: Run the full test suite and the build**

Run: `npm test`
Expected: all tests PASS.

Run: `npm run build`
Expected: clean — no TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/trace/tool/ToolGroup.tsx src/components/trace/Thread.tsx src/components/trace/TraceViewer.tsx src/styles/viewer.css src/tests/routes/TraceView.test.tsx
git commit -m "Fold consecutive tool calls into groups in Compact mode"
```

---

## Manual verification

After Task 3, open a trace in the running app:

1. Toggle `Compact` on — runs of tool calls collapse into `N tool calls · <breakdown>` lines; the thread is noticeably shorter.
2. Click a group line — it expands to the individual tool cards; each card still expands on its own.
3. A tool call sitting alone between assistant text shows as `1 tool call`.
4. Toggle `Compact` off — the thread returns to one card per tool call, unchanged.

---

## Self-Review Notes

- **Spec coverage:** `Compact` toggle (Task 2); every run length ≥ 1 → `ToolGroup` (Task 3, `Thread` accumulates and `flushRun` emits regardless of length); collapsed line with count + breakdown + error dot + first-call time (Task 3, `ToolGroup`); expanded group renders `ToolCard`s (Task 3); run definition — flushed by `user_prompt`/`assistant_text`/`thinking`/`pr_link` and visible system/progress rows, not by hidden ones (Task 3, `Thread`); `viewer.css` `.tool-group` block (Task 3); all four spec tests covered (Task 2 toggle-renders; Task 3 fold/expand/run-of-1, with the fold test's "off by default" assertion covering the Compact-off case).
- **Type consistency:** `ToolGroupItem` is defined and exported in `ToolGroup.tsx` and imported by `Thread.tsx`; `formatBreakdown` signature `(names: string[]) => string` is consistent between Task 1 and its use in `ToolGroup`; `Thread` `Props` gains `compact: boolean`, supplied by `TraceViewer`.
- **No placeholders:** every step contains complete code or exact commands.
