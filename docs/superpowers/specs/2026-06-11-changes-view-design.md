# Changes View (Trace-Native Net Diff) Design

**Date:** 2026-06-11
**Status:** Approved (brainstorm session 2026-06-10/11; mockups in `.superpowers/brainstorm/`, gitignored)

## Overview

A second mode for the trace viewer's main column: a file-grouped diff of everything the session changed, assembled entirely from trace data, with each hunk captioned by the user prompt that produced it. Git shows what changed; the trace also knows why, when, in what order, and by which agent. This view is the foundation for later layers (verification badges, churn indicators, ghost diffs), none of which are in this iteration.

Decisions made during brainstorming:

1. **Placement:** a `Conversation / Changes` pill toggle on the main column (chapter rail stays and serves both modes). Not an expandable Files-touched panel, not a split pane.
2. **Conversation blame affordance:** prompt caption groups. Hunks group under a caption row quoting the triggering prompt, reading like commit messages inside the file. Not gutter hover markers, not chapter chips.
3. **Net strategy:** superseded-collapse. Hunks stay in chronological caption groups; a hunk that a later edit overwrote collapses to an expandable one-line stub. No synthesized merges: every diff shown literally appeared in the trace.

## Goals

- PR-style, file-grouped reading of a session's changes inside the trace viewer.
- Every hunk links back to the conversation moment that produced it.
- Works retroactively on every already-stored trace: client-side only, no backend or ingest changes, no digest dependency.

## Non-goals (this iteration)

- Verification badges, churn counts, ghost diffs of abandoned code, provenance lines, risk-ordered file lists, chapter chips, synced split pane. All brainstormed and deliberately deferred.
- Fetching real git/PR diffs from GitHub or reconciling trace diffs against repo state.
- True net composition (last-writer-wins patch algebra). Rejected for this iteration: it degrades on unanchorable edits and a wrongly merged hunk in a review surface is worse than a verbose one.

## UX specification

**Mode toggle.** `ThreadControls` gains a `Conversation / Changes` pill pair. Default is Conversation. The toggle is hidden when the session contains no file-editing tool calls. `#changes` in the URL hash deep-links into Changes mode (shared links can land on the diff).

**Changes mode layout, top to bottom:**

1. **File index strip.** One slim bar listing each touched file (monospace path) with net `+N`/`-N` stats; a `new` annotation for created files. Clicking a path scrolls to its card. A right-aligned summary shows "N files, +A -D net".
2. **File cards**, ordered by first-touch time (session order, not path order). Card header: file path, optional `new file` badge, net stats counting surviving hunks only.
3. **Caption groups** inside each card. The caption row shows: a quoted excerpt (~90 chars, ellipsized) of the user prompt that was active when the edit happened, a turn label ("turn 12"), and a `jump` link. Edits made inside a subagent additionally show a `via Task[<agent type>]` badge.
4. **Hunks** under each caption, rendered with the existing `DiffView` row renderer (unified view, line numbers, Prism highlighting).
5. **Superseded stubs.** A superseded hunk renders as a single muted, expandable row: "1 hunk (+9 -2) superseded by turn 18". Expanding shows the original hunk rows, visually muted.

**Jump behavior.** Clicking `jump` (or a caption) switches to Conversation mode and scrolls to the originating tool card by uuid, reusing the anchor-scroll mechanism `ChapterRail` already uses. A caption's jump target is its first hunk's tool card; an individual hunk's target is its own tool card. Subagent-produced hunks jump to the spawning Task card in the main thread. Leaving Changes mode (by jump or toggle) clears the `#changes` hash.

**Copy rules.** No em-dashes in any UI string. Turn label is "turn N" where N is the 1-based ordinal of the `user_prompt` event in the main stream.

## Data model

New pure module `webapp/frontend/src/components/trace/changes.ts` (peer of `diff.ts`), mapping `Session -> FileChange[]`:

```ts
interface FileChange {
  path: string;
  kind: "new" | "mod";          // same classification as deriveFiles
  adds: number;                  // surviving hunks only
  dels: number;
  firstTouchTs: string | null;   // card ordering
  groups: CaptionGroup[];
}

interface CaptionGroup {
  promptUuid: string | null;     // user_prompt event uuid (jump target fallback)
  promptExcerpt: string;         // ~90 chars, ellipsized
  turnLabel: string;             // "turn 12"
  agentBadge: string | null;     // "Task[refactor]" when from a subagent
  hunks: Hunk[];
}

interface Hunk {
  toolUseUuid: string;           // jump target
  ts: string | null;
  rows: DiffRow[];               // built by the existing diff.ts pipeline
  newContent: string;            // emitted content, for supersede matching
  supersededBy: { uuid: string; turnLabel: string } | null;
}
```

