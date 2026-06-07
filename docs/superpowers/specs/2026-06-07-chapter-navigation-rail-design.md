# Chapter navigation rail — Design

**Status**: draft, pending implementation
**Date**: 2026-06-07
**Branch**: `feature/chapter-navigation-rail`

## 1. Purpose

The trace digest (shipped in `2026-06-06-trace-digest-agent-design.md`) produces semantic "chapters" that anchor to events in the trace. Today those chapters surface in two disconnected places:

1. The amber "JUMP TO" chip row inside `DigestPanel` at the top of the hero (titles only).
2. Inline `ChapterDivider`s in the thread (title + caption).

Meanwhile the persistent left rail (`PromptRail`) navigates by **user prompts**, a mechanical boundary that often does not match the real structure of the session. On a representative trace (`5vru4udkxz`) there are **6 chapters but only 2 prompts**: the richer story is the one that is *not* persistently navigable, and the chapter navigation that does exist (the digest chips) scrolls out of view the moment you enter the thread.

This spec makes chapters the **navigation spine**: the left rail becomes a chapter rail when chapters exist. Each row also encodes how much work happened in that phase (a duration bar plus exact tool-count and duration), so the same rail doubles as an at-a-glance **story arc**. Clicking a chapter scrolls the full thread to it.

The change is **frontend-only**. No backend, schema, or digest-pipeline change.

### 1.1 Real arc from trace `5vru4udkxz`

Computed by walking the stream between consecutive chapter anchors; durations sum to the 7.5m active time already shown on the page.

| # | Chapter | Tool calls | Duration |
|---|---------|-----------|----------|
| 1 | Inspect digest code | 8 | 1m49s |
| 2 | Diagnose theme break | 7 | 3m05s (longest) |
| 3 | Apply design fix | 2 | 16s (shortest) |
| 4 | Verify implementation | 3 | 33s |
| 5 | Visual preview | 7 | 1m17s |
| 6 | Branch and push | 3 | 29s |

A genuine arc: long diagnosis, fast fix, careful verify. The rail makes that legible without reading.

## 2. Non-goals

- **Compact view.** A toggle that collapses the thread to chapters only was explored and explicitly cut to keep this change small. Chapters open by jumping into the full thread, not by an in-place accordion. Revisit later as its own spec if wanted.
- **Backend / schema / pipeline changes.** Per-chapter duration and tool count are derived in the browser from the already-loaded session stream. The `Digest` shape (`anchor_uuid`, `title`, `caption`) is unchanged.
- **Replacing the prompt rail concept.** `PromptRail` stays and is the fallback for chapter-less traces. This is not a deletion, it is a demotion to fallback.
- **The top `JumpStrip`.** The horizontal prompt strip in the viewer header is left as-is for now.
- **URL-hash deep-linking to a chapter.** Out of scope, same as the digest spec.
- **Editing or regenerating chapters.** Read-only navigation over what the digest produced.

## 3. Current state

```
TraceViewer
├── viewer-header (sticky)
│   ├── ViewerTopbar
│   └── JumpStrip                 # horizontal, PROMPTS, only if >=2 prompts
├── Hero
│   └── DigestPanel               # 5 bullets + "JUMP TO" CHAPTER chips  ← chips removed
├── viewer-body
│   ├── PromptRail                # sticky left aside, PROMPTS            ← replaced when chapters exist
│   └── viewer-main
│       ├── ThreadControls
│       └── Thread
│           └── ChapterDivider    # inline, at each anchor event          ← stays (scroll targets)
```

Relevant files:

- `components/trace/PromptRail.tsx` — the pattern the new rail mirrors (IntersectionObserver current-tracking, click-to-jump, sticky scroll container).
- `components/trace/Thread.tsx` — emits inline `ChapterDivider`s; wraps events as `<div id="evt-<uuid>">`.
- `components/trace/ChapterDivider.tsx` / `.module.css` — the inline divider.
- `components/trace/DigestPanel.tsx` / `.module.css` — owns the "JUMP TO" chip row to be removed.
- `components/trace/TraceViewer.tsx` — chooses what renders in `viewer-body`.
- `styles/viewer.css` — `.promptrail*` layout (sticky aside, scroll container); the new `.chapterrail*` rules live alongside.
- `types.ts::TraceDigest` / `DigestChapter` — already define the chapter shape.

