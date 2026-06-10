# Homepage update for the trace digest feature — Design

**Status**: approved, pending implementation
**Date**: 2026-06-09
**Depends on**: 2026-06-06-trace-digest-agent-design.md (shipped in #114-#123)

## 1. Purpose

The trace digest agent now summarizes every incoming trace: a fixed-shape
digest (Ask, Key decisions, Dead ends after #123 trimmed the other two rows)
plus chapter anchors, rendered in the trace viewer hero and embedded in the
bot's PR comment. The landing page does not mention any of this. This spec
weaves the digest into the existing landing sections without adding a new
section, per the approved design discussion.

## 2. Non-goals

- No new landing section, route, or layout change. Subtle, in-context only.
- No changes to the trace viewer, the digest agent, or the PR comment body.
  This is landing-page copy and one mock-card enhancement.
- No hero subhead rewrite. The hero pitch stays trace-first; the digest is
  introduced where reviewers encounter it (the PR comment mock).
- No /vibeviewer page changes. Per the messaging split, / sells teams; the
  digest's team story (review starts from intent) is the only angle used.

## 3. Changes

All changes are in `webapp/frontend/src/routes/Landing.tsx`,
`webapp/frontend/src/routes/Landing.module.css`,
`webapp/frontend/index.html`, and
`webapp/frontend/src/tests/routes/Landing.test.tsx`.

### 3.1 PR-comment mock card (Collaborate section)

The fake `vibeshub-bot` comment (`styles.shareCard`, Landing.tsx ~498-533)
gains three digest rows between the card title and the stats line, mirroring
what `build_comment_body` actually posts:

```
Claude Code session for this PR

Ask            Add chapter navigation to the trace viewer
Key decisions  Reuse digest anchors as the nav spine
Dead ends      IntersectionObserver thrashed, switched to scroll math

257 messages · 12 file edits · 4 subagents
vibeshub.ai/vibeshub/vibeshub/pull/69/7ntgpt45el ↗
```

- One line per row: muted small-caps-style label + normal-weight value,
  `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`.
- New CSS classes in Landing.module.css (e.g. `prDigest`, `prDigestRow`,
  `prDigestKey`); reuse existing card tokens for color and spacing.
- Mock copy stays plausible for the vibeshub repo and contains no em-dashes.

### 3.2 Collaborate bullet rewrite

The first bullet of `styles.showoffUses` changes from "Faster, deeper
review." to:

> **Review starts from intent.** Every trace lands with an AI digest, the
> ask, key decisions, and dead ends, plus chapters that jump straight to the
> moment. Reviewers get the story before the diff.

The list stays at five bullets; the other four are untouched. (Approved
refinement: rewrite rather than append a sixth, to keep clutter low.)

### 3.3 Hero "How it works" step 03

Copy changes from "The trace uploads and the PR updates with the link,
automatically. Reviewers see how you built it before they read the diff." to:

> The trace uploads and the PR comment arrives with an AI digest and the
> link, automatically. Reviewers start from the story, not message one of
> 257.

### 3.4 SEO descriptions (three synced surfaces)

Add the same digest clause to all three description surfaces:

1. `SeoHead` `description` prop in Landing.tsx ("Your ... become shareable,
   replayable traces...")
2. `LANDING_JSONLD.description` in Landing.tsx ("Turn your ... into
   shareable, replayable traces...")
3. The baked JSON-LD `description` in `webapp/frontend/index.html`

Surfaces 2 and 3 must remain character-identical (the code comment in
Landing.tsx requires it). Surface 1 keeps its own opening clause. Each
gains ", each with an AI digest of the session" after "replayable traces",
e.g.: "Your Claude Code and Codex sessions, including every subagent they
spawn, become shareable, replayable traces, each with an AI digest of the
session. Public and private viewer with GitHub-mirrored access and
automatic secret redaction."

## 4. Testing

In `Landing.test.tsx`:

- Update the assertion `/Faster, deeper review/i` to `/Review starts from
  intent/i`.
- Add an assertion that the PR mock renders the digest rows (e.g.
  `getByText(/Key decisions/i)` and one value string).
- Existing tests (version label, vibeviewer pointer, no brag-post copy) are
  unaffected.

Verification: `npm test` (vitest) in `webapp/frontend` plus a visual pass in
light and dark themes.

## 5. Out of scope / follow-ups

- FAQ and blog mentions of the digest (separate content task).
- Any digest screenshot or live-data rendering on the landing page; the mock
  card is static copy by design, like the rest of the landing mocks.
