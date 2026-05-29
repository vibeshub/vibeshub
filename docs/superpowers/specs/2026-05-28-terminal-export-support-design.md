# Terminal text-export (`.txt`) support — Design

**Status**: draft, pending implementation
**Date**: 2026-05-28
**Branch**: `feature/terminal-export-support`

## 1. Purpose

Claude Code ships a built-in "export" action that produces a rendered
*terminal* transcript as a `.txt` file (e.g.
`2026-05-28-...-photoslibr.txt`): the ASCII banner, then glyph-prefixed lines
(`❯` user prompts, `⏺` assistant text / tool headers, `⎿` collapsed tool
results, `✻` think-time summaries, `※` recaps). Some users reach for this
default export and then try to share it on vibeshub.

Our viewer pipeline is built entirely on the structured `.jsonl` session file
(`parseJsonl` → `buildSession`), where every line is a JSON record carrying
`timestamp`, `uuid`, `message.id`, token `usage`, `model`, typed content blocks
(`text` / `thinking` / `tool_use` / `tool_result`), full tool I/O,
slash-command tags, PR-link and hook records. The `.txt` is a lossy
presentation-layer rendering of that data and contains almost none of those
structured fields.

This spec adds a **best-effort convenience path** that lets a user upload the
`.txt` and still get a viewable trace. `.jsonl` remains the primary, full-
fidelity input; `.txt` is explicitly a degraded fallback.

## 2. Non-goals

- Replacing `.jsonl` as the primary input. It stays primary and unchanged.
- Recovering data the `.txt` does not contain: per-message tokens, timestamps,
  the model ID, thinking content, message/tool UUIDs, untruncated tool I/O,
  subagent interiors. These are accepted as permanently lost for this path.
- A second redaction implementation. We reuse the existing byte-level
  `redact_jsonl` patterns on the raw `.txt`.
- A second view path. The converted trace renders through the **existing**
  `buildSession` + viewer with no changes to the render path.
- Backend re-conversion of the stored raw `.txt`. We *store* the raw `.txt`
  (§5) so a future, improved converter can re-parse it, but building that
  re-conversion job is out of scope here.
- Parsing subagent panes, `EnterWorktree`/`Task` interiors, or hook/progress
  rows from the `.txt` (they are not present in the rendered output).

## 3. Architecture & data flow

Conversion happens **once, on the frontend at upload time**, reusing our
TypeScript parser knowledge (no Python re-implementation). It produces a
*synthetic `.jsonl`* that is the canonical viewable artifact and rides the
existing upload → redact → store → view pipeline untouched. The raw `.txt` is
sent alongside purely as an archival copy.

```
Frontend (UploadPage)                  Backend (/api/uploads)        Frontend (TraceView)
─────────────────────                  ──────────────────────        ────────────────────
.txt selected
  │
  ├─ parseTerminalExport(text)
  │     → synthetic records[]
  │     → serialize to .jsonl  ──┐
  │                              ├─► transcript (synthetic .jsonl) ─► redact (redact_jsonl)
  └─ keep raw bytes ─────────────┴─► source_export (raw .txt) ─────► redact (same patterns)
                                                                       │
                                                       blob: {prefix}main.jsonl       ── unchanged
                                                       blob: {prefix}source_export.txt ── new
                                                       trace.source_format = "terminal" (new col)
                                                                       │
                                            GET /api/traces/<sid> → body.jsonl (the synthetic one)
                                                                       │
                                            buildSession(parseJsonl(body.jsonl))  ── UNCHANGED
                                            + viewer shows "Imported from text export" chip
```

`.jsonl` uploads are completely unaffected: `source_export` is absent,
`source_format` is null, no chip.

## 4. The converter — `parseTerminalExport(text): AnyRec[]`

New module `webapp/frontend/src/components/trace/terminalExport.ts`. It emits
records in the **exact shape `buildSession` already consumes**, so the work is
literally fitting the `.txt` into the existing parser. It also exports
`looksLikeTerminalExport(text): boolean` (banner / glyph sniff) for upload
detection.

### 4.1 Line → record mapping

| `.txt` construct | Synthetic record emitted |
|---|---|
| Banner lines (`Claude Code v2.1.156`, `Opus 4.8`, `~/git/vibeshub`) | one marker record `{type:"terminal-meta", version, cwd, modelLabel, source:"terminal"}` consumed in `buildSession` pass 1 |
| `❯ <text>` (+ 2-space continuation lines) | `{type:"user", message:{content:"<rejoined text>"}}` |
| `❯ /resume` (leading slash) | same user record; leading `/` renders as a prompt (command-chip styling optional, not required) |
| `⏺ <prose>` (+ continuation) | `{type:"assistant", message:{id, content:[{type:"text", text}]}}` |
| `⏺ <Tool>(<args…>)` e.g. `Bash(...)`, `Update(...)`, `Skill(...)` | `{type:"assistant", message:{id, content:[{type:"tool_use", id:"term-N", name, input}]}}` |
| `⏺ Read 5 files`, `Searched for 1 pattern, read 2 files` (summary forms, no parens) | `tool_use` with `name` inferred and `input:{}` (no recoverable args) |
| `⎿ <result>` / `… +N lines (ctrl+o to expand)` / `Read 3 files` (indented under a tool) | `{type:"user", message:{content:[{type:"tool_result", tool_use_id:"term-N", content:"<verbatim, truncation included>"}]}}` |
| Inline numbered diff under `Update`/`Write` | folded into that tool's `tool_result` content verbatim (truncation kept) |
| `✻ Baked for 39m 50s`, `※ recap: …`, blank announcement line | dropped (no content); may optionally emit a subdued `system_text` but default is drop |

### 4.2 Tool ↔ result correlation