## 4. Design

### 4.1 New component: `ChapterRail`

`components/trace/ChapterRail.tsx`, a structural sibling of `PromptRail`. Props:

```ts
interface Props {
  session: Session;
  digest: TraceDigest;   // caller guarantees digest.chapters.length > 0
}
```

Render: a sticky left `<aside>` mirroring the `.promptrail` layout, with a head (`CHAPTERS · N`) and one row per chapter. Each row:

```
[n]  Inspect digest code
     ▓▓▓▓▓▓░░░░░   8t · 1m49s
```

- `[n]` — 1-based index, monospace, faint.
- title — single line, ellipsis on overflow.
- magnitude bar — track + fill; **fill width = chapter duration / max chapter duration** (longest chapter = 100%).
- meta — `<tools>t · <duration>` in mono/faint. `8t` = 8 tool calls. Duration formatted `1m49s` / `33s`.
- The caption is **not** shown in the rail (it already lives in the inline divider and the digest panel; keeping the rail to title + bar honors the low-clutter house style). No native `title` tooltip (a native tooltip was removed in #117 for overlapping layout).

The current chapter row gets the `.cur` treatment (left accent + soft amber background), consistent with `.promptrail-item.cur`.

### 4.2 Per-chapter metrics (browser-side)

A pure helper, e.g. `components/trace/chapterMetrics.ts`:

```ts
interface ChapterMetric {
  anchorUuid: string;
  toolCount: number;
  durationMs: number | null;   // null when timestamps are unavailable
}
function chapterMetrics(stream: StreamEvent[], chapters: DigestChapter[]): ChapterMetric[];
```

Algorithm (single pass, easy to unit-test):

1. Build `index: Map<uuid, streamIndex>` from `stream`.
2. For each chapter in order, resolve its anchor's stream index. A chapter whose anchor is not found in the stream is dropped from the rail (defensive; the pipeline already validates anchors against the distilled surface, but the rendered stream is a different surface).
3. A chapter spans `[start, nextStart)` where `nextStart` is the next resolved anchor index, or `stream.length` for the last chapter. Spans are computed from the **sorted** resolved indices so out-of-order anchors do not produce negative spans.
4. `toolCount` = count of `kind === "tool_use"` events in the span.
5. `durationMs` = `ts(nextAnchorEvent) - ts(thisAnchorEvent)`; for the last chapter, `ts(last event in span with a timestamp) - ts(thisAnchorEvent)`. `ts` parses `e.ts` (ISO) via `Date.parse`. If either endpoint lacks a timestamp, `durationMs = null`.

**Bar width source**, in order of availability: duration → tool count → equal widths. If *no* chapter has a duration (older traces without timestamps), bars fall back to tool-count proportion, and the meta shows `8t` only (no `· duration`). This keeps the rail meaningful on degraded data.

### 4.3 Scroll target: chapter divider id

The rail must scroll to and observe a stable element. Today `DigestPanel` jumps to `#evt-<uuid>`, but that element is **not emitted when the anchor is a `tool_use` inside a collapsed tool group** (the default), because `Thread` only routes `tool_use` through `pushEvent` (which emits the divider and `evt-` wrapper) when `expandToolCalls` is on. That is a latent gap in the current chapter feature.

Fix as part of this work so the rail is reliable:

1. `Thread.tsx`: ensure a `ChapterDivider` is emitted at a chapter anchor **even when that anchor is a `tool_use` in a collapsed run**. In the `tool_use` branch, before pushing into `pendingRun`, if the event's uuid is a chapter anchor, `flushRun()` and emit the divider, then continue grouping. (Prompts, assistant text, thinking already pass through `pushEvent`, so only the collapsed-tool-use case needs this.)
2. `ChapterDivider` gets a stable id: `id="chapter-<anchor_uuid>"`, and `scroll-margin-top` equal to the sticky header height so `scrollIntoView` lands the heading below the sticky `viewer-header` rather than under it.
3. The rail's click handler and IntersectionObserver target `#chapter-<uuid>` (the divider), decoupling navigation from the `evt-` wrappers entirely.

### 4.4 Current-chapter tracking

Reuse the `PromptRail` IntersectionObserver pattern, observing the `#chapter-<uuid>` divider elements instead of prompt bubbles: the current chapter is the divider nearest the top of the active band (`rootMargin` tuned as in `PromptRail`). Because chapters are sparse sections rather than many short bubbles, if the highlight feels like it jumps ahead while deep inside a long chapter, switch to scrollspy-by-last-passed-divider (current = the last divider whose top is above the header offset). The active row auto-scrolls into view inside the rail's own scroll container, exactly as `PromptRail` does, never scrolling the document.

### 4.5 Click to jump

Clicking a row scrolls the thread to that chapter's divider: `document.getElementById("chapter-" + uuid)?.scrollIntoView({ behavior: "smooth", block: "start" })`. With `scroll-margin-top` on the divider (§4.3.2), the heading clears the sticky header.

### 4.6 Wiring in `TraceViewer`

```tsx
{empty ? ... : (
  <div className="viewer-body">
    {trace.ai_digest?.chapters?.length
      ? <ChapterRail session={session} digest={trace.ai_digest} />
      : <PromptRail session={session} />}
    <div className="viewer-main"> ... </div>
  </div>
)}
```

Automatic, no toggle. Chapters when present, prompts otherwise.

### 4.7 `DigestPanel` cleanup

Remove the "JUMP TO" rail (`railLabel` + `chapters` block, the `onJump` handler, and the now-unused styles) from `DigestPanel.tsx` / `.module.css`. The panel keeps its five bullets. Chapter navigation is now owned solely by the rail, removing the duplication. `DigestPanel` no longer reads `digest.chapters`.

### 4.8 Styling

Add `.chapterrail*` rules to `styles/viewer.css` next to `.promptrail*`, reusing the same sticky aside width and scroll-container behavior. The magnitude bar uses the existing accent tokens (`--accent` fill on a `--bg-subtle` / `--border-subtle` track) so it matches the digest chip language and stays correct in dark mode. Meta and index use `--font-mono` + `--text-faint`.

## 5. State / fallback chart

| Trace state | Left rail | DigestPanel | Inline dividers |
|---|---|---|---|
| Digest present, chapters present | **ChapterRail** | 5 bullets (no chips) | rendered |
| Digest present, chapters empty | PromptRail | 5 bullets (no chips) | none |
| Digest absent | PromptRail | not rendered | none |
| Chapters present but timestamps missing | ChapterRail, bars = tool-count, meta = `Nt` only | 5 bullets | rendered |

## 6. Testing

Frontend (`vitest` + jsdom), matching existing trace component tests.

### 6.1 `chapterMetrics.test.ts`
- Spans: contiguous chapters partition the stream correctly; last chapter runs to stream end.
- Tool count: only `tool_use` events counted within a span.
- Duration: computed from anchor timestamps; `null` when an endpoint lacks `ts`; whole-rail fallback to tool-count when no chapter has a duration.
- Missing anchor: a chapter whose anchor uuid is absent from the stream is dropped, remaining spans stay correct.
- Out-of-order anchors: sorting prevents negative spans.

### 6.2 `ChapterRail.test.tsx`
- Renders one row per chapter with index, title, and meta.
- Bar fill width is proportional to the longest chapter's duration (longest = 100%).
- Click invokes `scrollIntoView` on `#chapter-<uuid>`.
- Degraded data (no timestamps): meta shows `Nt` only, bars still render from tool-count.

### 6.3 `Thread.test.tsx` (extend)
- A `ChapterDivider` with `id="chapter-<uuid>"` renders at the anchor even when the anchor is a `tool_use` in a **collapsed** group (`expandToolCalls=false`) — the gap fixed in §4.3.

### 6.4 `TraceViewer.test.tsx` (or `TraceView.test.tsx`)
- Chapters present → `ChapterRail` renders, `PromptRail` does not.
- Chapters empty / digest absent → `PromptRail` renders, `ChapterRail` does not.

### 6.5 `DigestPanel.test.tsx` (update)
- Five bullets still render.
- No "JUMP TO" chip row / chapter buttons are rendered (regression guard for the removal).

## 7. Out of scope / deferred

- Compact (chapters-only) view.
- A manual Chapters ↔ Prompts toggle in the rail. Selection is automatic in v1.
- Folding the rail into the `JumpStrip` or unifying the two top navigations.
- URL-hash deep-linking to a chapter.
