# Cursor trace support — Design

**Status**: draft, pending implementation
**Date**: 2026-06-04
**Branch**: `feature/cursor-trace-support`

## 1. Purpose

vibeshub captures, stores, and displays AI coding-agent session traces. Today
the supported agents are Claude Code and OpenAI Codex CLI. This spec adds
first-class support for **Cursor** agent traces (observed at Cursor v3.6.31),
following the exact same three-layer architecture introduced for Codex
(`2026-05-31-codex-trace-support-design.md`): one adaptive plugin uploads the
raw redacted transcript verbatim, the backend stores it as an opaque blob, and
the frontend converts it to the canonical record shape at render time.

As with Codex, the load is uneven by design:

- **Plugin**: the adaptive plugin gains a third platform. A new
  `CursorTranscriptReader` discovers Cursor's file-based agent transcript, and a
  new user-level `~/.cursor/hooks.json` install surface lets the same auto-share
  on PR + manual share flow run from inside Cursor. Almost all of
  `vibeshub_client/` is reused.
- **Backend**: near-passthrough. Accept the `cursor` platform label (free-text
  already), confirm Cursor's UUID subagent ids pass the bundle validator (they
  already do, from the Codex work), count Cursor messages, and name "Cursor" in
  link-preview SEO.
- **Frontend**: a small `cursorExport` adapter. Cursor's transcript is already
  Claude-shaped (`role` + `message.content[]` with `text` / `tool_use` blocks),
  so the converter is the lightest of the three platforms.

### 1.1 Why this shape

The same three architecture facts that made Codex low-risk apply here:

1. **The plugin is a raw-bytes passthrough.** It byte-redacts the transcript,
   tars it (main + `subagents/`), and POSTs it. It never parses the format.
2. **The backend never parses transcripts.** It stores raw redacted JSONL as a
   blob and serves it back unchanged. `platform` / `source_format` are free-text
   columns; no server-side render model exists.
3. **The frontend is the single conversion chokepoint.** `buildSessionFromRaw`
   (the chokepoint added for Codex, wired into the top-level parse, AgentBody
   expand, and Outcome streams) produces a provider-neutral `Session` model;
   every card downstream is agnostic to the source agent. `codexExport.ts` and
   `terminalExport.ts` already convert foreign formats into the canonical record
   shape. Cursor follows the same pattern, with even less work because the format
   is closer to canonical than Codex's rollout was.

### 1.2 Source selection (decided)

Two Cursor storage sources were evaluated against the live machine:

- **`~/.cursor/projects/<proj>/agent-transcripts/<uuid>/<uuid>.jsonl`** (chosen):
  a clean, file-based JSONL already in Claude shape, with a sibling
  `subagents/<uuid>.jsonl` directory. Fits the existing "upload a raw file, parse
  in the frontend" architecture with minimal new code.
- **SQLite `state.vscdb`** (`composerData` + `bubbleId` rows): rejected. On the
  live machine even SQLite does **not** persist tool results (`toolResults` empty
  on all 102 bubbles of the richest session), `tokenCount` is zero, and
  `modelInfo` is only `{"modelName":"default"}`. It would add content-addressed
  blob parsing and a version-fragile schema for near-zero fidelity gain, and it
  would break the upload-verbatim invariant (the plugin would have to assemble a
  synthetic file). See §9.

## 2. Non-goals

- **Reviving a server-side render model.** Conversion stays in the browser.
- **Reading Cursor's SQLite store.** The plugin stays purely file-based (§1.2).
  Subagent linking is content-based and needs no SQLite (§7).
- **Plain-chat-panel coverage.** Only Cursor *agent-mode* sessions write
  `agent-transcripts` files. Plain chat-panel conversations that never produced
  an agent transcript are out of scope (they live only in SQLite).
- **Fabricating data the transcript does not contain.** Cursor's agent transcript
  records assistant text, thinking, and tool *calls*, but not tool *outputs*,
  token usage, or model name. We render what is present and degrade gracefully on
  the rest (§9). We do not invent tool results or costs.
- **Backwards-compatible ingest changes.** Pre-1.0, no external users; shared
  constants change in lockstep with the Codex precedent.
- **Web upload of Cursor subagents.** The drag-upload `/vibeviewer` path accepts a
  single main-thread Cursor `.jsonl`. Subagent bundling is the CLI plugin's job;
  a web-dragged main file renders its main thread and subagent cards show "trace
  not available" gracefully, exactly as orphaned Claude/Codex subagents do.

## 3. Cursor format reference (load-bearing facts)

Verified on Cursor v3.6.31, macOS.

### 3.1 Location

