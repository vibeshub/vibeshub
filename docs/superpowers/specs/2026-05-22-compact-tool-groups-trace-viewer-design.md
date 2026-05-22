# Compact tool groups for the trace viewer

## Problem

A moderately long trace requires a lot of scrolling. Each tool call already
renders as a single collapsed line (`ToolCard`), but a turn often contains a
*run* of consecutive tool calls — 3-6 Bash/Read/Edit rows back to back — and
those runs dominate the vertical space of the thread.

PR #52 ("Add a Compact mode") attempted this with a CSS-only density toggle and
was reverted (#53). CSS can tighten spacing but cannot fold N rows into 1; that
requires a structural change.

## Goal

A `Compact` toggle that folds each run of consecutive tool calls into a single
summary line with an expand control. No content is hidden — expanding restores
the existing `ToolCard`s, each still independently expandable.

## Definitions

- **Run** — a maximal sequence of consecutive `tool_use` stream events with no
  rendered `user_prompt`, `assistant_text`, `thinking`, or `pr_link` event
  between them. `progress` events and system rows do **not** break a run.

## Behavior

- A `Compact` pill toggle sits next to `Show system events` in the thread
  controls.
- **Compact off** — current behavior, unchanged: one `ToolCard` per tool call.
- **Compact on** — *every* run (length ≥ 1) renders as one `ToolGroup`,
  collapsed by default. Runs of length 1 are grouped too, for visual
  consistency — every tool run looks the same when compact.
- State is `useState` only, not persisted — mirrors `showSystemEvents` and the
  reverted #52.

### Collapsed group line

Reuses the `tool-head` visual style so it matches existing collapsed rows:

```
> 6 tool calls  ·  3 Bash  2 Read  1 Edit                    12:01
```

- Chevron + `N tool calls`.
- Breakdown: count per `toolLabel`, ordered by first appearance in the run.
- An error dot if **any** call in the run errored (`result.isError`).
- Time of the **first** call in the run, right-aligned.

### Expanded group

Renders the run's `ToolCard`s in order. Each card behaves exactly as today —
independently expandable, same bodies, same hook lists.

## Components

### `TraceViewer.tsx`

Add `const [compact, setCompact] = useState(false)`. Pass `compact` /
`setCompact` to `ThreadControls`, and `compact` to `Thread`.

### `ThreadControls.tsx`

Add `compact` / `setCompact` props and a third `Toggle` labelled `Compact`.

### `Thread.tsx`

Accept a `compact` prop. While building the output list, when `compact` is on,
detect runs of consecutive `tool_use` events and emit one `<ToolGroup>` per run
instead of individual `<ToolCard>`s. When `compact` is off, emit `<ToolCard>`s
as today.

For each tool event in a run, `Thread` already computes its `followingPrompt`
(`nextPrompt[i]`) and `progress` (`hooksByTool.get(e.id)`). It passes the run to
`ToolGroup` as an array of `{ event, followingPrompt, progress }`, plus the
shared `root`, `shortId`, and `agents`.

### `ToolGroup.tsx` (new, in `components/trace/tool/`)

- Props: `items: { event, followingPrompt, progress }[]`, `root`, `shortId`,
  `agents`.
- `useState(false)` for open, collapsed by default.
- Collapsed: the summary line described above.
- Expanded: maps `items` to `<ToolCard>`, passing through each card's props.
- Breakdown + aggregate error dot computed from `items`.

### `viewer.css`

A `.tool-group` block reusing the `tool-head` look (dot, chevron, summary, right
meta) so the group line is visually consistent with collapsed tool rows.

## Testing

Extend `src/tests/routes/TraceView.test.tsx`:

1. The `Compact` toggle renders and, when on, folds a run of 2+ consecutive
   tool calls into one group line showing the count and breakdown.
2. Expanding a group reveals the individual `ToolCard`s.
3. With `Compact` on, a run of length 1 also renders as a `ToolGroup` (not a
   bare `ToolCard`).
4. With `Compact` off, the thread renders one `ToolCard` per tool call,
   unchanged.

## Out of scope

- CSS density tightening of non-tool elements (the reverted #52 approach).
- Persisting the toggle across sessions or sharing it via URL.
- Collapsing across assistant-text boundaries.
