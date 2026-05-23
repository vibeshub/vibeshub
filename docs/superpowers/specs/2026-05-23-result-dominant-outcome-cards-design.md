# Result-dominant outcome cards

## Problem

The merged outcome cards (three equal columns: Result | Files Touched | Tokens)
have visible balance problems:

1. **Tokens card body is empty.** It only carries a stat row; everything below
   the divider is whitespace. Reads as a vestigial column.
2. **Files Touched stat header has a gap.** The Tool Calls stat occupies one cell
   in a row sized for two, so the right half of the header is empty.
3. **Result card is cramped.** It has the most content (status pill, multi-line
   summary, PR link footer) but lives in the narrowest of the three columns,
   forcing the summary into a tall narrow block.

The grid is symmetric but the content isn't. The result is visually unbalanced.

## Design

Switch to a **result-dominant asymmetric layout**: Result becomes a hero card
that spans the full height of the right column, while Files Touched and Tokens
stack vertically next to it.

### Layout

`outcome-grid` becomes a 2-column grid:

- Column 1: Result (dominant). `~1.5fr`.
- Column 2: a vertical stack of Files Touched (top) and Tokens (bottom).
  Internally a 2-row grid with a 12px gap. `~1fr`.

Result naturally fills the height of the right column because the grid rows
align — its summary block (`flex: 1`) absorbs the extra vertical room and stops
feeling cramped.

The existing mobile breakpoint (`max-width: 720px`) collapses everything to a
single column in source order: Result → Files Touched → Tokens.

### Cards

1. **Result** (column 1, full height)
   - Unchanged content: Duration + Turns stat row, status pill, summary block
     with show-more toggle, PR link footer.
   - Lives in a wider column, so the summary wraps comfortably.

2. **Files Touched** (column 2, top row)
   - Unchanged content: Tool Calls stat row, `Files touched · N` subheading,
     file list with show-more toggle.
   - The single-cell stat row no longer reads as "incomplete header" because
     the narrower column makes a single stat the natural width.

3. **Tokens** (column 2, bottom row) — gets a real body
   - Stat row unchanged: `TOKENS` big value + `<out> out · <cache> cache` sub.
   - Below the divider, a new visualization:
     - A thin horizontal **stacked bar** (~6px tall, rounded ends) split into
       four proportional segments: cache read, input, cache create, output.
     - Segments use existing tool color tokens so the bar harmonizes with the
       timeline palette (e.g. `--tool-read`, `--tool-bash`, `--tool-write`,
       `--accent-strong`).
     - Proportions are computed from
       `meta.tokens.{cacheRead, input, cacheCreate, output}`. Each segment is
       clamped to a minimum visible width (≈2%) so tiny segments still appear
       as a sliver rather than disappearing — cache read commonly dominates by
       50–100× and would otherwise erase the other segments visually.
     - Below the bar, a compact 2×2 **legend grid**: each cell shows a colored
       dot, a label, and the formatted token count for that category. Legend
       order matches the bar (cache read, input, cache create, output) so a
       color always maps to a stable position regardless of the trace's mix.

### Code shape

- `Outcome.tsx`:
  - No prop changes, no new data fetches — every value already exists in
    `session.meta`.
  - Tokens card gains a small local subcomponent (or inline JSX) that renders
    the stacked bar and legend. Keep it local to `Outcome.tsx`; it's small.
- `Hero.tsx`: untouched. Render order is unchanged.
- `viewer.css`:
  - `.outcome-grid` becomes a 2-column template (`1.5fr 1fr`).
  - New rule for the right-column wrapper (e.g. `.outcome-side`) that stacks
    Files Touched and Tokens with a 12px gap.
  - New classes for the token bar / legend:
    - `.outcome-token-bar` — flex container, rounded, fixed height.
    - `.outcome-token-seg` — individual colored segments.
    - `.outcome-token-legend` — 2×2 grid.
    - `.outcome-token-legend-item` — dot + label + value cell.
  - Existing `.outcome-card`, `.outcome-stats`, etc. unchanged.
  - Mobile breakpoint (`max-width: 720px`) flattens both the outer grid and
    the right-column stack to a single column.

### Color mapping for token bar

Cache read tends to dominate; the visually dominant color should not clash with
status pills. Suggested mapping (final values tuned by eye):

| Segment      | Color token       | Rationale                                |
|--------------|-------------------|------------------------------------------|
| Cache read   | `--tool-read`     | "Read" semantics, usually the largest.   |
| Input        | `--tool-bash`     | A solid mid-tone for the second-largest. |
| Cache create | `--tool-write`    | Cache writes ≈ create semantics.         |
| Output       | `--accent-strong` | The "result" of the call — sharpest hue. |

## Non-goals

- No new data, no new derivations. Every stat already exists in `session.meta`.
- No change to the Result card content or PR linking behavior.
- No change to Files Touched behavior (file derivation, show-more toggle).
- No change to mobile breakpoint behavior beyond what the new grid inherits.
- No change to `Hero.tsx` render order or component structure.

## Verification

Manually load a trace in the viewer and confirm:

- At desktop widths, the Result card spans the height of the right column;
  Files Touched and Tokens stack vertically to its right.
- The Result card's summary text wraps with comfortable line lengths — no
  longer feels cramped.
- The Files Touched header reads as a single full-width stat (no obvious gap
  on the right).
- The Tokens card now has a visible body: a thin stacked bar plus a 2×2
  legend with dot + label + count.
- On a trace with extreme token skew (cache read ≫ others), the smaller
  segments are still visible as slivers rather than disappearing.
- At `< 720px` width, the layout collapses to a single column in the order
  Result → Files Touched → Tokens.
- Show-more / Show-less toggles on the summary and files list still behave
  as before.
