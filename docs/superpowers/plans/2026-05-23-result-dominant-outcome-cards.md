# Result-dominant outcome cards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebalance the merged outcome cards into an asymmetric layout where Result is the hero card and Files Touched + Tokens stack to its right. Give the Tokens card a real body (proportional stacked bar + legend) so it stops reading as empty.

**Architecture:** Pure presentational change inside `webapp/frontend/src/components/trace/Outcome.tsx` and `webapp/frontend/src/styles/viewer.css`. The right-hand cards get wrapped in a new `.outcome-side` container that the outer grid lays out as a single column; that container is itself a 2-row grid stacking Files Touched and Tokens. A new local `TokenBar` subcomponent in `Outcome.tsx` derives proportions from `session.meta.tokens` and renders four colored segments plus a 2×2 legend. No new data, no new props, no `Hero.tsx` changes.

**Tech Stack:** React 18 (TSX), CSS variables in `viewer.css`, Vitest + React Testing Library for the existing trace-view test.

---

## File Structure

- Modify: `webapp/frontend/src/components/trace/Outcome.tsx` — wrap the two right-hand `<section>`s in `<div className="outcome-side">`, add a local `TokenBar` component, render it inside the Tokens card.
- Modify: `webapp/frontend/src/styles/viewer.css` — change `.outcome-grid` to two columns (`1.5fr 1fr`), add `.outcome-side` rules, add token-bar / legend styles, update the mobile collapse rule to flatten the side stack too.
- Modify: `webapp/frontend/src/tests/routes/TraceView.test.tsx` — extend the existing outcome-cards test to assert four token-bar segments and four legend items inside the Tokens card.

No new files. The plan keeps everything co-located with the existing component / stylesheet.

---

### Task 1: Extend the existing trace-view test to cover the Tokens body

**Files:**
- Modify: `webapp/frontend/src/tests/routes/TraceView.test.tsx:470-506`

- [ ] **Step 1: Add failing assertions to the existing outcome-cards test**

Open `webapp/frontend/src/tests/routes/TraceView.test.tsx` and find the test starting at line 470 (`it("renders three outcome cards...`). Replace its body's final block (the cards extraction at lines 500-505) with the version below. The change keeps every existing assertion and adds three new ones for the token bar/legend and the side wrapper.

```tsx
    // Each stat label appears in the specific card it belongs to. Catches a
    // regression where the labels are present but land in the wrong card.
    const cards = Array.from(container.querySelectorAll(".outcome-card"));
    const [resultCard, filesCard, tokensCard] = cards;
    expect(resultCard.textContent).toMatch(/Duration/i);
    expect(resultCard.textContent).toMatch(/Turns/i);
    expect(filesCard.textContent).toMatch(/Tool calls/i);
    expect(tokensCard.textContent).toMatch(/Tokens/i);

    // Files Touched and Tokens live inside the side-stack wrapper so the
    // grid lays out as Result | (Files / Tokens).
    const side = container.querySelector(".outcome-side");
    expect(side).not.toBeNull();
    expect(side!.contains(filesCard)).toBe(true);
    expect(side!.contains(tokensCard)).toBe(true);

    // Tokens card now carries a four-segment bar and a four-item legend.
    expect(
      tokensCard.querySelectorAll(".outcome-token-seg"),
    ).toHaveLength(4);
    expect(
      tokensCard.querySelectorAll(".outcome-token-legend-item"),
    ).toHaveLength(4);
```

- [ ] **Step 2: Run the test and confirm it fails for the right reason**

Run: `cd webapp/frontend && npx vitest run src/tests/routes/TraceView.test.tsx -t "renders three outcome cards"`

Expected: FAIL. The error should mention either `.outcome-side` returning `null` or `.outcome-token-seg` returning a NodeList of length 0 (depending on which assertion fires first). If the test fails for a different reason, stop and investigate before continuing.

- [ ] **Step 3: Commit the failing test**

```bash
git add webapp/frontend/src/tests/routes/TraceView.test.tsx
git commit -m "Test: assert side wrapper + token bar in outcome cards"
```

---

### Task 2: Add the TokenBar subcomponent and render it in the Tokens card

**Files:**
- Modify: `webapp/frontend/src/components/trace/Outcome.tsx`

- [ ] **Step 1: Add the TokenBar component above the `Outcome` function**

Insert this block immediately above the `export function Outcome(...)` line (currently line 139). It defines a local subcomponent that takes the four token counts, computes their proportions, clamps tiny slices to a minimum visible width, and renders the bar + 2×2 legend.

