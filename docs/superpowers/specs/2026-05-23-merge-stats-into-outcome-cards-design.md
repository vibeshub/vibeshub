# Merge stats bar into outcome cards

## Problem

The trace view currently has two stacked horizontal bands above the timeline:

1. **Stats bar** (`MetaStrip` in `webapp/frontend/src/components/trace/Hero.tsx`): a
   4-cell strip — Duration, Turns, Tool Calls, Tokens.
2. **Outcomes grid** (`Outcome` in `webapp/frontend/src/components/trace/Outcome.tsx`):
   a 2-card grid — Result | Files Touched.

These two bands compete for the same "session-at-a-glance" slot and visually crowd
the top of the trace. We want to merge them so each session-level stat lives next
to the outcome content it relates to, and the standalone stats bar goes away.

## Design

Replace the 2-card outcome grid with a **3-card grid**. Each card carries the
existing outcome content plus a stat row that uses the same big-number
typography as the current stats bar.

### Cards

1. **Result**
   - Stat row at top (two cells): `DURATION` (big value + `wall: <wall>` sub) and
     `TURNS` (big value + `<N> replies` sub).
   - Hairline divider.
   - Existing content unchanged: status pill (Linked PR / Standalone session),
     summary block with show-more toggle, PR link footer.

2. **Files Touched**
   - Stat row at top (one cell): `TOOL CALLS` (big value + `<N> distinct tools` sub).
   - Hairline divider.
   - Existing content unchanged: `Files touched · N` subheading + file list +
     show-more toggle. The `· N` count stays on the subheading (option **a** of
     the heading question — promoting Files to a stat was rejected).

3. **Tokens** (new card)
   - Stat row only — no body. One cell: `TOKENS` (big value + `<out> out · <cache> cache` sub).
   - Visually parallel to the other two cards' stat rows so the grid reads as
     symmetric.

### Layout

- `outcome-grid` becomes a 3-column grid. Suggested template:
  `1.1fr 1.4fr 0.9fr` — keeps Files Touched the widest column (it has the longest
  content), gives Result a bit more room than Tokens. Final ratio gets tuned by
  eye when wiring it up.
- Mobile collapse breakpoint (`max-width: 720px`) stays — falls to a single
  column. The current `meta-strip` already collapses; the new layout inherits the
  same behavior since it's the same grid.

### Code shape

- `Hero.tsx`: delete the `MetaStrip` component and the `<MetaStrip />` call site
  on line 208. Stats are now derived inside `Outcome`.
- `Outcome.tsx`: render the per-card stat rows inline. The stat-row markup is
  small (label / value / sub-label, mono typography) and stays local to this
  file — no separate component file. Add the third `<section className="outcome-card">`
  for Tokens.
- `viewer.css`:
  - Update `.outcome-grid` to a 3-column template.
  - Add `.outcome-stats` (the in-card stat row container) and `.outcome-stat`
    (one stat cell). Reuses the existing `.meta-label` / `.meta-value` /
    `.meta-sub` typography rules — those classes get applied inside the cards.
  - Add a hairline divider style for the boundary between the stat row and the
    card body.
  - Delete `.meta-strip` (the standalone bar styling). Keep `.meta-wrap` — it's
    still used by `MetaLine`, which renders below the outcome grid.
    `.meta-cell` / `.meta-label` / `.meta-value` / `.meta-sub` are kept (now
    used inside outcome cards instead of in the standalone strip).

### Render order in `Hero`

The current order is:

```
<HeroEyebrow />, <h1>, <HeroBadges />
<MetaStrip />
<Outcome />
<MetaLine />
<ToolsChips />
<Timeline />
```

After the change:

```
<HeroEyebrow />, <h1>, <HeroBadges />
<Outcome />        # now carries the stats internally
<MetaLine />
<ToolsChips />
<Timeline />
```

`<Outcome>` already receives `session` and `trace`, so no prop changes needed.

## Non-goals

- No new data, no new derivations — every stat already exists in
  `session.meta`. This is purely visual reorganization.
- No change to the show-more behavior on the summary or files list.
- No change to the responsive breakpoint behavior beyond what the new grid
  inherits.
- No tabbed UI inside cards (clarified — the third "card" is a peer card,
  not a tab inside an existing card).

## Verification

Manually load a trace in the viewer and confirm:

- Three cards render in a row at desktop widths, falling to a single column on
  mobile.
- Each card's stat row uses the same big-number typography as today's stats
  bar (no visual regression in the number styling itself — just its location).
- The standalone stats band is gone; there's no double-counting (e.g. file
  count "5" appears only on the Files Touched heading, not promoted to a stat).
- Show-more / Show-less toggles on the summary and files list still behave
  as before.
