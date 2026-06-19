# Transcript-based net diff for the Changes view

Date: 2026-06-19
Status: Approved, ready for implementation plan

Related: `2026-06-11-changes-view-design.md`, `2026-06-13-provenance-merge-and-file-captions-design.md` (the current "Provenance Blame" Changes view this design replaces as the default).

## Summary

The trace "Changes" tab today renders a *process* view: per file, it concatenates each surviving edit op as its own hunk group, annotated inline with prompt number, author band, and rewrite heat (`ProvenanceView.tsx`, `provenance.ts`, `changes.ts`, `diff.ts`). It shows the journey, not the destination. It is not a consolidated before/after the way GitHub shows a file in a PR, and it never reconstructs the full original or final file.

This design makes the Changes tab default to a clean, consolidated before to after net diff per file (GitHub-style), reconstructed entirely from data already stored in the transcript. The provenance chain (instruction, attempts, verification) moves into the side panel, surfaced per line on click.

## Goal

For every trace (PR-linked or `/share-trace`), show a single consolidated net diff per file as the default Changes view, with per-line provenance available in the side panel.

## Non-goals (explicitly deferred)

- Fetching the PR diff from GitHub. Considered and dropped for this iteration.
- Capturing a real `git diff` client-side at `/share-trace` time. Considered and dropped: determining the right base and whether the session's work is committed vs uncommitted is fragile (`git diff` vs `git diff HEAD` vs `git diff <base>...HEAD`), and the session's starting commit is not tracked.
- Any backend, storage, schema, or plugin change. This is frontend-only.

Both deferred sources can layer on top of this design later (a priority chain: client diff > PR diff > transcript reconstruction) without redoing this work.

## Key decisions (locked during brainstorming)

1. Scope: transcript-based net diff only. Frontend-only, no backend/plugin change.
2. UX: the net diff becomes the default Changes view (Option A). Provenance moves to the side panel.
3. Attribution: best-effort per-line ("last writer"), degrading to file-level where a line cannot be confidently mapped.

## Data source (already stored, currently ignored)

Every `Edit` / `Write` / `MultiEdit` tool result carries, inside `toolUseResult`:

- `originalFile`: the full pre-edit file content (present on updates; null/absent for first-time creates).
- `content`: the full post-edit file content (the whole file, not a fragment).

Today only `toolUseResult.structuredPatch` is read (`extractPatch` in `diff.ts`). These two fields are uploaded with the transcript and survive redaction (secret substitution only); they are simply unused.

## Limitation we accept

The reconstructed diff is "net of the agent's tool-driven edits", not git ground truth. It will not reflect changes made outside Edit/Write/MultiEdit: Bash/`sed`/`mv`, formatter or hook rewrites, codegen, or manual human edits. This is acceptable for this iteration and is the gap the deferred PR/client sources would later close.

## Architecture and data flow

Four well-bounded units. The diff engine (`diff.ts`) and the entire conversation tab (Thread, tool cards, inline `DiffView`) are untouched.

### 1. `changes.ts`: enrich the op (data capture)

`collectOps` already pulls each edit's inputs and `structuredPatch`. Extend the collected op with two fields read from the tool result, mirroring how `extractPatch` reads `toolUseResult`:

- `originalFile: string | null`
- `finalContent: string | null` (from `toolUseResult.content`)

No parser-model change is required; the untyped `toolUseResult` is already reachable on the op's result. Every downstream unit consumes this enriched op.

### 2. `netdiff.ts`: new, pure, no React

`buildNetFiles(ops) => NetFile[]`. For each path:

- `baseline` = the first op's `originalFile`, or `""` when the file was created in-session (first op is a create with no prior content).
- `final` = the last successful op's `finalContent`, or `""` when the file was deleted in-session.
- `rows` = `fallbackDiff(baseline, final)`, the existing LCS line differ, producing the `DiffRow[]` the renderer already consumes. Reverted and superseded edits vanish naturally because only the endpoints are compared.
- net `adds` / `dels` are computed from these rows.
- per-row attribution: each surviving (`add` / `ctx`) `NetRow` gets a `hunkId` pointing at the op that last wrote that line, or `null` (file-level). See attribution below.
- a file whose ops lack both content fields returns with `hasNetData: false`.

This unit is fully testable in isolation by feeding it synthetic op arrays.

### 3. `provenance.ts`: wiring

`buildProvenance` keeps producing the op-level records exactly as today (prompts, attempts, research, verifications, heat, attribution bar, outcome). The net result is attached onto each `BlameFile`:

- `netRows: NetRow[]`
- `netAdds: number`, `netDels: number`
- `hasNetData: boolean`

`NetRow.hunkId` indexes into the file's existing `hunks`, so the side panel reuses the current chain data with no parallel structure.

### 4. `ProvenanceView.tsx`: rendering