The `.txt` has no IDs. The converter assigns each `⏺ Tool(...)` a synthetic
`id = "term-<n>"` (monotonic) and attaches the immediately following `⎿`
block(s), up to the next `⏺`/`❯`, as that tool's `tool_result` keyed to the
same id. `buildSession`'s existing `toolResultsById` map then links them with
no parser change.

Each emitted assistant record also gets a **unique** synthetic
`message.id` (e.g. `term-msg-<n>`, one block per record). This is load-bearing:
`buildSession` dedupes assistant blocks by `${msgId}|${blockIdx}|${blockType}`,
so reusing an id across two text/tool blocks would silently drop the second.

### 4.3 Line-wrap rejoining (lossy, accepted)

Terminal output hard-wraps at the pane width with 2-space continuation indents.
Soft wraps cannot be distinguished from intentional newlines, so the converter
de-indents continuation lines and rejoins wrapped runs with a single space.
This is imperfect (a wrapped file path may gain a space) and accepted for this
path. Code/diff blocks under `⎿` are kept as-is (not rejoined).

### 4.4 Fidelity boundary

Not recovered: tokens (→ 0), timestamps (→ `startedAt`/`endedAt`/durations
null/0), model ID (only the banner label is stored, see §6), thinking content,
real UUIDs, untruncated tool I/O. `buildSession` already tolerates all of this:
its meta fields are null-safe and it has a no-`turn_duration` duration fallback
(which will also yield 0 here, since there are no timestamps).

### 4.5 Empty-recovery guard

If conversion yields no user prompts and no assistant events, the upload is
**not** sent. The uploader instead shows guidance to upload the `.jsonl`
(`~/.claude/projects/<encoded-cwd>/<session>.jsonl`) for a full trace. This
prevents storing empty husks when the export format drifts.

## 5. Storing the raw `.txt` (backend)

The raw `.txt` is kept so an improved converter can re-parse it later without
asking the user to re-upload. It must be scrubbed before storage (it can carry
secrets), reusing the existing patterns.

- **api.ts** `uploadTrace`: new optional `sourceExport?: File`; when present,
  append form field `source_export`.
- **`/api/uploads`**: new param `source_export: UploadFile | None = File(None)`.
  Read bytes, count toward `max_trace_bytes`, redact via `redact_jsonl` (the
  function is byte-level `pattern.sub`, so it applies unchanged to `.txt`), and
  pass the redacted bytes + `source_format="terminal"` to the service.
- **`create_or_update_trace`**: new optional `source_export_bytes: bytes | None`
  and `source_format: str | None`. When `source_export_bytes` is present,
  `await blob_store.put(f"{blob_prefix}source_export.txt", source_export_bytes)`.
  Set `trace.source_format`.
- **Model / migration**: add nullable `source_format: str | None` column to the
  trace model (Alembic migration). `None` for all existing and `.jsonl` traces.
  The raw blob is addressed by convention (`{prefix}source_export.txt`); no
  extra column needed to locate it.

Redaction of the two artifacts is independent but uses identical patterns, so
the same secret is scrubbed in both.

## 6. Provenance surfacing (frontend)

- The `terminal-meta` marker record (§4.1) is read in `buildSession` pass 1 into
  two new `SessionMeta` fields: `sourceFormat: "terminal" | null` and the banner
  `modelLabel` (used only for display, never confused with the real `model` ID,
  which stays null).
- The viewer renders a small chip in the meta panel when
  `meta.sourceFormat === "terminal"`. Copy (no em-dashes, per house style):
  - chip label: `Imported from text export`
  - tooltip: `Reconstructed from a Claude Code text export. Token counts, timings, and thinking are not available.`

`source_format` on the trace row also lets future tooling find re-convertible
traces.

## 7. Testing

**Frontend** (`webapp/frontend/src/tests/trace/terminalExport.test.ts`), using
the shared sample `.txt` as a fixture:
- prompts are detected and continuation lines rejoined into one prompt string;
- assistant text blocks are emitted in order;
- the tool timeline preserves order and tool names (`Skill`, `Bash`, `Update`,
  `Write`, `Read` summary forms);
- truncated results (`… +N lines`, `Read 3 files`) are preserved verbatim;
- banner → `terminal-meta` → `meta.sourceFormat === "terminal"` + `modelLabel`.
- Round-trip: `buildSession(parseJsonl(serialize(parseTerminalExport(sample))))`
  returns a sane `Session` (userPromptCount > 0, toolCallCount > 0, no throw),
  with tokens 0 and durations 0.
- `looksLikeTerminalExport` returns true for the sample, false for a real jsonl.
- Empty-recovery guard: a `.txt` with only a banner yields the guidance path.

**Backend** (`webapp/backend/tests/`):
- `source_export.txt` is stored under the prefix when provided, absent otherwise;
- an `sk-ant-…` token present in the raw `.txt` is `[REDACTED:anthropic_key]`
  at rest in the stored `source_export.txt` blob;
- `trace.source_format == "terminal"` is persisted; migration up/down works.

## 8. Blast radius

**Untouched**: `buildSession` core logic, the viewer render path, `TraceView`,
the nested-subagent parser (`AgentBody`), `Outcome`, redaction internals, the
blob store interface, `.jsonl` upload behavior.

**New / changed**:
- new `terminalExport.ts` (+ test) — the only substantial new code;
- `parser.ts`: read the `terminal-meta` marker into two new `SessionMeta`
  fields (additive, null-safe);
- `UploadPage.tsx`: `accept=".jsonl,.txt"`, detect + convert + attach raw on
  submit, empty-recovery guidance;
- `api.ts`: optional `sourceExport` form field;
- backend: `uploads.py` param + redact + thread-through; `trace_service.py`
  store blob + set column; one Alembic migration; viewer chip + copy.
