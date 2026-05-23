# Merge stats bar into outcome cards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the standalone session stats bar (`MetaStrip`) with stat cells embedded inside the outcome cards. Result and Files Touched gain a top stat row; a new third "Tokens" card joins the row.

**Architecture:** Pure frontend refactor. No new data sources — all stats already exist on `session.meta`. The `Outcome` component takes ownership of rendering the stat row markup using the existing `.meta-cell` typography. `MetaStrip` is deleted. `outcome-grid` becomes a 3-column grid.

**Tech Stack:** React + TypeScript + Vite. Plain CSS (no styled-components). Vitest + @testing-library/react for tests.

**Spec:** `docs/superpowers/specs/2026-05-23-merge-stats-into-outcome-cards-design.md`

---

## File Structure

- **Modify** `webapp/frontend/src/components/trace/Outcome.tsx` — add stat row inside Result + Files Touched cards; add new Tokens card; import format helpers and types needed for the stats.
- **Modify** `webapp/frontend/src/components/trace/Hero.tsx` — delete the `MetaStrip` component definition and its `<MetaStrip />` call site.
- **Modify** `webapp/frontend/src/styles/viewer.css` — `.outcome-grid` → 3 columns; add `.outcome-stats` + `.outcome-stat` + `.outcome-divider` styles; delete `.meta-strip` rule. Keep `.meta-cell` / `.meta-label` / `.meta-value` / `.meta-sub` rules (now used inside cards).
- **Modify** `webapp/frontend/src/tests/routes/TraceView.test.tsx` — add a structural test asserting the new 3-card layout and absence of the standalone stats bar.

---

## Task 1: Add structural test for the merged-outcome layout

**Files:**
- Modify: `webapp/frontend/src/tests/routes/TraceView.test.tsx`

Adds one test that locks in the new structure: 3 `.outcome-card` elements render, no `.meta-strip` element exists, and a known stat label (e.g. `TOKENS`) appears inside one of the outcome cards. Test fails on current code (2 cards + meta-strip present), passes after Tasks 2–4.

- [ ] **Step 1: Add the failing test**

Append a new `it(...)` block inside the `describe("TraceView", ...)` block in `webapp/frontend/src/tests/routes/TraceView.test.tsx`, right after the last existing `it(...)` block (around line 463). Use the same `mockFetchSequence` + `renderAt` pattern as the other tests:

```tsx
  it("renders three outcome cards (Result, Files Touched, Tokens) and no standalone stats bar", async () => {
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

    await waitFor(() =>
      expect(screen.queryByText(/Loading trace/i)).not.toBeInTheDocument(),
    );

    // Three outcome cards now — Result, Files Touched, Tokens.
    expect(container.querySelectorAll(".outcome-card")).toHaveLength(3);

    // Standalone stats strip is gone.
    expect(container.querySelector(".meta-strip")).toBeNull();

    // The stats moved into the outcome cards — each label appears inside one.
    const cards = Array.from(container.querySelectorAll(".outcome-card"));
    const cardText = cards.map((c) => c.textContent ?? "").join(" | ");
    expect(cardText).toMatch(/DURATION/i);
    expect(cardText).toMatch(/TURNS/i);
    expect(cardText).toMatch(/TOOL CALLS/i);
    expect(cardText).toMatch(/TOKENS/i);
  });
```

- [ ] **Step 2: Run the test and confirm it fails**

Run from the repo root:

```bash
cd webapp/frontend && npx vitest run src/tests/routes/TraceView.test.tsx -t "renders three outcome cards"
```

Expected: FAIL. The two structural assertions should fail because today's tree has 2 `.outcome-card` nodes and one `.meta-strip` node. The label-text assertions may already pass (the labels exist today inside `.meta-strip`); that's fine — we want the structural assertions to be the ones that flip green after Tasks 2–4.

- [ ] **Step 3: Do NOT commit yet**

The test is failing on purpose. Commit happens at the end of Task 4 once the implementation lands and the test passes. Keep the test file dirty in the working tree.

---

## Task 2: Move stats into `Outcome.tsx` and add the Tokens card

**Files:**
- Modify: `webapp/frontend/src/components/trace/Outcome.tsx`

Adds in-card stat rows (Result: Duration + Turns; Files Touched: Tool calls) and a new third Tokens card. No CSS yet — that's Task 4.

- [ ] **Step 1: Update the `Outcome.tsx` imports**

