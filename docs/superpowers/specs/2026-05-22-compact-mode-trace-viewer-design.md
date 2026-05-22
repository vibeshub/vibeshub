# Compact mode for the trace viewer

**Date:** 2026-05-22
**Status:** Approved

## Problem

Traces are still tough to read. The thread renders with generous spacing —
28px+ margins around user-prompt cards, 56px-tall turn separators, 1.7
line-height assistant text, and per-card margins on every tool call. A
moderately long session becomes a lot of scrolling, and the *shape* of a turn
(which tools ran, in what order) is hard to see at a glance because the
collapsed tool rows are spread far apart.

## Goal

Add a **Compact** mode that tightens the trace's navigation skeleton: less
vertical whitespace, and denser collapsed tool rows so the structure of a turn
scans quickly. It does not change font sizes, and it does not collapse or hide
any content (thinking blocks, system events stay as-is).

## Behavior

A second pill toggle labeled **"Compact"** sits next to "Show system events"
in `ThreadControls`. Default **off**. State lives in `useState` only — not
persisted across page loads, matching how `showSystemEvents` works today.

When on, the trace tightens:

- **Vertical whitespace** — turn separators, user-prompt cards, assistant
  text, thinking blocks, tool-card margins, and the PR card all get smaller
  margins / padding.
- **Scan-ability** — collapsed tool-head rows get shorter vertical padding so
  tool calls stack into a tight, readable column.

Expanded tool bodies — diffs, bash output, code blocks, JSON — keep their
current padding. Compactness applies to the skeleton you navigate, not to
content you have deliberately opened.

## Design

### 1. Toggle state — `TraceViewer.tsx`

`TraceViewer` already owns `showSystemEvents` via `useState`. Add a parallel
`const [compact, setCompact] = useState(false)`.

The `compact` flag is applied as a class on the existing viewer root:

```
<div className={"vibeshub-viewer" + (compact ? " compact" : "")}>
```

No prop needs to thread into `Thread`, `ToolCard`, or any leaf component —
the change is purely a styling variant of the same DOM.

### 2. Selector — `ThreadControls.tsx`

`ThreadControls` gains two more props, `compact` and `setCompact`, and renders
a second `<Toggle>` after the existing one:

```
<Toggle on={compact} onClick={() => setCompact(!compact)} label="Compact" />
```

The existing `Toggle` component is reused unchanged. `TraceViewer` passes the
new props through alongside the system-events pair.

### 3. Compact overrides — `viewer.css`

A new block of rules scoped under `.vibeshub-viewer.compact`. Indicative
targets and values (final values tuned during implementation):

| Element                  | Default              | Compact            |
|--------------------------|----------------------|--------------------|
| `.turn-sep`              | height 56, margin 8  | height ~28, margin ~4 |
| `.user-prompt`           | margin 28/8, pad 18/20 | margin ~14/6, pad ~12/14 |
| `.assistant-text`        | margin 8             | margin ~3          |
| `.assistant-text-body`   | line-height 1.7      | line-height ~1.55  |
| `.tool-card`             | margin 6             | margin ~2          |
| `.tool-head`             | padding 10/14        | padding ~5/12      |
| `.thinking-block`        | margin 4/8           | margin ~2/4        |
| `.pr-card`               | margin-top 36        | margin-top ~16     |
| `.thread`                | margin 56 auto 120   | margin ~28 auto ~80 |

Font sizes are **not** changed. Expanded `.tool-body` and its children are
**not** changed.

## Testing

- `TraceView.test.tsx` — the Compact toggle renders next to "Show system
  events"; clicking it adds/removes the `compact` class on the viewer root.
- Manual — toggle Compact on a real trace and confirm the thread tightens,
  collapsed tool rows stack densely, and expanded tool bodies are unaffected.

## Out of scope (YAGNI)

- **No persistence** (localStorage / URL param) — matches `showSystemEvents`.
- **No font-size change** — the complaint was whitespace and scan-ability,
  not text size.
- **No collapsing or hiding of content** — thinking blocks and system events
  render the same; Compact only adjusts spacing.
- **No change to expanded tool bodies** — diffs, bash output, code blocks keep
  their padding.
