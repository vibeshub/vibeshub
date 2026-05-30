# Refocus messaging: teams on `/`, solo show-off on `/vibeviewer`

**Date:** 2026-05-30
**Status:** Approved, ready for planning

## Problem

The site currently mixes two audiences on the same pages, which muddies the
pitch. The front page (`Landing.tsx`) blends team framing (PR receipts,
reviewers, GitHub-mirrored permissions) with solo framing (the "Show it off"
section: brag posts, social cards, "on your profile", "revisit your own
reasoning weeks later"). `/vibeviewer` is utilitarian and solo-leaning but
never leans into the "show off your work" angle.

## Goal

Give each audience one clear page, without mixing the two:

- **Front page (`/`)** = "Collaboration tool for vibe coding teams." How teams
  collaborate better with vibeshub.
- **`/vibeviewer`** = the individual developer showing off how they built their
  work. No login, drop a transcript, get something worth sharing.
- Each page carries a single subtle pointer to the other for the alternate
  audience, so neither use case is hidden, but they never share a page.

Non-goals: no layout restructure, no new routes, no redesign. This is a
messaging/positioning re-slant that reuses existing components and CSS.

## Decisions (from brainstorming)

1. Front page's solo "Show it off" block is **replaced with a team
   collaboration section** (the solo energy moves to `/vibeviewer`).
2. `/vibeviewer` **adds a show-off angle** (social card, profile, share
   anywhere) on top of the existing no-login drop-to-visualize utility.
3. **Subtle cross-link each way** between the two pages.
4. The team section leads with all four value props: faster/deeper review,
   onboarding & knowledge transfer, searchable team history, shared permissions
   with zero setup.

## Front page changes (`webapp/frontend/src/routes/Landing.tsx`)

### Hero (copy only; keep layout and the 3 workflow tiles)

- Eyebrow: `public & private · for Claude Code` -> `public & private · for vibe coding teams`
- H1: keep **"Don't just ship the diff - share the vibe."** (already reads to
  reviewers).
- Subhead: cut the solo half. New copy:
  > Your Claude Code sessions, including every subagent they spawn, become
  > shareable, replayable traces your whole team can read. Reviewers and
  > teammates see how you actually shipped it, not just the final diff.
- Keep tagline "git for your vibes" and the three tiles (Automatic PR /
  `/share-trace` / Web upload), all team-workflow relevant.

### Replace "Show it off" -> "Built for teams" collaboration section

Reuse the same grid and the existing **PR-comment mock card** on the left (it
is inherently a team artifact). Rewrite the right-hand column:

- Eyebrow: `Collaborate`
- Title: **"Your team's work, finally legible."**
- Four bullets:
  - **Faster, deeper review.** Reviewers open the actual run, prompts, tool
    calls, reasoning, before they read the diff. Less guessing, fewer
    round-trips.
  - **Onboarding without the shoulder-tap.** New teammates see how tricky
    changes were really built, with the full session as context.
  - **Searchable team history.** Every shipped PR keeps its session attached, so
    each repo becomes a browsable archive of how the team works.
  - **Shared permissions, zero setup.** Access mirrors GitHub, the right people
    already have visibility, no separate ACLs or accounts.

### Keep Browse / Privacy / Install

Browse ("vibeshub, built with vibeshub" + per-repo stats) already reads as a
team archive. Privacy already team-flavored (mirrors GitHub, collaborators carry
over). Install: keep; optionally nudge "Install once for the team."

### Cross-link to solo page

One low-key line at the end of the new team section:
> Working solo and just want to show off a session? Try the vibeviewer ->

links to `/vibeviewer`. Optionally add a `Teams` nav link pointing at the new
section id.

## `/vibeviewer` changes (`webapp/frontend/src/routes/VibeViewer.tsx`)

### Re-slant the top toward the individual showing off their work

- Eyebrow: keep `Claude Code trace viewer · no account needed`.
- H1: "Your vibe coding sessions, visualized." -> **"Show off how you actually
  built it."** (highlight on "built it").
- Subhead: point at sharing.
  > Your hard work deserves a better look. Drop a Claude Code transcript and get
  > a clean, replayable trace you can share anywhere, in seconds. No login
  > required.

### Add a "Made to be shared" section (the solo energy moved off `/`)

Compact section below the trust line, styled to match existing `vv-*` cards:

- A stable link with a social card that renders cleanly on X and LinkedIn.
- Shows up on your `vibeshub.ai/@you` profile.
- Beats a screenshot of your terminal.
- Captures every subagent your session spawned, not just the top-level
  transcript.

### Cross-link to team page

One quiet line near the foot:
> Shipping with a team? vibeshub auto-posts these on every PR ->

links to `/`.

### Keep unchanged (test-pinned + still useful)

Dropzone ("Drop your transcript here"), trust line, bridge jump-links, the
"Three ways to get your transcript" section ("Local session files", "vibeshub
plugin"), the "show it on your profile" sign-in nudge, and the
success/copy/claim flow.

## Constraints

- **No em-dashes** in any new copy (standing rule). Use commas, periods,
  parentheses, or spaced hyphens like the existing copy.
- Subtle, in-context changes; reuse existing CSS classes (`showoff` /
  `showoffUses` grid on Landing; `vv-*` cards on `/vibeviewer`) rather than
  restructuring layout.
- Preserve all test-pinned strings and the bridge/claim/copy behavior.

## Testing

- `Landing` copy is not test-pinned, but run the full frontend suite to confirm
  nothing regressed: `Home.test`, `VibeViewer.test`, `VibeViewerBridge.test`.
- Preserve the strings `VibeViewer.test` and `VibeViewerBridge.test` assert.
- Manually eyeball both pages in the browser (light + dark) for layout and the
  two cross-link lines.

## Files touched

- `webapp/frontend/src/routes/Landing.tsx` (hero copy, team section, cross-link)
- `webapp/frontend/src/routes/Landing.module.css` (only if a new bullet/section
  needs a class; prefer reuse)
- `webapp/frontend/src/routes/VibeViewer.tsx` (H1/subhead, "Made to be shared"
  section, cross-link)
- `webapp/frontend/src/styles/*` (vibeviewer global CSS, only if the new section
  needs styling beyond existing `vv-*` classes)