At the top of `webapp/frontend/src/components/trace/Outcome.tsx`, replace the current `format` import line:

```ts
import { shortenPath } from "./format";
```

with:

```ts
import {
  fmtDuration,
  fmtDurationCompact,
  fmtTokens,
  shortenPath,
} from "./format";
```

- [ ] **Step 2: Add a small `StatCell` helper inside `Outcome.tsx`**

Add this above the `Outcome` function (after the `lastAssistantText` helper, before `const FILES_COLLAPSED = 6;`):

```tsx
function StatCell({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="meta-cell outcome-stat">
      <div className="meta-label">{label}</div>
      <div className="meta-value">{value}</div>
      {sub && <div className="meta-sub">{sub}</div>}
    </div>
  );
}
```

Reuses the existing `.meta-label` / `.meta-value` / `.meta-sub` typography rules; the extra `outcome-stat` class is for in-card-specific styling (padding / borders) added in Task 4.

- [ ] **Step 3: Compute stat values at the top of `Outcome`**

Inside the `Outcome` function, just after the existing `const { meta, stream } = session;` line, add the derived stat values:

```tsx
  const start = meta.startedAt ? Date.parse(meta.startedAt) : 0;
  const end = meta.endedAt ? Date.parse(meta.endedAt) : 0;
  const wall = Math.max(0, end - start);
  const tokensTotal =
    meta.tokens.input + meta.tokens.cacheCreate + meta.tokens.output;
  const distinctToolCount = Object.keys(meta.toolCounts).length;
```

These mirror the calculations that currently live inside `MetaStrip` in `Hero.tsx` (which we delete in Task 3).

- [ ] **Step 4: Add the stat row to the Result card**

In the JSX return, locate the Result card opening (the line `<section className="outcome-card">` followed by `<h4>Result</h4>`). Replace just the `<h4>Result</h4>` line with:

```tsx
        <div className="outcome-stats">
          <StatCell
            label="Duration"
            value={fmtDurationCompact(meta.assistantThinkMs)}
            sub={`wall: ${fmtDuration(wall)}`}
          />
          <StatCell
            label="Turns"
            value={meta.userPromptCount}
            sub={`${meta.assistantTextCount} replies`}
          />
        </div>
        <div className="outcome-divider" />
        <h4>Result</h4>
```

The rest of the Result card (status pill, summary block, PR link) stays exactly as-is.

- [ ] **Step 5: Add the stat row to the Files Touched card**

Locate the Files Touched card opening — currently:

```tsx
      <section className="outcome-card">
        <h4>
          Files touched · {files.length}
          {subLoading && (
            <span className="outcome-loading"> · loading subagents…</span>
          )}
        </h4>
```

Replace just the opening `<h4>` block (everything from `<h4>` through `</h4>`) with:

```tsx
        <div className="outcome-stats">
          <StatCell
            label="Tool calls"
            value={meta.toolCallCount}
            sub={`${distinctToolCount} distinct tools`}
          />
        </div>
        <div className="outcome-divider" />
        <h4>
          Files touched · {files.length}
          {subLoading && (
            <span className="outcome-loading"> · loading subagents…</span>
          )}
        </h4>
```

The rest of the Files Touched card (empty state + `<ul>` file list + show-more button) stays as-is.

- [ ] **Step 6: Add the new Tokens card**

At the very end of the JSX return, just before the closing `</div>` of `outcome-grid`, append a third `<section className="outcome-card">` block:

```tsx
      <section className="outcome-card">
        <div className="outcome-stats">
          <StatCell
            label="Tokens"
            value={fmtTokens(tokensTotal + meta.tokens.cacheRead)}
            sub={`${fmtTokens(meta.tokens.output)} out · ${fmtTokens(meta.tokens.cacheRead)} cache`}
          />
        </div>
      </section>
```

This card has no body content beyond the stat row — visually parallel to the other two cards' stat rows.

- [ ] **Step 7: Type-check the file**

Run:

```bash
cd webapp/frontend && npx tsc --noEmit
```

