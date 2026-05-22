# Compact Mode for the Trace Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Compact" toggle next to "Show system events" that tightens the trace's vertical spacing and collapsed tool-row density.

**Architecture:** `TraceViewer` owns a `compact` boolean (`useState`, not persisted). When on, it adds a `compact` class to the `.vibeshub-viewer` root. All tightening lives as CSS override rules scoped under `.vibeshub-viewer.compact` — no markup or prop changes reach `Thread`/`ToolCard`/leaf components. `ThreadControls` renders a second `Toggle` using the existing `Toggle` component.

**Tech Stack:** React + TypeScript, Vite, Vitest + React Testing Library, plain CSS.

**Working directory:** All paths below are relative to `webapp/frontend/`. Run all commands from `webapp/frontend/`.

---

### Task 1: Wire the Compact toggle through ThreadControls and TraceViewer

**Files:**
- Modify: `src/components/trace/ThreadControls.tsx`
- Modify: `src/components/trace/TraceViewer.tsx`
- Test: `src/tests/routes/TraceView.test.tsx`

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe("TraceView", ...)` block in `src/tests/routes/TraceView.test.tsx`, after the existing first test (the one titled "renders the hero title and at least one tool card from the parsed trace"):

```tsx
  it("toggles the compact class on the viewer root via the Compact selector", async () => {
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

    const { container } = renderAt(`/alice/repo/pull/7/${SHORT_ID}`);

    const compactBtn = await screen.findByRole("button", {
      name: /compact/i,
    });
    const viewer = container.querySelector(".vibeshub-viewer");
    expect(viewer).not.toBeNull();

    // Off by default.
    expect(viewer!.classList.contains("compact")).toBe(false);

    // Clicking turns it on.
    fireEvent.click(compactBtn);
    expect(viewer!.classList.contains("compact")).toBe(true);

    // Clicking again turns it off.
    fireEvent.click(compactBtn);
    expect(viewer!.classList.contains("compact")).toBe(false);
  });
```

Then update the import at the top of the file so `fireEvent` is available — change:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
```

to:

```tsx
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/tests/routes/TraceView.test.tsx`
Expected: FAIL — the new test cannot find a button named `/compact/i` (`Unable to find an accessible element with the role "button" and name /compact/i`).

- [ ] **Step 3: Update ThreadControls to render the second toggle**

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

- [ ] **Step 4: Update TraceViewer to own `compact` state and apply the class**

In `src/components/trace/TraceViewer.tsx`:

Add a second `useState` line directly after the existing `showSystemEvents` line:

```tsx
  const [showSystemEvents, setShowSystemEvents] = useState(false);
  const [compact, setCompact] = useState(false);
```

Change the root `div` from:

```tsx
    <div className="vibeshub-viewer">
```

to:

```tsx
    <div className={"vibeshub-viewer" + (compact ? " compact" : "")}>
```

Change the `<ThreadControls .../>` element from:

```tsx
          <ThreadControls
            showSystemEvents={showSystemEvents}
            setShowSystemEvents={setShowSystemEvents}
          />
```

to:

```tsx
          <ThreadControls
            showSystemEvents={showSystemEvents}
            setShowSystemEvents={setShowSystemEvents}
            compact={compact}
            setCompact={setCompact}
          />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/tests/routes/TraceView.test.tsx`
Expected: PASS — all tests in the file, including the new "toggles the compact class" test.

- [ ] **Step 6: Commit**

```bash
git add src/components/trace/ThreadControls.tsx src/components/trace/TraceViewer.tsx src/tests/routes/TraceView.test.tsx
git commit -m "Add a Compact toggle to the trace viewer controls"
```

---

### Task 2: Add the compact CSS overrides

**Files:**
- Modify: `src/styles/viewer.css`

- [ ] **Step 1: Append the compact override block to viewer.css**

Add the following block at the end of `src/styles/viewer.css`. These rules only take effect when the `compact` class is present on the viewer root, so default rendering is untouched.

```css
/* ---------- compact mode ---------- */
/* Tightens the navigation skeleton — margins, separators, collapsed tool
   rows. Font sizes and expanded tool bodies are intentionally left alone. */
.vibeshub-viewer.compact .thread {
  margin: 28px auto 80px;
}
.vibeshub-viewer.compact .turn-sep {
  height: 28px;
  margin: 4px 0;
}
.vibeshub-viewer.compact .user-prompt {
  margin: 14px 0 6px;
  padding: 12px 14px;
}
.vibeshub-viewer.compact .assistant-text {
  margin: 3px 0;
}
.vibeshub-viewer.compact .assistant-text-body {
  line-height: 1.55;
}
.vibeshub-viewer.compact .thinking-block {
  margin: 2px 0 4px 36px;
}
.vibeshub-viewer.compact .thinking-empty {
  margin: 2px 0 4px 36px;
}
.vibeshub-viewer.compact .tool-card {
  margin: 2px 0;
}
.vibeshub-viewer.compact .tool-head {
  padding: 5px 12px;
}
.vibeshub-viewer.compact .pr-card {
  margin-top: 16px;
}
```

- [ ] **Step 2: Verify the build and types still pass**

Run: `npm run build`
Expected: PASS — `tsc -b` reports no type errors and `vite build` completes. (CSS is not type-checked, but this confirms nothing else broke.)

- [ ] **Step 3: Verify the test suite still passes**

Run: `npm test`
Expected: PASS — the full suite, including Task 1's compact-class test.

- [ ] **Step 4: Manual visual check**

Run: `npm run dev`, open a trace in the browser, and confirm:
- The "Compact" pill appears next to "Show system events" and toggles on/off.
- With Compact **on**: turn separators, user-prompt cards, assistant text, thinking blocks, and tool-card gaps are visibly tighter; collapsed tool rows stack into a dense, scannable column.
- Expanded tool bodies (open a Bash/Edit/Read card) keep their normal padding — diffs, output, and code blocks are unchanged.
- With Compact **off**: the trace renders exactly as before.

- [ ] **Step 5: Commit**

```bash
git add src/styles/viewer.css
git commit -m "Add compact-mode CSS overrides for the trace viewer"
```

---

## Self-Review

**Spec coverage:**
- Toggle state in `TraceViewer` (`useState`, not persisted), `compact` class on root — Task 1.
- "Compact" `Toggle` next to "Show system events" in `ThreadControls` — Task 1.
- Compact CSS overrides scoped under `.vibeshub-viewer.compact` for vertical whitespace and tool-head density — Task 2.
- No font-size change, no content hidden, expanded `.tool-body` untouched — Task 2 changes none of those selectors; Step 4 verifies it manually.
- Test: Compact toggle renders and adds/removes the `compact` class — Task 1, Step 1.

**Placeholder scan:** No TBDs; every step shows exact code and commands.

**Type consistency:** `ThreadControls` `Props` adds `compact: boolean` and `setCompact: (v: boolean) => void`; `TraceViewer` passes exactly those prop names with values from `useState`. Class name `compact` is consistent across `TraceViewer`, the CSS, and the test query.
