# Editable trace title + Active Time for text imports

Date: 2026-05-29

## Problem

A trace reconstructed from a Claude Code `.txt` terminal export shows two
broken things in the viewer (see the uploaded screenshot of trace `#85`):

1. The title is always "Untitled session". Text exports carry no `ai-title`
   record, and the displayed title is derived purely client-side from the
   JSONL (`Hero.tsx` renders `meta.aiTitle || "Untitled session"`). There is
   no way to give a trace a real title, and nothing is stored.
2. "Active Time" reads "0s" with "wall: 0s". Text exports have no timestamps,
   so `meta.assistantThinkMs` and wall time are both `0`. Showing "0s" reads
   like a bug.

## Goals

- Let the trace **owner** set or change a trace's title from the viewer, for
  **all** their traces (not only text imports). The title persists.
- Replace the misleading "0s" Active Time on text-import traces with a clear
  "not available for text imports" message. (Deducing a real number is out of
  scope for now; we just stop showing a wrong value.)

## Non-goals

- No server-side title derivation at ingest (title stays NULL until an owner
  sets one; the viewer keeps its existing client-side fallback).
- No duration/heuristic estimation of active time.
- Feeding the custom title into SEO/OpenGraph tags is a possible later
  follow-up, not part of this change.

## Current state (verified)

- Title display: `Hero.tsx:181` -> `<h1>{meta.aiTitle || "Untitled session"}</h1>`.
  `meta.aiTitle` is set only from `ai-title` JSONL records (`parser.ts:160`).
- Active Time: `Outcome.tsx:180-184` -> `StatCell` value
  `fmtDurationCompact(meta.assistantThinkMs)`, sub `wall: <fmtDuration(wall)>`.
- Source flag: text imports set `meta.sourceFormat === "terminal"`
  (`parser.ts:181`); `Outcome` already receives `session.meta`.
- Storage: the `Trace` model (`storage/models.py`) and `TraceSummary`
  (`api/schemas.py`) have **no** title column/field.
- Owner edit path exists: `patch_trace` (`api/traces.py:482`) is owner-gated and
  takes a `TracePatch`; the frontend has `patchTrace()` (`api.ts:177`) and a
  `TraceManageMenu`. `TraceView.tsx:79` computes `isOwner` and owns the
  `head.trace` state via `setHead`.

## Feature A: Editable title (owner-only, inline pencil, all traces)

### Storage
- Add a nullable `title` column to `Trace` (`Text`, `nullable=True`,
  default `NULL`). Add an Alembic migration mirroring the style of the existing
  `source_format` / `agents` column additions. Existing rows default to `NULL`.

### Backend API
- `TraceSummary`: add `title: str | None = None`; populate it in `_to_summary`.
- `TracePatch`: add `title: str | None = None`.
- `patch_trace`: in the existing owner-gated branch, when `title` is in
  `model_fields_set`, normalize and store it:
  - strip surrounding whitespace;
  - reject titles longer than 200 chars with HTTP 400;
  - empty string after trim -> store `NULL` ("reset to default").
- Ownership is already enforced (non-owner -> 403; unknown -> 404).

### Frontend types
- Add `title: string | null` to `TraceSummary` and `title?: string | null` to
  `TracePatch` in `frontend/src/types.ts`.

### Viewer (inline edit)
- Title precedence in `Hero`: `trace.title || meta.aiTitle || "Untitled session"`.
- For owners, render a small pencil button next to the `<h1>` (aria-label
  "Edit title"). Clicking swaps the heading for an inline text input
  (placeholder "Add a title", pre-filled with `trace.title ?? ""`) plus Save and
  Cancel buttons.
  - Save -> `patchTrace(shortId, { title })`, then propagate the returned
    `TraceSummary` up so the heading and any owner UI re-render. Enter saves,
    Escape cancels. Disable while the request is in flight; surface errors
    inline.
- Plumbing: pass `canEdit` (= `isOwner`) and `onTraceUpdated` from
  `TraceView` -> `TraceViewer` -> `Hero`. `onTraceUpdated` reuses the same
  `setHead({ kind: "ready", trace })` the manage menu's `onUpdated` already uses,
  so title edits and association/visibility edits stay consistent.

## Feature B: Active Time on text imports

- Pure presentational change in `Outcome.tsx`. When
  `meta.sourceFormat === "terminal"`, render the Active Time `StatCell` as:
  - value: `"n/a"`
  - sub: `"not available for text imports"`
  and omit the `wall:` line. All other cells (Turns, Tool calls) are unchanged.
- No parser, schema, or storage changes. Works for already-uploaded text
  traces automatically.

## UI copy (no em-dashes, per project convention)

- Pencil button aria-label: "Edit title"
- Input placeholder: "Add a title"
- Buttons: "Save", "Cancel"
- Active Time sub on text imports: "not available for text imports"

## Testing

- Backend (`env/bin/pytest`):
  - `patch_trace` sets `title`; round-trips through `TraceSummary`.
  - empty string resets `title` to `NULL`.
  - over-length title rejected with 400.
  - non-owner cannot set title (403).
- Frontend (vitest):
  - `Hero` prefers `trace.title` over `meta.aiTitle`/"Untitled session".
  - owner sees the pencil; non-owner does not.
  - inline save calls `patchTrace` and updates the heading.
  - `Outcome` shows "not available for text imports" for `sourceFormat ===
    "terminal"`, and a normal duration otherwise.

## Files touched

- `backend/app/storage/models.py` (+ new Alembic migration under
  `backend/alembic/versions/`)
- `backend/app/api/schemas.py`
- `backend/app/api/traces.py`
- `frontend/src/types.ts`
- `frontend/src/api.ts` (no change expected; `patchTrace` already passes
  arbitrary `TracePatch`)
- `frontend/src/routes/TraceView.tsx`
- `frontend/src/components/trace/TraceViewer.tsx`
- `frontend/src/components/trace/Hero.tsx`
- `frontend/src/components/trace/Outcome.tsx`
- styles for the inline title editor (viewer.css)
- tests (backend + frontend)
