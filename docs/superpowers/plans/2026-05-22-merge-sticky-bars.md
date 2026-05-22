# Merge Trace Viewer Sticky Bars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the trace viewer page is scrolled, collapse its two stacked sticky bars into a single bar — a compact title moves into the top bar, left of the breadcrumb.

**Architecture:** A zero-footprint sentinel `<div>` above the sticky `.viewer-header` is watched by an `IntersectionObserver`; when it scrolls out of view, an `is-stuck` class is toggled on `.viewer-header`. CSS keyed off that class collapses the bottom bar (`TraceHeader`) via an animated CSS-grid row and cross-fades in compact title + GitHub/Raw links that are always present in the top bar's DOM.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + Testing Library, plain CSS + CSS Modules.

---

## File Structure

- `webapp/frontend/src/components/trace/ViewerTopbar.tsx` — top bar; gains a `trace` prop and renders the always-present-but-hidden compact title and compact GitHub/Raw links.
- `webapp/frontend/src/components/trace/TraceViewer.tsx` — owns the sentinel, the `IntersectionObserver`, and the `is-stuck` class on `.viewer-header`.
- `webapp/frontend/src/components/TraceHeader.tsx` — bottom bar; gains one wrapper `<div>` so its content can collapse with an animated grid row.
- `webapp/frontend/src/components/TraceHeader.module.css` — collapse styles for the bottom bar under a `:global(.viewer-header.is-stuck)` ancestor selector.
- `webapp/frontend/src/styles/viewer.css` — styles + transitions for the compact title and compact links.
- `webapp/frontend/src/tests/routes/TraceView.test.tsx` — tests for compact-element rendering and the stuck-class toggle.

All `npm`/`npx` commands below are run from `webapp/frontend/`.

---

## Task 1: Compact title and trace links in the top bar