```
~/.cursor/projects/<project-slug>/agent-transcripts/<session-uuid>/
    <session-uuid>.jsonl          # main transcript
    subagents/<sub-uuid>.jsonl    # one file per dispatched subagent (optional)
```

`<project-slug>` is a path-derived slug (e.g. `Users-bhavya-git-vibeshub`) or a
millisecond epoch for transient windows. The same `<session-uuid>` is also the
Cursor `composerId` in SQLite, but we do not read SQLite.

### 3.2 Record shape

Each line is a JSON object with exactly two top-level keys:

```json
{ "role": "user" | "assistant",
  "message": { "content": [ <block>, ... ] } }
```

There is **no** top-level `uuid`, `timestamp`, `usage`, `model`, or `id`.

Content blocks observed:

- `{ "type": "text", "text": "..." }`
- `{ "type": "tool_use", "name": "<ToolName>", "input": { ... } }`

No `tool_result` blocks exist anywhere in the transcript (tool outputs are not
persisted to this file). No `thinking` block type was observed in the sampled
agent transcripts, though the SQLite mirror records thinking; if a `thinking`
block type appears it maps straight through to the canonical `thinking` block.

### 3.3 Tool vocabulary (observed)

| Cursor tool        | Canonical card    |
|--------------------|-------------------|
| `Read`, `ReadFile` | FileBody          |
| `Shell`, `AwaitShell` | BashBody       |
| `Glob`, `Grep`     | search (existing) |
| `WebSearch`, `WebFetch` | GenericBody  |
| `Task`, `Subagent` | AgentBody         |

`Task` / `Subagent` input is `{ subagent_type, description, prompt, [readonly],
[run_in_background] }` — close enough to Claude's Task input that AgentBody
renders it directly. Unknown future tools fall back to `GenericBody`.

### 3.4 User-message envelope

Real user turns wrap their text in an envelope:

```
<timestamp>Wednesday, Jun 3, 2026, 7:30 PM (UTC-7)</timestamp>
<user_query>
...actual prompt...
</user_query>
```

- The `<timestamp>` tag appears only on real user turns (7 of 19 user records in
  the sample), never on assistant records. Format:
  `%A, %b %d, %Y, %I:%M %p (UTC±N)`, minute precision, with a UTC offset.
- The converter strips `<user_query>` / `<timestamp>` wrappers from the displayed
  user text and uses the parsed timestamp for timing (§10).

### 3.5 Subagents

- A subagent transcript is a full `<sub-uuid>.jsonl` in the same record shape.
- The main transcript references subagents only through `Task` / `Subagent`
  tool_use blocks, which carry **no id**. `composerData.subComposerIds` is empty.
  Linking is therefore content-based (§7).
- Subagent count equals `Task`/`Subagent` dispatch count in both sampled
  multi-subagent sessions.

## 4. Plugin

### 4.1 `cursor_reader.py` — `CursorTranscriptReader`

Mirrors `codex_reader.py::CodexTranscriptReader`.

```python
class CursorTranscriptReader(TranscriptReader):
    def platform_id(self) -> str: return "cursor"

    def find_session_paths(self, hook_input) -> SessionPaths:
        # 1. If the Cursor hook input names the session/conversation id, resolve
        #    ~/.cursor/projects/*/agent-transcripts/<id>/<id>.jsonl.
        # 2. Else: newest agent-transcripts/*/*.jsonl by mtime under
        #    ~/.cursor/projects (sibling subagents/ dir if present).
        ...
        return SessionPaths(main_jsonl=main, subagents_dir=<sibling subagents/ or None>)

    def link_subagents(self, paths, hook_input) -> list:
        return link_cursor_subagents(paths.main_jsonl, paths.subagents_dir)
```

`SessionPaths(main_jsonl, subagents_dir)` is the existing Claude shape, so
`bundle.py` already tars a main file plus a subagents directory unchanged.

### 4.2 `platform_adapter.py`

Add a Cursor branch to `select_adapter`. Strongest signal first:

```python
tp = payload.get("transcript_path") or ""
if "/.codex/sessions/" in tp: return CodexTranscriptReader()
if "/.cursor/projects/" in tp: return CursorTranscriptReader()
if "/.claude/" in tp: return ClaudeCodeTranscriptReader()
if env.get("CODEX_HOME"): return CodexTranscriptReader()
if env.get("CURSOR_TRACE_ID") or <cursor hook signal>: return CursorTranscriptReader()
return ClaudeCodeTranscriptReader()
```

The exact Cursor hook-input key (e.g. a conversation id or `cwd` plus a Cursor
marker) is confirmed during implementation against a live Cursor hook payload;
the newest-by-mtime fallback in 4.1 keeps the path working if the key is absent.