## Algorithm

1. **Collect.** Walk `tool_use` events across the main stream and all subagent streams (the same walk `deriveFiles` in `Outcome.tsx` performs). Keep `Write`, `Edit`, `MultiEdit`, `apply_patch` events carrying a `file_path` (or the path `deriveFiles` extracts for `apply_patch`). Group by exact path string; no normalization beyond what `deriveFiles` does.
2. **Build rows.** Each tool call yields one hunk (MultiEdit: one hunk per sub-edit) using the existing `buildWriteRows` priority: `structuredPatch` from the tool result, else `input.content` (new file), else `old_string`/`new_string` LCS fallback, else `edits[]`.
3. **Record emitted content** per hunk for supersede matching: Write takes full `content`; Edit takes `new_string`; MultiEdit sub-edits take their own `new_string`; structuredPatch-only hunks take the joined added lines.
4. **Supersede pass**, per file, in chronological order, exact-match only:
   - A `Write` supersedes all earlier hunks on that file.
   - An `Edit` (or MultiEdit sub-edit) supersedes an earlier hunk H when its `old_string` contains `H.newContent` verbatim (exact substring, no whitespace fuzzing).
   - Nothing else supersedes. False negatives are acceptable; false positives are not.
5. **Group by prompt.** Each hunk attaches to the nearest preceding `user_prompt` in its own stream. Subagent hunks instead attach to the main-thread prompt preceding their Task dispatch, and carry `agentBadge` from the agent summary (type, falling back to description).
6. **Stats.** File card and index-strip stats count rows of surviving hunks only.

## Components

- **Create** `ChangesView.tsx`: index strip + file cards; owns stub expand state.
- **Create** `FileChangeCard.tsx`: card header, caption groups, hunks via `DiffView`, superseded stubs.
- **Create** `changes.ts`: the pure model above.
- **Modify** `TraceViewer.tsx`: `mode` state (`"conversation" | "changes"`), hash sync; `ThreadControls` stays mounted in both modes so the toggle is always reachable, and only `Thread` is swapped for `ChangesView` (chapter rail unaffected).
- **Modify** `ThreadControls.tsx`: the pill toggle (hidden when `FileChange[]` is empty); the conversation-only controls (system events, expand tool calls) hide in Changes mode.
- **Modify** trace CSS: caption row, stub row, index strip, badge styles; reuse the existing file-card classes from `FileBody`'s write mode where practical.

`changes.ts` is computed once per session via `useMemo` in `TraceViewer` (the parse already happens client-side; sessions are bounded by the existing viewer's scale assumptions).

## Error handling and degradation

- A hunk with no derivable rows (e.g., codex `apply_patch` with no `structuredPatch`) renders its caption plus a muted "no patch data" row; it never blocks the rest of the file card.
- Per-card row rendering reuses the existing `MAX_ROWS` cap and "... N more lines" overflow from `DiffView`.
- Traces without a digest are fully supported; captions come from prompts, not the digest.
- A prompt-less hunk (edit before any user prompt, or unattributable subagent) groups under a caption reading "session start" with no jump link.
- No file edits at all: the toggle does not render; Conversation mode is unchanged.

## Testing

- **Unit (vitest), `changes.test.ts`:** fixture sessions covering write-then-edit supersede; edit-chain supersede; Write superseding everything prior; MultiEdit producing per-sub-edit hunks; subagent hunk attribution and badge; prompt grouping across multiple turns; structuredPatch-only hunks; no-edit session returning `[]`; stats counting surviving hunks only; exact-match (a near-miss old_string must NOT supersede).
- **Component:** toggle renders only when changes exist; switching modes preserves the rail; jump switches mode and scrolls to the uuid (scroll mocked); superseded stub expands to muted rows.

## File map

Create: `webapp/frontend/src/components/trace/changes.ts`, `ChangesView.tsx`, `FileChangeCard.tsx`, `src/tests/trace/changes.test.ts`, component test.
Modify: `TraceViewer.tsx`, `ThreadControls.tsx`, trace stylesheet.
Backend: no changes.