**Files:**
- Modify: `webapp/frontend/src/components/trace/ViewerTopbar.tsx`
- Modify: `webapp/frontend/src/components/trace/TraceViewer.tsx`
- Test: `webapp/frontend/src/tests/routes/TraceView.test.tsx`

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe("TraceView", ...)` block in `webapp/frontend/src/tests/routes/TraceView.test.tsx`, after the existing `"renders the hero title..."` test:

```tsx
it("renders a compact title and trace links in the top bar", async () => {
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

  // Wait for the viewer to finish rendering.
  await screen.findByText("Add startup credential smoke-check");

  // The title appears twice: the large TraceHeader h1 and the compact top-bar copy.
  expect(screen.getAllByText("Add thing").length).toBe(2);

  // GitHub + Raw links appear twice: once in TraceHeader, once compact in the top bar.
  expect(
    screen.getAllByRole("link", { name: /view on github/i }).length,
  ).toBe(2);
  expect(
    screen.getAllByRole("link", { name: /raw jsonl/i }).length,
  ).toBe(2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/routes/TraceView.test.tsx -t "compact title"`
Expected: FAIL — `expected 1 to be 2` (only the `TraceHeader` copy exists so far).

- [ ] **Step 3: Add the `trace` prop and compact elements to `ViewerTopbar`**

Replace the entire contents of `webapp/frontend/src/components/trace/ViewerTopbar.tsx` with:

```tsx
import { Link } from "react-router-dom";
import type { Session } from "./types";
import type { TraceSummary } from "../../types";
import { IconLink, IconMoon, IconSun } from "./icons";
import { useTheme } from "./theme";

interface Props {
  session: Session;
  trace?: TraceSummary;
  repoOwner?: string;
  repoName?: string;
}

export function ViewerTopbar({ session, trace, repoOwner, repoName }: Props) {
  const { resolved, toggle } = useTheme();
  const meta = session.meta;
  const id = meta.sessionId ? meta.sessionId.slice(0, 8) : "";
  const compactTitle = trace
    ? (trace.pr_title ?? `PR #${trace.pr_number}`)
    : "";

  const copyLink = () => {
    if (typeof window === "undefined") return;
    void window.navigator.clipboard
      ?.writeText(window.location.href)
      .catch(() => undefined);
  };

  return (
    <header className="topbar">
      <div className="topbar-inner">
        {trace && (
          <span className="topbar-title">
            <span className="topbar-title-text">{compactTitle}</span>
            {trace.is_private && (
              <span className="topbar-title-lock" aria-hidden="true">
                🔒
              </span>
            )}
            <span className="topbar-title-sep" aria-hidden="true">
              ·
            </span>
          </span>
        )}
        <Link className="brand" to="/" style={{ textDecoration: "none" }}>
          <span className="brand-mark">v</span>
          <span>vibeshub</span>
        </Link>
        {repoOwner && (
          <>
            <span className="brand-sep">/</span>
            <Link className="topbar-link" to={`/${repoOwner}`}>
              {repoOwner}
            </Link>
          </>
        )}
        {repoOwner && repoName && (
          <>
            <span className="brand-sep">/</span>
            <Link
              className="topbar-link"
              to={`/${repoOwner}/${repoName}`}
            >
              {repoName}
            </Link>
          </>
        )}
        <span className="brand-sep">/</span>
        <span className="brand-trace">trace/{id}</span>
        <div className="topbar-spacer" />
        <div className="topbar-actions">
          {trace && (
            <span className="topbar-stuck-links">
              <a
                className="topbar-stuck-link"
                href={trace.pr_url}
                target="_blank"
                rel="noreferrer"
              >
                View on GitHub ↗
              </a>
              <a
                className="topbar-stuck-link"
                href={`/api/traces/${trace.short_id}/raw`}
              >
                Raw JSONL
              </a>
            </span>
          )}
          <button
            className="iconbtn"
            onClick={copyLink}
            type="button"
            aria-label="Copy share link"
          >
            <IconLink />
            <span>Share</span>
          </button>
          <button
            className="iconbtn"
            onClick={toggle}
            type="button"
            aria-label={
              resolved === "dark"
                ? "Switch to light theme"
                : "Switch to dark theme"
            }
            title={resolved === "dark" ? "Light" : "Dark"}
          >
            {resolved === "dark" ? <IconSun /> : <IconMoon />}
          </button>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Pass `trace` to `ViewerTopbar` from `TraceViewer`**

In `webapp/frontend/src/components/trace/TraceViewer.tsx`, find the `<ViewerTopbar>` element:

```tsx
        <ViewerTopbar
          session={session}
          repoOwner={repoOwner}
          repoName={repoName}
        />
```

Replace it with:

```tsx
        <ViewerTopbar
          session={session}
          trace={trace}
          repoOwner={repoOwner}
          repoName={repoName}
        />
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/tests/routes/TraceView.test.tsx -t "compact title"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd webapp/frontend
git add src/components/trace/ViewerTopbar.tsx src/components/trace/TraceViewer.tsx src/tests/routes/TraceView.test.tsx
git commit -m "$(cat <<'EOF'
Add compact title and trace links to the trace viewer top bar

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Stuck detection via IntersectionObserver

**Files:**
- Modify: `webapp/frontend/src/components/trace/TraceViewer.tsx`
- Test: `webapp/frontend/src/tests/routes/TraceView.test.tsx`

- [ ] **Step 1: Make global stubs reset between tests**

In `webapp/frontend/src/tests/routes/TraceView.test.tsx`, find the `beforeEach`:

```tsx
  beforeEach(() => {
    vi.restoreAllMocks();
  });
```

Replace it with:

```tsx
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
```

Then update the Testing Library import line:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
```

to:

```tsx
import { render, screen, waitFor, act } from "@testing-library/react";
```

- [ ] **Step 2: Write the failing test**

Add this test inside the `describe("TraceView", ...)` block, after the `"renders a compact title..."` test from Task 1:

```tsx
it("toggles the is-stuck class on the header when the sentinel scrolls away", async () => {
  // Capture the IntersectionObserver callback so the test can drive it.
  let ioCallback: IntersectionObserverCallback | undefined;
  class MockIntersectionObserver {
    constructor(cb: IntersectionObserverCallback) {
      ioCallback = cb;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

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
  await screen.findByText("Add startup credential smoke-check");

  const header = document.querySelector(".viewer-header")!;
  expect(header.classList.contains("is-stuck")).toBe(false);

  // Sentinel scrolls out of view -> header becomes stuck.
  act(() => {
    ioCallback!(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
  expect(header.classList.contains("is-stuck")).toBe(true);

  // Sentinel back in view -> two-bar layout restored.
  act(() => {
    ioCallback!(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
  expect(header.classList.contains("is-stuck")).toBe(false);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/tests/routes/TraceView.test.tsx -t "is-stuck"`
Expected: FAIL — `ioCallback` is never assigned (TraceViewer creates no observer yet), so calling `ioCallback!(...)` throws `ioCallback is not a function`.

- [ ] **Step 4: Add the sentinel, observer, and `is-stuck` class**

Replace the entire contents of `webapp/frontend/src/components/trace/TraceViewer.tsx` with:

```tsx
import { useEffect, useRef, useState } from "react";
import type { TraceSummary } from "../../types";
import type { Session } from "./types";
import { TraceHeader } from "../TraceHeader";
import { ViewerTopbar } from "./ViewerTopbar";
import { Hero } from "./Hero";
import { ThreadControls } from "./ThreadControls";
import { Thread } from "./Thread";

interface Props {
  trace: TraceSummary;
  session: Session;
  shortId: string;
  rawHref: string;
  repoOwner?: string;
  repoName?: string;
}

export function TraceViewer({
  trace,
  session,
  shortId,
  rawHref,
  repoOwner,
  repoName,
}: Props) {
  const [showSystemEvents, setShowSystemEvents] = useState(false);
  const [stuck, setStuck] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const empty = session.stream.length === 0;

  return (
    <div className="vibeshub-viewer">
      <div
        ref={sentinelRef}
        aria-hidden="true"
        style={{ height: 1, marginBottom: -1 }}
      />
      <div className={"viewer-header" + (stuck ? " is-stuck" : "")}>
        <ViewerTopbar
          session={session}
          trace={trace}
          repoOwner={repoOwner}
          repoName={repoName}
        />
        <TraceHeader trace={trace} />
      </div>
      <Hero session={session} />
      {empty ? (
        <div className="empty-state">
          This trace has no parseable events.{" "}
          <a href={rawHref}>View raw JSONL ↗</a>
        </div>
      ) : (
        <>
          <ThreadControls
            showSystemEvents={showSystemEvents}
            setShowSystemEvents={setShowSystemEvents}
          />
          <Thread
            session={session}
            shortId={shortId}
            showSystemEvents={showSystemEvents}
          />
        </>
      )}
      <footer className="viewer-footer">
        <span>session · {session.meta.sessionId ?? ""}</span>
        <span>vibeshub trace viewer</span>
      </footer>
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/tests/routes/TraceView.test.tsx -t "is-stuck"`
Expected: PASS.

- [ ] **Step 6: Run the whole TraceView test file to confirm no regressions**

Run: `npx vitest run src/tests/routes/TraceView.test.tsx`
Expected: PASS — all tests green (the stub reset added in Step 1 keeps `IntersectionObserver` undefined for the other tests, so their effect is skipped by the guard).

- [ ] **Step 7: Commit**

```bash
cd webapp/frontend
git add src/components/trace/TraceViewer.tsx src/tests/routes/TraceView.test.tsx
git commit -m "$(cat <<'EOF'
Detect when the trace viewer header is stuck on scroll

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Collapse and reveal styling

This task wires the `is-stuck` class to the actual visual merge: the bottom bar (`TraceHeader`) collapses via an animated CSS-grid row, and the compact title + links cross-fade into the top bar. CSS transitions are not unit-testable in jsdom, so this task is verified by running the dev server and by confirming the full suite still passes.

**Files:**
- Modify: `webapp/frontend/src/components/TraceHeader.tsx`
- Modify: `webapp/frontend/src/components/TraceHeader.module.css`
- Modify: `webapp/frontend/src/styles/viewer.css`

- [ ] **Step 1: Wrap `TraceHeader`'s content in a collapsible inner div**

In `webapp/frontend/src/components/TraceHeader.tsx`, the `return` currently is:

```tsx
  return (
    <header className={styles.header}>
      <div className={styles.row}>
```

…through to the closing `</header>`. Wrap the two existing children (`styles.row` and `styles.metaRow` divs) in a single `styles.inner` div. The full new `return` block is:

```tsx
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.row}>
          <h1 className={styles.title}>
            {trace.pr_title ?? `PR #${trace.pr_number}`}
            {trace.is_private && (
              <span className={styles.privateBadge}>
                <span aria-hidden="true">🔒</span> Private
              </span>
            )}
          </h1>
          <div className={styles.actions}>
            <a href={trace.pr_url} target="_blank" rel="noreferrer">
              View on GitHub ↗
            </a>
            <span className={styles.dot}>·</span>
            <a href={`/api/traces/${trace.short_id}/raw`}>Raw JSONL</a>
          </div>
        </div>
        <div className={styles.metaRow}>
          <span>
            <Link to={`/${repoOwner}`} className={styles.crumb}>
              {repoOwner}
            </Link>
            <span className={styles.crumbSep}>/</span>
            <Link
              to={`/${repoOwner}/${repoName}`}
              className={styles.crumb}
            >
              {repoName}
            </Link>{" "}
            #{trace.pr_number}
          </span>
          <span className={styles.dot}>·</span>
          <span>{trace.platform}</span>
          <span className={styles.dot}>·</span>
          <span>{trace.message_count} messages</span>
          <span className={styles.dot}>·</span>
          <span>{sizeKb} KB</span>
          <span className={styles.dot}>·</span>
          <span>{dateStr}</span>
          <span className={styles.dot}>·</span>
          <span>
            uploaded by{" "}
            <Link to={`/${trace.owner_login}`} className={styles.crumb}>
              @{trace.owner_login}
            </Link>
          </span>
        </div>
      </div>
    </header>
  );
```

- [ ] **Step 2: Rework `.header` for collapse in `TraceHeader.module.css`**

In `webapp/frontend/src/components/TraceHeader.module.css`, the file currently starts with the `.header` rule:

```css
.header {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-6);
  background: var(--color-bg);
  border-bottom: 1px solid var(--color-border);
}
```

Replace just that `.header` rule with the following (this moves the flex layout + padding onto a new `.inner` rule and makes `.header` an animatable grid that collapses under `.is-stuck`):

```css
.header {
  display: grid;
  grid-template-rows: 1fr;
  background: var(--color-bg);
  border-bottom: 1px solid var(--color-border);
  overflow: hidden;
  transition:
    grid-template-rows 240ms ease,
    opacity 180ms ease,
    visibility 0s linear 0s;
}

.inner {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-6);
  min-height: 0;
  overflow: hidden;
}

:global(.viewer-header.is-stuck) .header {
  grid-template-rows: 0fr;
  opacity: 0;
  visibility: hidden;
  border-bottom-color: transparent;
  transition:
    grid-template-rows 240ms ease,
    opacity 180ms ease,
    visibility 0s linear 240ms;
}

@media (prefers-reduced-motion: reduce) {
  .header,
  :global(.viewer-header.is-stuck) .header {
    transition: none;
  }
}
```

Leave every other rule in the file (`.row`, `.title`, `.metaRow`, `.actions`, `.dot`, `.crumb`, etc.) unchanged.

- [ ] **Step 3: Add compact-element styling to `viewer.css`**

In `webapp/frontend/src/styles/viewer.css`, find the `.iconbtn-icon` rule (in the top-bar section):

```css
.vibeshub-viewer .iconbtn-icon {
  width: 14px;
  height: 14px;
}
```

Immediately after it, add:

```css
/* ---------- compact title + links (revealed when the header is stuck) ---------- */
.vibeshub-viewer .topbar-title {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 0;
  margin-right: -16px;
  opacity: 0;
  visibility: hidden;
  overflow: hidden;
  white-space: nowrap;
  transition:
    max-width 220ms ease,
    margin-right 220ms ease,
    opacity 160ms ease,
    visibility 0s linear 220ms;
}
.vibeshub-viewer .viewer-header.is-stuck .topbar-title {
  max-width: 40vw;
  margin-right: 0;
  opacity: 1;
  visibility: visible;
  transition:
    max-width 220ms ease,
    margin-right 220ms ease,
    opacity 160ms ease,
    visibility 0s linear 0s;
}
.vibeshub-viewer .topbar-title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
}
.vibeshub-viewer .topbar-title-lock {
  font-size: 11px;
}
.vibeshub-viewer .topbar-title-sep {
  color: var(--text-faint);
}

.vibeshub-viewer .topbar-stuck-links {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 0;
  margin-right: -6px;
  opacity: 0;
  visibility: hidden;
  overflow: hidden;
  white-space: nowrap;
  transition:
    max-width 220ms ease,
    margin-right 220ms ease,
    opacity 160ms ease,
    visibility 0s linear 220ms;
}
.vibeshub-viewer .viewer-header.is-stuck .topbar-stuck-links {
  max-width: 320px;
  margin-right: 0;
  opacity: 1;
  visibility: visible;
  transition:
    max-width 220ms ease,
    margin-right 220ms ease,
    opacity 160ms ease,
    visibility 0s linear 0s;
}
.vibeshub-viewer .topbar-stuck-link {
  font-size: 13px;
  color: var(--text-muted);
  text-decoration: none;
  white-space: nowrap;
}
.vibeshub-viewer .topbar-stuck-link:hover {
  color: var(--accent-strong);
}

@media (prefers-reduced-motion: reduce) {
  .vibeshub-viewer .topbar-title,
  .vibeshub-viewer .topbar-stuck-links {
    transition: none;
  }
}
```

- [ ] **Step 4: Type-check and run the full test suite**

Run: `cd webapp/frontend && npx tsc -b && npx vitest run`
Expected: `tsc` produces no errors; all Vitest tests PASS.

- [ ] **Step 5: Manual verification in the browser**

Run: `cd webapp/frontend && npm run dev`

Open a trace page (e.g. `/<owner>/<repo>/pull/<n>/<shortId>`) and confirm:
- At the top of the page: two bars, unchanged from before.
- Scrolling down: the bottom bar smoothly collapses; the compact title appears at the far left of the top bar, followed by `·` and the breadcrumb; `View on GitHub` / `Raw JSONL` fade into the top bar's action cluster next to Share + theme.
- Scrolling back to the top: the two-bar layout smoothly returns.
- A long PR title in the compact bar truncates with an ellipsis instead of pushing the breadcrumb off-screen.
- With OS "reduce motion" enabled, the change is instant (no animation).

Stop the dev server when done.

- [ ] **Step 6: Commit**

```bash
cd webapp/frontend
git add src/components/TraceHeader.tsx src/components/TraceHeader.module.css src/styles/viewer.css
git commit -m "$(cat <<'EOF'
Collapse the trace viewer bars into one when scrolled

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Notes / Out of Scope

- Narrow-screen horizontal overflow of the breadcrumb is a pre-existing condition of `.topbar-inner` and is unchanged by this work. The compact title is bounded by `max-width` + ellipsis so it does not make it worse.
- This feature is purely scroll-driven and unrelated to the (reverted) Compact mode toggle.
