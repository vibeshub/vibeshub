# Changes view: chapter narrative design

Date: 2026-06-12
Status: Approved (autonomous session; user asked to "rethink how a git diff
will look like in the age of vibe coding" and implement)

## Problem

The Changes view (spec 2026-06-11) renders a flat, file-grouped net diff. Three
issues surfaced in real use:

1. **The chapter rail is dead in Changes mode.** `ChapterRail` anchors to
   `chapter-<uuid>` dividers that only exist inside the Conversation thread.
   In Changes mode clicking a chapter does nothing, and the active-chapter
   highlight never updates. ("Chapters do not look right and do not scroll.")
2. **The file index strip is a wall of paths.** With 20+ files the wrapping
   strip of monospace paths reads as noise, not navigation.
3. **New-file diffs are walls of green.** A freshly written 100+ line file
   renders in full, drowning the rest of the view.

## The rethink

A vibe-coded session has no commits; its natural unit of change is the
*chapter* (from the AI digest). So the diff becomes a **chaptered changelog**:
each chapter reads like a commit, with the digest title and caption as the
commit message, a diffstat, and the file changes made during that chapter,
still captioned by the prompts that produced them.

The chapter rail then indexes exactly what the column shows, in both modes.

## Design

### Data layer (`changes.ts`)

- Extract the op-collection walk shared by both builders. Each `EditOp` gains
  `streamPos`: the main-stream index of its tool event, or of the spawning
  Task event for subagent edits (`-1` when unattributable).
- New `buildChapterChanges(stream, subagents, chapters): ChapterChange[]`:

  ```ts
  interface ChapterChange {
    anchorUuid: string;
    title: string;
    caption: string;
    ordinal: number;   // 1-based, matches rail numbering
    adds: number;      // surviving hunks in this chapter
    dels: number;
    files: FileChange[];
  }
  ```

- Chapter assignment: resolve anchor uuids to stream positions (same approach
  as `chapterMetrics`); an op belongs to the last chapter whose anchor
  position is <= its `streamPos`. Ops before the first anchor (and
  unattributable subagent ops) belong to the first chapter.
- The supersede pass stays **global per file** across the whole session, so a
  chapter-2 hunk rewritten in chapter 6 shows as a superseded stub inside
  chapter 2. The narrative keeps its dead ends visible but collapsed.
- Per-chapter `FileChange.kind` is `"new"` only in the chapter containing the
  file's first touch (when globally new); later chapters show it as `mod`.
- Chapters with no resolved anchor or no edits are returned with `files: []`
  so ordinals and rail rows stay aligned; the body skips them.
- `changesChapterAnchorId(uuid)` = `changes-chapter-<uuid>` (distinct from the
  conversation's `chapter-<uuid>` divider ids).
- `buildFileChanges` is unchanged in behavior; it remains the source for
  `hasChanges`, the fallback layout, and the file index list.

### Changes column (`ChangesView`)

Top to bottom:

1. **Summary header** (replaces the always-open index strip): one quiet line,
   `N files changed  +A  −D`, with a thin add/del ratio bar, and a "show
   files" toggle that expands the existing per-file index list (collapsed by
   default). File links jump to the first card for that path.
2. **Chapter sections** (when digest chapters exist): each section carries
   `id=changes-chapter-<uuid>`, a header (ordinal, title, per-chapter
   diffstat, a small "view in conversation" jump), the digest caption in
   faint type, then the chapter's `FileChangeCard`s.
3. **Flat fallback** (no digest): file cards exactly as today.

Only the first card for a path carries the `change-<path>` anchor id, so the
file index always jumps to the first occurrence.

### Large hunk collapse (`FileChangeCard`)

Hunks above ~34 rows render the first 24 with a `show N more lines` expander
(and a collapse control once open). Applies to the Changes view only; the
conversation tool cards keep their existing rendering. `DiffView`'s 800-row
cap remains the hard ceiling.

### Rails

- `ChapterRail` gains `mode` and per-chapter diffstats. In changes mode:
  rows show `+a −d` instead of tool-count and duration, the bar is the
  chapter's share of total churn, empty chapters render faint and disabled,
  clicks anchor to `changes-chapter-<uuid>`, and the IntersectionObserver
  watches those sections (`scroll-margin-top: 140px`, same band as the
  conversation observer).
- New `FilesRail` covers Changes mode on traces without a digest: same rail
  shell and classes, one row per file (basename, dimmed parent path, +/-),
  anchored to the file cards. PromptRail keeps serving Conversation mode.

### Out of scope (unchanged non-goals)

True patch-algebra net composition, verification badges, and GitHub-side
diffs stay out. This remains a trace-native summary.

## Future: artifacts worth uploading

The trace can only show what flowed through Write/Edit tools. Three uploads
would make this view materially better, in order of value:

1. **Repo state markers**: `git rev-parse HEAD`, branch, and dirty-file list
   at session start and end (headers or a small JSON artifact). Lets the view
   label the diff "from abc123 to def456" and link real commits.
2. **End-of-session `git diff`** (against the start marker): the ground truth
   net diff. Catches edits the trace cannot see (sed/codegen/formatters run
   via Bash) and enables a "verified against repo" treatment per file.
3. **Commit log for the session span** (`git log start..end --format=...`):
   aligns chapters with actual commits when the session committed as it went.

These require plugin + ingest changes and are deliberately not part of this
frontend-only iteration.