- `FileBlock`: when `hasNetData`, render `netRows` as one consolidated diff with clean gutters (old/new line numbers, sign, syntax-highlighted code), the whole row clickable. The inline prompt-number / author-band / heat strip is removed from the main net view (it moves to the panel), keeping the view GitHub-clean and low-clutter. When `!hasNetData`, render today's per-op hunk view unchanged (the fallback).
- `Panel`: clicking a net row looks up `hunkId` and renders the existing provenance chain (instruction, research, attempts, verification, jump-to-conversation). When `hunkId` is `null`, it renders a new file-level mode: the aggregate of every prompt that touched the file, total edits/retries, and verification. This is the one genuinely new piece of UI.
- `FilesIndex`, `StatRow`, `Attribution`, `OutcomeRows`: unchanged, except per-file `+/-` now reads the net counts.

## Net-diff algorithm (per file)

```
ops_for_path = ops grouped by path, in chronological order

baseline:
  if first op is a create (no prior file):      baseline = ""
  else if first op.originalFile is present:      baseline = first op.originalFile
  else:                                          hasNetData = false  (fall back)

final:
  if file was deleted in-session (rm):           final = ""
  else if last successful op.finalContent present: final = that content
  else:                                          hasNetData = false  (fall back)

when hasNetData:
  rows   = fallbackDiff(baseline, final)
  adds   = count(rows where kind == "add")
  dels   = count(rows where kind == "del")
  status = "new"                 if baseline == "" and final != ""
           "deleted"/"ephemeral" if final == ""
           "mod"                 otherwise   (incl. baseline == final, "no net change")
```

`hasNetData` is true only when both `baseline` and `final` were resolvable from the content fields above; otherwise the file renders via the per-op fallback.

Because each op's `finalContent` is the full cumulative file state at that point, there is no need to fold intermediate edits; the last op's content is the final state.

## Per-line attribution (best-effort "last writer")

For each surviving net row (`add` / `ctx`), find the most recent op whose introduced content includes that line and set `NetRow.hunkId` to that op's hunk id. Matching is by line text against each op's introduced content (`finalContent` / new hunk lines). When the same line text appears in multiple ops, attribute to the latest. When a line cannot be confidently mapped, set `hunkId = null`. Removed (`del`) lines are always file-level (`hunkId = null`); we do not attribute deletions per line.

The side panel uses `hunkId`:

- non-null: render the existing per-op chain (reuses today's `Panel` content keyed by the attributed hunk).
- null: render the new file-level aggregate (all prompts that touched the file, total edits/retries, verification).

## Edge cases

- New file (Write/create): baseline `""`, all additions, status `new`.
- Deleted file (`rm` after edits): final `""`, all deletions; reuse the existing `deletedAfter` / `ephemeral` detection and its greyed treatment.
- Edit-then-revert: baseline == final, empty net diff. Keep the file in the index labeled "no net change" so its provenance (churn that landed nothing) stays reachable.
- Multiple edits / MultiEdit: baseline from the first op's `originalFile`, final from the last op's `finalContent`. MultiEdit works identically since the result `content` is the full post-edit file.
- Missing `originalFile` / `finalContent` (pre-field logs, redaction-stripped, or `apply_patch` from Codex imports): `hasNetData: false`, that file falls back to today's per-op view. Per-file, so it never breaks the whole tab.
- Out-of-band changes (Bash/`sed`/formatters/manual): invisible, documented limitation.
- Large files: keep the existing 80-row fold and 800-row cap.
- Attribution fuzziness: duplicate lines attribute to the latest op containing the text; unmappable or removed lines fall to file-level.

## Testing (vitest, existing frontend harness)

`netdiff.ts` unit tests (highest value, pure function, fed synthetic op arrays):

- new file (Write) gives all adds, status `new`.
- single edit on existing file uses baseline from `originalFile`, correct rows and counts.
- multiple edits same file gives net = first `originalFile` to last `finalContent`, intermediate states ignored.
- edit-then-revert gives empty net diff, file flagged "no net change".
- MultiEdit gives correct net from result content.
- delete after edits gives status `deleted`, all-removed.
- missing content fields gives `hasNetData: false`.
- attribution: a net line maps to its last-writer op; unmappable / removed gives `null` (file-level).

Component tests (lighter):

- net mode renders one consolidated diff with clean gutters.
- clicking a net row opens the attributed op's chain.
- a `hasNetData: false` file falls back to the per-op view.
- file-level panel mode renders the aggregate.

Regression: existing provenance tests still pass via the fallback path.

## Files touched

- `webapp/frontend/src/components/trace/changes.ts` (enrich op with `originalFile` / `finalContent`)
- `webapp/frontend/src/components/trace/netdiff.ts` (new pure builder + attribution)
- `webapp/frontend/src/components/trace/provenance.ts` (attach net result to `BlameFile`)
- `webapp/frontend/src/components/trace/ProvenanceView.tsx` (render net rows, file-level panel mode)
- Types for `NetFile` / `NetRow` (in `netdiff.ts` or the trace `types.ts`)
- Tests under `webapp/frontend/src/tests/`