```tsx
const TOKEN_SEGMENTS = [
  { key: "cacheRead", label: "Cache read", color: "var(--tool-read)" },
  { key: "input", label: "Input", color: "var(--tool-bash)" },
  { key: "cacheCreate", label: "Cache create", color: "var(--tool-write)" },
  { key: "output", label: "Output", color: "var(--accent-strong)" },
] as const;

// Cache reads can dominate by 50-100x, which would otherwise erase the other
// segments. Floor each non-zero segment to MIN_SEG_PCT so it still reads as a
// sliver, then normalize so the row totals 100%.
const MIN_SEG_PCT = 2;

function TokenBar({ tokens }: { tokens: TokenTotals }) {
  const total =
    tokens.cacheRead + tokens.input + tokens.cacheCreate + tokens.output;
  const raw = TOKEN_SEGMENTS.map((s) => ({
    ...s,
    value: tokens[s.key],
    pct: total > 0 ? (tokens[s.key] / total) * 100 : 0,
  }));
  const floored = raw.map((s) => ({
    ...s,
    width: s.value > 0 ? Math.max(s.pct, MIN_SEG_PCT) : 0,
  }));
  const widthSum = floored.reduce((acc, s) => acc + s.width, 0);
  const segments = floored.map((s) => ({
    ...s,
    width: widthSum > 0 ? (s.width / widthSum) * 100 : 0,
  }));
  return (
    <div className="outcome-token-body">
      <div className="outcome-token-bar" role="img" aria-label="Token mix">
        {segments.map((s) => (
          <span
            key={s.key}
            className="outcome-token-seg"
            style={{
              width: `${s.width}%`,
              background: s.color,
            }}
            title={`${s.label}: ${fmtTokens(s.value)}`}
          />
        ))}
      </div>
      <ul className="outcome-token-legend">
        {segments.map((s) => (
          <li key={s.key} className="outcome-token-legend-item">
            <span
              className="outcome-token-dot"
              style={{ background: s.color }}
            />
            <span className="outcome-token-label">{s.label}</span>
            <span className="outcome-token-value">{fmtTokens(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Import `TokenTotals` at the top of the file**

`Outcome.tsx` currently imports only `Session` and `StreamEvent` from `./types` (line 2). Update that import to also pull in `TokenTotals`:

```tsx
import type { Session, StreamEvent, TokenTotals } from "./types";
```

- [ ] **Step 3: Render `<TokenBar>` inside the Tokens card**

Find the Tokens card (currently lines 283-291, the third `<section className="outcome-card">`). Replace its body so the existing stat row stays and a `TokenBar` is rendered below it:

```tsx
      <section className="outcome-card">
        <div className="outcome-stats">
          <StatCell
            label="Tokens"
            value={fmtTokens(tokensTotal + meta.tokens.cacheRead)}
            sub={`${fmtTokens(meta.tokens.output)} out · ${fmtTokens(meta.tokens.cacheRead)} cache`}
          />
        </div>
        <TokenBar tokens={meta.tokens} />
      </section>
```

- [ ] **Step 4: Wrap Files Touched and Tokens in an `.outcome-side` div**

Still in `Outcome.tsx`, locate the Files Touched `<section>` (currently starts at line 239) and the Tokens `<section>` (which you just edited). Wrap them both in a single `<div className="outcome-side">…</div>`. The Result card stays as the first child of `.outcome-grid`; the wrapper is the second child.

The final JSX shape returned from `Outcome` should be:

```tsx
  return (
    <div className="outcome-grid">
      <section className="outcome-card">
        {/* Result card — unchanged */}
        …
      </section>

      <div className="outcome-side">
        <section className="outcome-card">
          {/* Files Touched card — unchanged */}
          …
        </section>

        <section className="outcome-card">
          {/* Tokens card with stat row + <TokenBar /> */}
          …
        </section>
      </div>
    </div>
  );