### 4.3 `cursor_subagent_link.py` — `link_cursor_subagents`

See §7. Pure file logic, no SQLite. Produces the same subagent metadata list
shape the bundle expects (subagent id = file stem uuid, description, type).

### 4.4 Cursor install surface (user-level)

Ship a user-level `~/.cursor/hooks.json` (schema version 1) and an install step
that points it at the plugin root, mirroring the `.claude-plugin` /
`.codex-plugin` marketplace manifests:

```json
{
  "version": 1,
  "hooks": {
    "afterShellExecution": [
      { "command": "python3 \"<plugin-root>/hooks/on-pr-share.py\"",
        "matcher": "git\\s+push" }
    ]
  }
}
```

- `afterShellExecution` is Cursor's analogue of Claude's `PostToolUse` on `Bash`;
  it fires after terminal commands, so a `git push` that opens a PR triggers the
  same auto-share path. (A `postToolUse` matcher `Shell` is the alternative if a
  shell-command matcher proves unreliable; start without a matcher, tighten
  after it fires, per Cursor's create-hook guidance.)
- The manual `/share-trace` command is exposed as a Cursor-invocable command
  (Cursor supports skills/commands) running the existing `share-trace.py`.
- `on-pr-share.py` learns Cursor's hook-input JSON shape (keys differ from
  Claude/Codex) to extract `cwd` and any session id; everything else is reused.
- Platform label `"cursor"` is threaded into the upload header
  (`X-Vibeshub-Platform`) and the PR comment, exactly as `codex` is.

### 4.5 Distribution

Add the Cursor install target to the repo's marketplace metadata so a user can
install the vibeshub plugin into Cursor once per machine (user-level). No
per-repo `.cursor/hooks.json` is required.

## 5. Backend (additive, no migration)

- **`message_count.py`**: add a Cursor branch. Cursor records are
  `{role, message.content[]}`; count user turns and assistant turns (assistant
  records that contain `text` or `tool_use`) consistent with how Claude/Codex
  counts map to the displayed message total.
- **SEO / OG head**: per-trace head names the actual agent ("Cursor" when
  `platform == "cursor"`), alongside the existing Claude Code / Codex CLI names.
- **Bundle validator**: Cursor subagent files are `<uuid>.jsonl`; the validator
  already accepts UUID subagent ids (added for Codex) and is traversal-safe.
  Add a regression guard asserting a Cursor bundle (`platform=cursor` + UUID
  subagents) round-trips through ingest.

## 6. Frontend

### 6.1 `cursorExport.ts`

```ts
export function looksLikeCursor(text: string): boolean
export function cursorToJsonl(text: string): string
```

- **`looksLikeCursor`**: parse the first non-empty line; true when it has a
  `role` of `user`/`assistant` and a `message.content` array, and it is **not**
  Codex (`session_meta`) or a Claude record (which carries a top-level `uuid` /
  `type`). Ordering in the detector chain: Codex, then Cursor, then
  Claude/terminal, so the markers stay unambiguous.
- **`cursorToJsonl`**: emit a leading `cursor-meta` record (`source: "cursor"`,
  `sessionId`, `cwd`), then walk the records. Each record gets a synthetic
  truthy top-level `uuid` (`cursor-rec-N`). An assistant record's `content[]` is
  **split into one synthetic assistant record per block** (text / tool_use /
  thinking), mirroring `codexExport.ts`'s `pushAssistant`: the canonical parser
  (`parser.ts` Pass 2) renders only the *last* block of each assistant record, so
  every block must be its own record or all but the last are dropped. Each
  emitted assistant record carries a synthetic `message.id` and `model: null`.
  User records strip the envelope (§3.4) into a string `message.content` and
  carry the parsed timestamp (§10).

No tool_result records are synthesized (none exist); tool cards render the call
without an output body, which the viewer already handles for terminal exports.

### 6.2 `parser.ts`

- Add a `cursor-meta` branch (sets `sourceFormat = "cursor"`, source label,
  cwd/session metadata), mirroring `codex-meta`.
- Widen `sourceFormat` to include `"cursor"`.
- Route Cursor through the single `buildSessionFromRaw` chokepoint so Cursor
  subagents render at any depth (top-level, AgentBody expand, Outcome streams).

### 6.3 `tools.ts`

Register the Cursor tool names from §3.3 so each maps to the correct card.
`Read`/`ReadFile` → FileBody, `Shell`/`AwaitShell` → BashBody, `Glob`/`Grep` →
search, `Task`/`Subagent` → AgentBody, others → GenericBody.

### 6.4 Source-aware chrome