Expected: PASS. Fix any type errors (most likely an unused import if the format helpers don't all get used, or a missing field on `meta.tokens` — check `webapp/frontend/src/components/trace/types.ts` if needed).

---

## Task 3: Delete `MetaStrip` from `Hero.tsx`

**Files:**
- Modify: `webapp/frontend/src/components/trace/Hero.tsx`

Remove the now-redundant component definition and its render site.

- [ ] **Step 1: Delete the `MetaStrip` function**

In `webapp/frontend/src/components/trace/Hero.tsx`, delete the entire `MetaStrip` function block — lines 104–146 in the current file:

```tsx
function MetaStrip({ session }: { session: Session }) {
  const meta = session.meta;
  const start = meta.startedAt ? Date.parse(meta.startedAt) : 0;
  const end = meta.endedAt ? Date.parse(meta.endedAt) : 0;
  const wall = Math.max(0, end - start);
  const tokensTotal =
    meta.tokens.input + meta.tokens.cacheCreate + meta.tokens.output;
  return (
    <div className="meta-wrap">
      <div className="meta-strip">
        ...
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Delete the `<MetaStrip />` render**

In the `Hero` component's JSX (around line 208), delete this line:

```tsx
      <MetaStrip session={session} />
```

The surrounding context becomes:

```tsx
      <div className="hero">
        <HeroEyebrow session={session} trace={trace} rawHref={rawHref} />
        <h1 className="hero-title">{meta.aiTitle || "Untitled session"}</h1>
        <HeroBadges trace={trace} />
      </div>
      <Outcome session={session} trace={trace} />
      <MetaLine session={session} />
      <ToolsChips session={session} />
      <Timeline session={session} />
```

- [ ] **Step 3: Remove unused imports**

After the deletions, check the import block at the top of `Hero.tsx`. Specifically:

- `fmtDuration`, `fmtDurationCompact`, `fmtTokens` were imported only for `MetaStrip` — remove them from the `import { ... } from "./format";` line. Leave any other helpers (e.g. ones used by other components in the file).

Run:

```bash
cd webapp/frontend && npx tsc --noEmit
```

Expected: PASS. If TypeScript complains about an unused import, drop it.

---

## Task 4: Update CSS and verify

**Files:**
- Modify: `webapp/frontend/src/styles/viewer.css`

Switch the grid to 3 columns, add in-card stat styles, drop the obsolete `.meta-strip` rule.

- [ ] **Step 1: Update `.outcome-grid` to 3 columns**

In `webapp/frontend/src/styles/viewer.css`, find the `.vibeshub-viewer .outcome-grid` rule (around line 485) and change `grid-template-columns`:

```css
.vibeshub-viewer .outcome-grid {
  max-width: var(--header-width);
  margin: 16px auto 0;
  padding: 0 32px;
  display: grid;
  grid-template-columns: 1.1fr 1.4fr 0.9fr;
  gap: 12px;
}
```

(Only the `grid-template-columns` line changes — from `1fr 1.4fr` to `1.1fr 1.4fr 0.9fr`.)

The mobile collapse rule beneath it (`@media (max-width: 720px) { .vibeshub-viewer .outcome-grid { grid-template-columns: 1fr; } }`) stays unchanged — it already collapses to a single column regardless of how many cards are in the row.

- [ ] **Step 2: Tighten the spacing between the outcome grid and the hero**

Find the `.vibeshub-viewer .outcome-grid` rule again. The `margin: 16px auto 0;` line currently relies on the `MetaStrip`'s `.meta-wrap` (with `margin: 28px auto 0`) to give the outcome grid its breathing room below the hero. With `MetaStrip` gone, change the outcome grid's top margin so it has the same breathing room directly:

```css
.vibeshub-viewer .outcome-grid {
  max-width: var(--header-width);
  margin: 28px auto 0;
  padding: 0 32px;
  display: grid;
  grid-template-columns: 1.1fr 1.4fr 0.9fr;
  gap: 12px;
}
```

(Top margin goes from `16px` to `28px`.)

- [ ] **Step 3: Add in-card stat styles**

Add these rules immediately after the `.outcome-card` rule (currently around line 498–506), before the `.outcome-loading` rule:

```css
.vibeshub-viewer .outcome-stats {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 16px;
  margin: -16px -18px 0;
  padding: 14px 18px 12px;
  border-bottom: 1px solid var(--border-subtle);
}
.vibeshub-viewer .outcome-stat {
  background: none;
  padding: 0;
  gap: 4px;
}
.vibeshub-viewer .outcome-divider {
  display: none;
}
```

Notes for the engineer:

- `.outcome-stats` lives inside an `.outcome-card` whose padding is `16px 18px`. Negative margin pulls the stat row flush with the card edges so the bottom border reads as a true card divider, and we re-apply the same horizontal padding inside.
- `.outcome-stat` neutralizes `.meta-cell`'s strip-only padding/background while keeping the typography rules from `.meta-label` / `.meta-value` / `.meta-sub` (those classes are still applied by `StatCell`).
- We deliberately render `<div className="outcome-divider" />` in JSX but hide it via CSS — the visual divider is supplied by `.outcome-stats` `border-bottom`. The empty div is kept in the JSX as a structural marker so future styling tweaks (e.g. doubling up the divider) have a hook.

- [ ] **Step 4: Delete the `.meta-strip` rule**

Find this block (around line 701–712):

```css
.vibeshub-viewer .meta-strip {
  max-width: var(--header-width);
  margin: 0 auto;
  padding: 4px 32px 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  background: var(--border-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  overflow: hidden;
}
```

Delete it entirely. Leave the `.meta-cell` / `.meta-label` / `.meta-value` / `.meta-sub` rules below it in place — `StatCell` uses those.

Also leave the `.meta-wrap` rule in place — `MetaLine` (which renders below the outcome grid) still wraps itself in `.meta-wrap`.

- [ ] **Step 5: Run the failing test from Task 1**

```bash
cd webapp/frontend && npx vitest run src/tests/routes/TraceView.test.tsx -t "renders three outcome cards"
```

Expected: PASS. Three `.outcome-card` elements, no `.meta-strip`, all four stat labels present in the cards.

- [ ] **Step 6: Run the full TraceView test file**

```bash
cd webapp/frontend && npx vitest run src/tests/routes/TraceView.test.tsx
```

Expected: ALL PASS. No regression in the existing 12 tests.

- [ ] **Step 7: Type-check the whole frontend**

```bash
cd webapp/frontend && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 8: Manual browser verification**

Start the dev server and load a real trace:

```bash
cd webapp/frontend && npm run dev
```

Open the printed URL, navigate to any trace page (e.g. one from `/`), and confirm visually:

1. Three cards render in a row at desktop width: Result, Files Touched, Tokens.
2. Each card's top section shows the big-number stat(s) with the same typography as the old stats bar.
3. The hairline divider sits between the stat row and the card body (Result and Files Touched). The Tokens card has only the stat row, no divider line, no empty space below.
4. The standalone stats band above the cards is gone.
5. The PR link / file list / show-more toggles all still work.
6. Shrink the window below 720px — the three cards stack into a single column.

If anything looks off (overlapping padding, divider missing, etc.), revisit Task 4 Step 3 — the negative-margin trick on `.outcome-stats` is the most likely culprit.

- [ ] **Step 9: Commit**

Stage only the four files this plan touches — do NOT use `git add -A` (the working tree has an unrelated `vite.config.ts` modification from before this task started):

```bash
git add \
  webapp/frontend/src/components/trace/Outcome.tsx \
  webapp/frontend/src/components/trace/Hero.tsx \
  webapp/frontend/src/styles/viewer.css \
  webapp/frontend/src/tests/routes/TraceView.test.tsx

git commit -m "$(cat <<'EOF'
Merge stats bar into outcome cards

Fold Duration + Turns into the Result card and Tool calls into the
Files Touched card. Add a third "Tokens" card alongside them. The
standalone four-cell stats strip above the cards is gone — the grid
above the timeline is now three peer outcome cards instead of a
stats band + a two-card outcome row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes

- **Spec coverage:** Spec calls for (a) Result gets Duration + Turns — Task 2 Step 4; (b) Files Touched gets Tool Calls — Task 2 Step 5; (c) new Tokens card — Task 2 Step 6; (d) 3-column grid — Task 4 Step 1; (e) MetaStrip deletion — Task 3; (f) `.meta-strip` CSS deletion — Task 4 Step 4; (g) mobile single-column collapse — preserved by leaving the existing media query in place (Task 4 Step 1 note). All covered.
- **Type consistency:** `StatCell` is the only new type surface; its props are used consistently across all six call sites (Result × 2 + Files Touched × 1 + Tokens × 1; the `sub` prop is optional and supplied in every call). The `fmtTokens` / `fmtDuration` / `fmtDurationCompact` calls reuse the exact signatures previously used inside `MetaStrip`.
- **Placeholder scan:** No TBDs, no "similar to above", every code block is complete.
