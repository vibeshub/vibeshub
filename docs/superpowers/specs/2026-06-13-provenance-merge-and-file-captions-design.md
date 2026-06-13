# Provenance view: merged file diffs + digest-written file captions

Status: design, written 2026-06-13. Approved direction: Approach A (visual merge).

## Summary

Two coupled changes to the Provenance Blame view:

1. **Frontend (visual merge).** Each file stops rendering as a stack of per-edit
   hunk boxes and becomes a single merged diff block: the file's surviving edit
   regions, sorted by file position, rendered under one header with continuous
   per-line gutters. Provenance moves from the hunk box to the line (the gutter
   already carries per-line prompt No / author / heat). The "retried" signal
   becomes a quiet gutter marker; attempt detail shows in the line panel.

2. **Backend (per-file captions).** The trace digest agent learns to write one
   prose caption per significant file, which the merged file header displays in
   place of today's verbatim "first added line" titles. To write good captions
   the digest is fed a short preview of each edit's content (the distiller
   currently shows only the file path).

Out of scope: true net per-file diff with reconstructed per-line blame (Approach
B / follow-up 7b), per-edit captions, PR merge badge, thinking-text fixes,
old-trace backfill or old-trace-specific handling.

## Motivation

Files edited many times (e.g. `faq.module.css`) render as a wall of tiny hunk
boxes, each titled with a verbatim code line picked by `hunkTitle()` (the "first
non-empty added line" for non-prose, non-declaration files). The result is
cluttered and low-signal, against the project's subtle / low-clutter taste. The
view's thesis is line-centric ("where did every line come from"), so the
per-edit box is a redundant second grouping layer. Merging to one diff per file,
captioned in prose by the digest, is both cleaner and more on-thesis.

## Decisions (locked during brainstorming)

- **Edit preview richness:** per edit, render `+N -M` plus the first ~3
  non-trivial added lines.
- **Approach:** A, visual merge. Keep per-op diffs and per-line gutters as
  computed today; drop the box/title chrome; one block per file.
- **Region order inside a file:** file position, using the `@@` new-file start
  line. Patch-less regions (whole-file Writes, MultiEdit-without-patch where line
  numbers restart) fall back to edit order, appended after positioned regions.
  If positioned regions overlap, that file falls back to chronological order.
- **Retry signal:** a faint gutter marker on rows whose region's op had failed
  attempts; the full attempt list shows in the line panel on click.
- **Captions:** per file, anchored by path, no heuristic fallback (absent caption
  shows the bare header).

## Backend: digest agent

### schema.py

```python
class FileNote(BaseModel):
    path: str
    caption: str = Field(max_length=140)

class Digest(BaseModel):
    ...
    file_notes: list[FileNote] = Field(default_factory=list, max_length=20)
```

`ask/decisions/files/tests/dead_ends/chapters` are unchanged. `default_factory`
keeps existing persisted digests valid.

### prompt.py

Add a `file_notes` section: one caption per significant file, PR-review voice
("what changed here and why"), `path` must be one that appears in the input,
drop rather than guess, no em-dashes. Same authoring discipline as chapters.

### distill.py

1. **Edit preview.** In `_tool_use_to_line`, for `Write` / `Edit` / `MultiEdit`
   / `apply_patch`, render `<Tool> <path> (+N -M)` followed by the first ~3
   non-trivial added lines, joined into a **single `lines[]` entry** (newlines
   collapsed) so the one-entry-per-event invariant that dedup and
   `_collapse_exploration_runs` rely on is preserved. Added lines come from
   `new_string` / `content` / `edits[]`; when only a structuredPatch exists, from
   its added rows. Keep a per-line char cap so a giant Write can't blow the
   preview budget.
2. **Edited-path surface.** `_classify` / `distill_with_uuids` also collect and
   return the set of edited file paths, so the pipeline can validate
   `file_notes` paths the same way chapter anchors are validated against `uuids`.

### pipeline.py

- Drop `file_notes` whose `path` is not in the edited-path set.
- Add `caption` to the em-dash sweep (the explicit per-field loop).
- Persist; record `file_notes_kept` / `file_notes_total` in `agent_run.extra`.

Still one LLM call. Output grows by up to 20 short captions (within the 4000
output-token cap). The distiller output changes, so `digest_input_hash` no longer
matches existing traces; recompute happens lazily on the next upload of a trace
(no forced backfill).

## Frontend: visual merge

### provenance.ts

- The per-file list stays `BlameFile.hunks: BlameHunk[]` (the implementation
  plan keeps the type/field name to avoid churn; "region" is just the prose term
  for a hunk we no longer box). A region is today's `BlameHunk` minus the
  box-title concept: it keeps
  `promptIdx`, author (`agentType`), `heat[]`, `attempts`, `verifications`,
  `reasoning`, `research`, `jumpUuid`, `promptUuid`, `rows`, `adds`, `dels`,
  plus a new `retried: boolean` (`attempts.length > 0`).
- **Region ordering.** Compute a file-position key per region from the first
  `@@` row's new-file start line. Sort positioned regions by that key; append
  patch-less regions in edit order. Detect overlap among positioned regions
  (start/length ranges intersect); on overlap, sort that file's regions
  chronologically instead (existing behavior).
- `hunkTitle()` is retired (no per-region titles rendered). Remove it and its
  tests, or keep dead-code-free.
- Superseded regions: as today, `markSuperseded` drops overwritten intermediate
  ops from the surviving set, so the merged block is the net result. No separate
  stub UI.

### ProvenanceView.tsx

- Remove the `Hunk` box chrome (title button, per-hunk meta row, superseded
  stub). Per file render: one header (`path · status · +N -M`, a caption line
  when present, and a faint `· N edits, M retried` summary), then one continuous
  `BlameRows` block over all of the file's regions in sorted order.
- **Retry marker.** A quiet gutter glyph on rows belonging to a region with
  `retried === true`. Reuses the existing gutter columns; no new column.
- **Selection.** Rows are the sole provenance target. Make rows proper
  keyboard-accessible controls (button semantics, `tabIndex`, Enter/Space), which
  also resolves the a11y gap where only hunk titles were reachable. Clicking a
  row selects its region and opens the panel exactly as today (prompt ->
  reasoning -> attempts -> verification), showing the attempt list when retried.
- **Caption wiring.** `ai_digest` already reaches `TraceViewer`. Thread it into
  `ProvenanceView`, build `Map<path, caption>` from `ai_digest.file_notes`,
  render the caption as the file-block subtitle. No caption -> bare header.

### types.ts

Add `file_notes?: FileNote[]` (optional) to `TraceDigest`, with a `FileNote`
type (`path`, `caption`).

## Data flow

```
upload -> trace_service.create_or_update_trace
            -> compute_digest
                 distill (now: edit previews + edited-path set)
                 LLM (now: + file_notes)
                 validate file_notes paths, em-dash sweep
                 persist digest_json (now: + file_notes)
GET trace -> TraceSummary.ai_digest.file_notes
frontend  -> TraceViewer -> ProvenanceView(model, ai_digest)
                 buildProvenance: regions sorted by file position
                 Map<path, caption> -> file header subtitle
```

## Testing

- **Backend** (`env/bin/pytest`):
  - distill: edit line renders `(+N -M)` + first ~3 added lines as one entry;
    edited-path set is collected; preview char cap holds; collapse/dedup
    invariants unchanged.
  - pipeline: `file_notes` with an unknown path is dropped; em-dash in a caption
    is swept; `file_notes_kept`/`_total` recorded.
  - Extend the digest fixtures.
- **Frontend** (`npm test`):
  - provenance: regions sorted by file-position key; patch-less regions appended
    in edit order; overlap falls back to chronological; `retried` flag set from
    attempts; `Map<path, caption>` wiring; graceful no-caption.
  - render: hunk boxes/titles gone; one block per file; rows are focusable;
    retry marker appears for retried regions.

## Risks / edge cases

- **Overlapping Write + Edit on one file.** Handled by the chronological
  fallback; the common clutter case (all-Edit files) never triggers it.
- **Output-token pressure** if a trace has many significant files. Mitigated by
  the `max_length=20` cap on `file_notes`.
- **Region key absence** for imported/patch-less traces. Handled by the
  append-in-edit-order fallback.
```