- Avatar + Hero badge gain a "Cursor" variant alongside Claude Code / Codex CLI.
- Files-touched and Outcome cards behave as for any source; with no diffs in the
  transcript, file-edit counts derive from whatever the tool calls expose
  (Cursor agent edits route through `Shell`, so they appear as shell cards).

## 7. Subagent linking (`link_cursor_subagents`)

Inputs: the main `.jsonl` and the sibling `subagents/` directory.

1. Collect the ordered `Task` / `Subagent` dispatches from the main transcript:
   `(description, prompt)` in document order.
2. For each `subagents/<uuid>.jsonl`, read its first user record and strip the
   envelope (§3.4) to get that subagent's effective prompt.
3. Match each dispatch to a subagent file by **prompt prefix** equality.
4. When several dispatches share an identical prompt (the observed parallel
   `Fetch example.com #1/#2/#3` case), tie-break by file order / mtime. This is
   the same same-description parallel case the existing Claude
   `parallel-same-desc` fixture already exercises.
5. Emit subagent metadata `{ id: <file-stem uuid>, description, subagent_type }`
   so the bundle and the frontend AgentBody can render and expand each subagent.

Unmatched subagent files are still bundled (rendered standalone); unmatched
dispatches render as an AgentBody whose subagent trace is "not available",
matching existing orphan behavior.

## 8. Shared constants

`platform="cursor"`, `source_format="cursor"`. Update the shared platform
enum/constants across plugin, backend, and frontend in lockstep (pre-1.0, no
external compatibility constraint), following the Codex change set.

## 9. Accepted degradation

Per the project's simplicity preference (one-shot copy over enrichment), Cursor
traces render:

- user prompts (envelope stripped),
- assistant text and thinking (when present),
- tool *calls* (with native cards per §3.3).

They will **not** show:

- tool-result bodies (not in the transcript, and not reliably in SQLite either),
- token cost or context usage (not recorded),
- real model name (`modelInfo` is only `"default"`),
- fine-grained Active Time (only coarse user-turn timestamps exist; see §10).

The viewer already degrades gracefully on all of these (the terminal-export path
shows the same gaps). No placeholder/fake values are shown.

## 10. Timestamps (coarse, from the envelope)

The `<timestamp>` tag (§3.4) is parsed in `cursorExport.ts`:

- Parse `%A, %b %d, %Y, %I:%M %p` plus the `(UTC±N)` offset into an ISO instant.
- Attach it to that user record; assistant records inherit the preceding user
  turn's timestamp.
- Active Time is the span across parsed user-turn timestamps (rough, minute
  precision). When no `<timestamp>` is present, timing is omitted for that turn.

This is intentionally coarse: timestamps exist only at user-turn boundaries and
only when the envelope is present. It is honest (no interpolation between turns).

## 11. Testing

- **Plugin**: `CursorTranscriptReader` discovery (hook id and newest-by-mtime
  fallback); `link_cursor_subagents` including the identical-prompt parallel
  tie-break; an end-to-end hook test that a Cursor session bundles main +
  subagents with `platform=cursor`.
- **Backend**: `message_count` for Cursor records; an ingest regression guard
  (`platform=cursor` + UUID subagents round-trips); per-trace SEO names "Cursor".
- **Frontend**: `looksLikeCursor` (positive + negative vs Codex/Claude/terminal);
  `cursorToJsonl` (record mapping, envelope strip, timestamp parse, `cursor-meta`
  emission); a subagent re-parse regression test (Cursor subagent renders inside
  AgentBody at depth); tool-card mapping for the §3.3 vocabulary.
- **Fixtures**: real, redacted Cursor transcripts — at least one main + multi
  subagent session (the `Fetch example.com #1/#2/#3` parallel case is ideal) and
  one single-thread session.

## 12. Architecture invariant (unchanged)

Upload raw redacted bytes; store opaque; convert in the browser. The
converter/linker can be improved later with zero re-upload, exactly as for Codex.

## 13. Sequencing

Three plans, in dependency order, mirroring the Codex rollout:

1. **Backend** (additive, ships first; inert for existing platforms): message
   count, SEO naming, validator regression guard, shared constant.
2. **Frontend** (dormant for Cursor until the plugin ships; inert for
   Claude/Codex/terminal): `cursorExport.ts`, `parser.ts` `cursor-meta` branch,
   `tools.ts` vocabulary, source-aware chrome, fixtures + tests.
3. **Plugin** (ships last, since it begins emitting Cursor traces): reader,
   adapter branch, `link_cursor_subagents`, user-level `~/.cursor/hooks.json`
   install surface + command, platform label threading, tests.