```

Do not change the contents of the Result or Files Touched cards.

- [ ] **Step 5: Commit the component changes**

The test still fails because the CSS classes referenced (`.outcome-side`, `.outcome-token-*`) have no styles yet. Commit anyway — splitting markup and styles is cleaner.

```bash
git add webapp/frontend/src/components/trace/Outcome.tsx
git commit -m "Outcome: render token bar + side stack wrapper"
```

---

### Task 3: Update viewer.css for the new layout and the token bar

**Files:**
- Modify: `webapp/frontend/src/styles/viewer.css:484-497` (grid rule + mobile breakpoint)
- Modify: `webapp/frontend/src/styles/viewer.css:701` (append token-bar styles)

- [ ] **Step 1: Change the grid template and add the side stack**

Replace the existing `.outcome-grid` block (lines 485-497) with the version below. The outer grid becomes 2 columns; a sibling `.outcome-side` rule turns the right column into a 2-row stack with the same 12px gap. Mobile collapse handles both grids.

```css
.vibeshub-viewer .outcome-grid {
  max-width: var(--header-width);
  margin: 28px auto 0;
  padding: 0 32px;
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 12px;
  align-items: stretch;
}
.vibeshub-viewer .outcome-side {
  display: grid;
  grid-template-rows: auto auto;
  gap: 12px;
  min-width: 0;
}
@media (max-width: 720px) {
  .vibeshub-viewer .outcome-grid {
    grid-template-columns: 1fr;
  }
  .vibeshub-viewer .outcome-side {
    grid-template-rows: auto auto;
  }
}
```

The `min-width: 0` on `.outcome-side` is required: without it, long file paths in the Files Touched card force the right column wider than its `1fr` share, squeezing the Result card and undoing the rebalance.

- [ ] **Step 2: Append the token-bar styles at the end of the outcome block**

Append the following rules immediately after the existing `.outcome-files-more:hover` rule (currently line 701-703). They define the bar, segments, legend grid, and legend cell layout.

```css
.vibeshub-viewer .outcome-token-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 2px;
}
.vibeshub-viewer .outcome-token-bar {
  display: flex;
  width: 100%;
  height: 6px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--bg-inset);
}
.vibeshub-viewer .outcome-token-seg {
  display: block;
  height: 100%;
}
.vibeshub-viewer .outcome-token-seg:first-child {
  border-top-left-radius: 999px;
  border-bottom-left-radius: 999px;
}
.vibeshub-viewer .outcome-token-seg:last-child {
  border-top-right-radius: 999px;
  border-bottom-right-radius: 999px;
}
.vibeshub-viewer .outcome-token-legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 12px;
}
.vibeshub-viewer .outcome-token-legend-item {
  display: grid;
  grid-template-columns: 8px 1fr auto;
  align-items: center;
  gap: 8px;
  font: 11.5px var(--font-mono);
  min-width: 0;
}
.vibeshub-viewer .outcome-token-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.vibeshub-viewer .outcome-token-label {
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 10.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vibeshub-viewer .outcome-token-value {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 3: Run the test and confirm it now passes**

Run: `cd webapp/frontend && npx vitest run src/tests/routes/TraceView.test.tsx -t "renders three outcome cards"`

Expected: PASS. All seven assertions (four pre-existing + the three added in Task 1) succeed.

- [ ] **Step 4: Run the full frontend test suite to catch regressions**

Run: `cd webapp/frontend && npm test`

Expected: PASS for every test. If anything else turns red, stop and investigate before continuing — the layout change shouldn't break anything outside the trace-view tests.

- [ ] **Step 5: Run typecheck**

Run: `cd webapp/frontend && npm run build`

Expected: succeeds (this runs `tsc -b && vite build`). The new `TokenTotals` import and component must typecheck cleanly.

- [ ] **Step 6: Commit the styles**

```bash
git add webapp/frontend/src/styles/viewer.css
git commit -m "Style: result-dominant outcome grid + token bar"
```

---

### Task 4: Visual verification in the browser

**Files:** none modified — this task only verifies.

- [ ] **Step 1: Start the dev server**

Run: `cd webapp/frontend && npm run dev`

The Vite dev server prints a URL (usually `http://localhost:5173/`). Leave it running for the rest of this task.

- [ ] **Step 2: Open a trace and confirm the desktop layout**

Navigate to any trace page (for example `/<owner>/<repo>/pull/<n>/<short_id>`). Confirm:

- The Result card is on the left and visibly wider than the right column.
- Files Touched is at the top right; Tokens is below it.
- The Result card's summary wraps with comfortable line lengths (no longer narrow).
- The Files Touched header no longer has an obvious empty space to the right of the Tool Calls stat — the narrower column makes one stat read as the natural width.
- The Tokens card has a thin colored bar and a 2×2 legend with dot / label / count.

- [ ] **Step 3: Confirm extreme-skew behavior**

Find or open a trace where `cache read` is at least 50× larger than `output` (common for long sessions). Confirm the smaller segments still appear as visible slivers in the bar — they should not disappear entirely.

- [ ] **Step 4: Confirm mobile collapse**

Resize the browser window below 720px wide (or use devtools' device-toolbar). Confirm:

- The layout collapses to a single column.
- The cards appear in source order: Result, then Files Touched, then Tokens.
- The token bar still renders correctly at narrow widths.

- [ ] **Step 5: Stop the dev server**

Stop the `npm run dev` process (Ctrl-C in its terminal).

---

## Self-review checklist (for the plan author)

- [x] Each spec requirement maps to a task: layout change → Task 3, side stack wrapper → Tasks 2+3, Tokens body → Task 2, mobile collapse → Task 3, test coverage → Task 1, browser verification → Task 4.
- [x] No placeholder language ("TODO", "TBD", "implement later"). All code blocks are complete.
- [x] Type consistency: `TokenTotals` is imported in Task 2 step 2 and used as the prop type of `TokenBar` in step 1; the segment `key` strings (`cacheRead`, `input`, `cacheCreate`, `output`) match the `TokenTotals` field names verbatim.
- [x] Class names referenced in the test (`.outcome-side`, `.outcome-token-seg`, `.outcome-token-legend-item`) match exactly what Tasks 2 and 3 introduce.
