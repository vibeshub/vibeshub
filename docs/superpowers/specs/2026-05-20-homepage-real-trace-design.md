# Design: Real trace in the homepage hero

**Date:** 2026-05-20
**Status:** Approved

## Problem

The homepage hero (`webapp/frontend/src/routes/Landing.tsx`) shows two hand-built
mockups in its right column:

1. A fake GitHub PR comment from `feross` on PR #482.
2. A stylized fake trace card ("Fix flake in retriever cache TTL test") with
   invented tool calls, durations, and a timeline.

Neither reflects a real vibeshub trace. The goal is to replace both with real
content drawn from an actual vibeshub-instrumented PR.

## Decisions

- **Featured PR/trace:** PR #31 — *"Render trace code: fenced blocks +
  syntax-highlighted diffs"* — trace at
  `https://vibeshub.ai/Bhavya6187/vibeshub/pull/31/66jxlxariq`
  (115 messages, 23 subagents). Both the screenshot and the PR comment come from
  this single PR so they stay consistent (the comment links to the trace shown).
- **Trace representation:** a static screenshot of the live trace page, linked
  to the live URL. Not a live-embedded viewer.
- **PR comment:** the real comment from PR #31, posted by `Bhavya6187`.
- **Theme:** capture the trace page in both light and dark; show whichever
  matches the current homepage theme.

## Implementation

### 1. Screenshot assets (new)

Capture the top-of-fold of the live trace page — the region containing the
title, meta line, timeline, first user prompt, and first tool cards (the same
content the old mock faked). Use Playwright (already present in
`webapp/frontend/node_modules`) against the live `vibeshub.ai` trace, at 2×
device scale for retina crispness.

Two captures, one per theme, committed to a new directory:

- `webapp/frontend/src/assets/hero-trace-light.png`
- `webapp/frontend/src/assets/hero-trace-dark.png`

The trace viewer has its own theme control; set the theme (via its toggle or
the persisted theme key) before each capture.

### 2. Hero "trace card" → real screenshot

In `Landing.tsx`, replace the hand-built `traceCard` body (the fake title,
`traceMeta`, `timeline`, `userPromptCard`, and `toolCard` blocks) with an
`<img>` of the screenshot wrapped in an `<a>` to the live trace URL.

Keep the card frame: the `tracePin` "live trace" badge, the window `dots`, and
the `urlChip` — the chip now shows the real URL
(`vibeshub.ai/Bhavya6187/vibeshub/pull/31/66jxlxariq`).

The image swaps with the homepage theme using the existing `resolved` value
from `useTheme()` already destructured in `Landing`:

```tsx
const heroShot = resolved === "dark" ? heroTraceDark : heroTraceLight;
```

Both PNGs are imported as Vite asset URLs.

### 3. "Example comment" → real comment

The `ghComment` block becomes the real PR #31 comment:

- **Avatar:** `https://github.com/Bhavya6187.png` (real GitHub avatar image)
  in place of the `fc` text initials.
- **User:** `Bhavya6187`.
- **Meta:** `commented on PR #31` (drop the misleading "· just now").
- **Body:** `Claude Code trace for this PR: ` followed by the real trace link
  as a working `<a>` (link text `vibeshub.ai/Bhavya6187/vibeshub/pull/31/66jxlxariq`),
  then `Uploaded by the PR author.`

### 4. Accessibility + CSS cleanup

- Remove `aria-hidden="true"` from `heroVisual` — it now contains real,
  meaningful, linked content. Give the screenshot `<img>` descriptive `alt`
  text.
- Remove CSS classes in `Landing.module.css` used **only** by the deleted mock
  (e.g. `traceH1`, `traceMeta`, `crumb`, `sep`, `timeline`, `timelineSeg`,
  `tlRead`, `tlBash`, `tlGap`, `tlWrite`, `tlAgent`, `userPromptCard`,
  `upAvatar`, `upBody`, `upMeta`, `upText`, `toolCard`, `toolBash`, `toolWrite`,
  `toolHead`, `toolDot`, `toolName`, `toolArgs`, `toolDur`, `toolBody`, `err`,
  `ok`). Before removing each, grep to confirm it is unused elsewhere — notably
  `dim` is reused by the redaction-preview block and must stay.
- Add a `traceShot` style for the screenshot `<img>` (full-width, block,
  inherits the card's rounded corners).

## Trade-off

A static screenshot will not auto-update if the trace viewer's design changes
later; it will need a manual re-capture. Accepted. A short code comment near
the assets / import records this so a future reader knows the PNGs are
hand-captured.

## Out of scope

- No changes to the trace viewer itself.
- No live/embedded viewer or iframe.
- No changes to other homepage sections (how-it-works, privacy, install).
