# Codex CLI trace support — Design

**Status**: draft, pending implementation
**Date**: 2026-05-31
**Branch**: `feature/codex-trace-support`

## 1. Purpose

vibeshub captures, stores, and displays AI coding-agent session traces. Today
the only supported agent is Claude Code. This spec adds first-class support for
**OpenAI Codex CLI** traces (the `Codex Desktop` / `codex-cli` family, observed
at v0.135.0-alpha.1, model `gpt-5.5`), with at least as much display fidelity as
Claude Code traces, including subagents.

The work spans three layers, but the load is uneven by design:

- **Plugin**: one adaptive plugin that recognizes whether it runs under Claude
  Code or Codex and uploads the right transcript with the right label. Almost
  all of `vibeshub_client/` is reused; only a per-platform adapter is new.
- **Backend**: a near-passthrough blob store already. Minor touches only:
  accept the `codex` platform label, accept Codex's UUID subagent ids, count
  Codex messages, and de-hardcode "Claude Code" copy in link-preview SEO.
- **Frontend**: where the real work lives. A `codexExport` adapter converts a
  Codex rollout into the existing canonical record shape that `buildSession`
  already understands, plus native cards for Codex's tools.

### 1.1 Why this shape

Three facts about the current architecture make this the low-risk path:

1. **The plugin is a raw-bytes passthrough.** It byte-redacts the transcript,
   tars it, and POSTs it. It never parses the format. So a Codex transcript can
   ride the exact same pipeline as a Claude one.
2. **The backend never parses transcripts.** It stores raw redacted JSONL as a
   blob and serves it back unchanged. `platform` is already a free-text column;
   no render model exists server-side (it was deliberately removed).
3. **The frontend is the single conversion chokepoint, and it already has a
   precedent.** `parser.ts::buildSession` produces a provider-neutral
   `Session`/`StreamEvent` model; every card downstream (`ToolCard`, `BashBody`,
   `DiffView`, `ThinkingBlock`, `Timeline`, `Outcome`, `AgentBody`) is agnostic
   to the source agent. `terminalExport.ts` already converts a *foreign* format
   (Claude's rendered `.txt`) into the canonical record shape. Codex follows the
   same pattern.

### 1.2 A latent bug this also fixes

This Codex build already loads the vibeshub plugin (it shares Claude Code's
marketplace/hook/command system; `~/.codex/config.toml` shows
`vibeshub@vibeshub` enabled and a registered `post_tool_use` hook). Codex passes
a `PostToolUse` payload whose `transcript_path` points at the Codex rollout. The
current hook reads `transcript_path` first and hardcodes
`X-Vibeshub-Platform: claude-code`. So a `gh pr create` under Codex *today*
uploads a Codex rollout mislabeled as Claude Code, which the viewer renders as
near-empty. The adaptive plugin in this spec makes that path correct instead of
broken.

## 2. Non-goals

- **Reviving a server-side render model.** Conversion stays in the browser. The
  `renders` table was removed on purpose; we do not bring it back.
- **Two separate plugins.** We keep one adaptive plugin (see §4.1 for the
  rationale and the easy reversal if that changes).
- **Plaintext Codex reasoning.** On gpt-5.5 the `reasoning` items are encrypted
  (`encrypted_content` only, no readable text). We surface what Codex does emit
  (commentary-channel updates, plan steps, readable `reasoning.summary` when a
  model provides it). We do not attempt to decrypt or fabricate chain-of-thought.
- **Deep tool-by-tool parity for rare Codex tools.** Known tools get native
  cards (§6.4); the long tail (e.g. `js`, MCP tools) falls back to the existing
  `GenericBody`, which already renders any tool name.
- **Backwards-compatible ingest changes.** Pre-1.0, no external users; we change
  shared constants in lockstep (see §8.2).
- **Web upload of Codex subagents.** The drag-upload `/vibeviewer` path accepts a
  single Codex rollout (main thread). Subagent bundling needs filesystem +
  SQLite access and is the CLI plugin's job (§4.4). A web-dragged Codex file
  renders its main thread; subagent cards show "trace not available" gracefully,
  exactly as orphaned Claude subagents do.

## 3. Codex format reference (load-bearing facts)

A Codex rollout lives at
`~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<ts>-<thread-uuid>.jsonl`, one JSON
object per line. Top-level envelope: `{ timestamp, type, payload }`.

### 3.1 Line types

| `type` | Role |
|---|---|
| `session_meta` | Always line 1. `payload`: `id` (thread UUID), `timestamp` (start), `cwd`, `originator`, `cli_version`, `source`, `model_provider`, `git{commit_hash,branch,repository_url}`, `base_instructions{text}` (hidden system prompt; redact), `thread_source` / `forked_from_id` / `source.subagent` for subagents (§5). |
| `turn_context` | Per turn. Carries the **model** (`payload.model`, e.g. `gpt-5.5`), sandbox/approval policy, reasoning effort. Model is NOT in `session_meta`. |
| `response_item` | The conversation items: `message`, `reasoning`, `function_call`, `function_call_output`, `web_search_call`, `tool_search_call`/`tool_search_output`. |
| `event_msg` | UI/lifecycle: `user_message` (the real human prompt), `agent_message` (streamed assistant text, `phase` ∈ commentary/final), `task_started`, `task_complete` (`duration_ms`, `time_to_first_token_ms`, `last_agent_message`), `token_count`. |

### 3.2 Native vs imported detection

This machine's `~/.codex/sessions` also contains Claude Code sessions imported
into Codex format. A file is **imported** if any line contains
`external-import-turn`, or if it has zero `function_call`/`reasoning`/
`turn_context` lines. Otherwise native. `originator` and `base_instructions` are
identical across both and must not be used to discriminate. The frontend
detector (`looksLikeCodex`) keys on the **Codex envelope** (line 1
`type=="session_meta"` with a Codex `payload`, plus `response_item`/`event_msg`
lines). `codexToJsonl` handles both native and imported-into-Codex files, since
both share that envelope; the native/imported distinction matters only for which
transcript the plugin selects, not for rendering.

### 3.3 Tool calls and outputs

- `function_call`: `{ name, arguments (JSON-encoded STRING), call_id, namespace? }`.
  `arguments` must be `JSON.parse`d. Known names: `exec_command`
  (`{cmd, workdir, yield_time_ms, max_output_tokens}`), `update_plan`
  (`{plan:[{step,status}], explanation}`), `spawn_agent`/`wait_agent`
  (namespace `multi_agent_v1`, §5), `web_search`, `tool_search`, `js`.
  **`apply_patch` rides inside `exec_command`**: `cmd` begins with `apply_patch`
  (heredoc-delimited patch body). There is no separate `apply_patch` function
  name in observed native traces.
- `function_call_output`: `{ call_id, output (STRING) }`. The output string has
  an embedded preamble: `Chunk ID: ...`, `Wall time: ...`,
  `Process exited with code N`, `Original token count: N`, then `Output:\n<body>`.
  Exit code and original token count are regex-parsed from this string; stdout
  and stderr are merged into the one body (not separated).

### 3.4 Aggregates

- **Model**: `turn_context.payload.model`.
- **Real user prompt**: `event_msg.user_message.message` (the `response_item`
  user messages are mostly injected `<environment_context>` wrappers; filter
  those out).
- **Assistant text**: `response_item.message role=assistant` `output_text`. The
  same text is mirrored in `event_msg.agent_message`; drive the transcript off
  `response_item`s and use `event_msg.agent_message phase=commentary` only as the
  visible "thinking" surface to avoid double-rendering.
- **Tokens**: last `event_msg.token_count.info.total_token_usage` is the session
  total (cumulative). Note Codex counts cached tokens **inside** `input_tokens`
  (`cached_input_tokens` is a subset), the inverse of Anthropic's convention.
- **Duration / Active Time**: `task_complete.duration_ms` (per turn);
  `time_to_first_token_ms` available. Every line also has an ISO-8601 `timestamp`
  for timeline/idle-gap computation.
- **Final answer**: `task_complete.last_agent_message` or the last assistant
  `output_text`.

## 4. Plugin changes (one adaptive plugin)

### 4.1 Structure decision: one plugin, a `PlatformAdapter`

We keep a single vibeshub plugin and introduce a small adapter interface. The
heavy machinery (`bundle`, `upload`, `redact`, `pipeline`, the GitHub helpers)
is identical across runtimes; only *finding the transcript* and *linking
subagents* differ in their internals, and both are clean injection points.
Splitting into `plugins/claude-code` + `plugins/codex` would not simplify either
module, it would relocate two files and force vendoring/symlinking the shared
library into two trees (the maintenance cost `plugins/README.md` already warns
about). The adapter contains all runtime branching in one place, so a later
split is a low-risk reversal.

```python
# vibeshub_client/platform.py  (new)
class PlatformAdapter(Protocol):
    platform_id: str                                  # "claude-code" | "codex"
    def find_main_transcript(self, hook_input: dict) -> Path | None: ...
    def link_subagents(self, main_jsonl: Path, hook_input: dict) -> list[AgentEntry]: ...
    def extract_trigger_command(self, tool_input: dict) -> str | None: ...

def select_adapter(hook_input: dict, env: Mapping[str, str]) -> PlatformAdapter:
    # Codex when CODEX_HOME is set, or transcript_path is under .codex/sessions,
    # or tool name is exec_command/shell. Else Claude Code.
```

`ClaudeAdapter` wraps the existing `ClaudeCodeTranscriptReader` +
`subagent_link.link_subagents` + `tool_input["command"]`. `CodexAdapter` is new
(§4.3, §4.4) and reads `tool_input["cmd"]`.

### 4.2 Modified shared modules

- **`vibeshub_client/upload.py`**: replace the hardcoded
  `X-Vibeshub-Platform: "claude-code"` with `adapter.platform_id`. No other
  change.
- **`vibeshub_client/post_comment.py`**: parameterize the "Claude Code trace"
  label in `build_comment_body` (e.g. take a `platform_label` argument →
  "Codex trace for this PR: ..."). `post_pr_comment` is unchanged.
- **`vibeshub_client/pipeline.py`**: take an `adapter` (and keep `redact`
  injected). Body becomes: `main = adapter.find_main_transcript(hook_input)`;
  early-return if `None`; `agents = adapter.link_subagents(main, hook_input)`;
  `build_bundle(main, agents, redact)`; `upload_bundle(..., platform=adapter.platform_id)`;
  `post_pr_comment` with the platform label.
- **`hooks/hooks.json`**: broaden the `PostToolUse` matcher so it also fires on
  Codex's shell tool (`exec_command` / `shell`) in addition to `Bash`. The
  command classification (`share_trigger.classify_share_trigger`) is already
  generic; only the command-extraction key differs (handled by the adapter).
- **`hooks/on-pr-share.py`**: call `select_adapter(hook_input, os.environ)` and
  drive the pipeline through it. Keep the existing "never block the agent,
  exit 0 on any failure, log to ~/.vibeshub/hook.log" posture.

### 4.3 New: `CodexAdapter.find_main_transcript`

Under Codex the hook payload's `transcript_path` already points at the rollout,
so this returns it directly (with the same retry/flush tolerance the Claude
reader uses). Fallback: newest `rollout-*.jsonl` under `~/.codex/sessions`
matching the payload's session/thread id. `platform_id = "codex"`.

### 4.4 New: `CodexAdapter.link_subagents` (SQLite + transcript)

Codex spawns subagents via the `spawn_agent` tool (namespace `multi_agent_v1`);
each child is its own rollout JSONL. Linking, in priority order (validated
against three real test subagents Godel/Raman/Poincaré spawned from thread
`019e7ed1-…`):

0. **Locate the state DB (do not hardcode the filename).** The `_5` in
   `state_5.sqlite` is a schema-version counter: the Codex binary hardcodes that
   literal for *this* build, sibling DBs are independently versioned
   (`goals_1`, `logs_2`, `memories_1`, `state_5`), and old versions are deleted
   on migration rather than left behind. A future Codex will ship
   `state_6.sqlite`. Resolve robustly: take `CODEX_HOME` from the environment
   (default `~/.codex`), glob `state_*.sqlite`, and pick the **highest-N file
   that actually contains a `thread_spawn_edges` table** (verify via
   `sqlite_master`). If none qualifies (renamed DB, table moved, locked file),
   skip straight to the JSONL-header fallback in step 5, which is fully
   schema-independent.

1. **Primary graph** — open the located DB read-only
   (`file:...?mode=ro`, stdlib `sqlite3`, no new dependency) and query children
   of the main thread id:

   ```sql
   SELECT e.child_thread_id, e.status,
          c.agent_nickname, c.agent_role, c.rollout_path,
          c.model, c.tokens_used, c.first_user_message
   FROM thread_spawn_edges e
   JOIN threads c ON c.id = e.child_thread_id
   WHERE e.parent_thread_id = :main_thread_id;
   ```

   `thread_spawn_edges` is the clean user-spawned graph; **guardian** subagents
   (approval-review threads, `agent_role='guardian'`, `thread_source='subagent'`)
   are absent from it by construction, so they are excluded automatically.

2. **Read each child** transcript bytes from `rollout_path`.

3. **Cross-link to the parent `spawn_agent` `call_id`** by scanning the parent
   transcript's `spawn_agent` `function_call_output`s, which are exactly
   `{"agent_id": "<child-thread-uuid>", "nickname": "Godel"}`. The matching
   `call_id` becomes the `AgentEntry.tool_use_id`. (`wait_agent` `targets`
   provide status corroboration.)

4. **Recurse** over `thread_spawn_edges` for `depth > 1`; bundle every
   non-guardian descendant as a flat `agents/<child_thread_id>` entry. Each
   links to whichever transcript spawned it via that transcript's `spawn_agent`
   output, so cross-level linking still works with a flat bundle.

5. **Fallback** when the DB is locked/absent/schema-drifted: glob
   `~/.codex/sessions/**/*.jsonl`, read line 1, keep files where
   `payload.forked_from_id == main_thread_id` and
   `payload.source.subagent.thread_spawn.agent_role != "guardian"`.

The result is a `list[AgentEntry]` in the **same shape the Claude linker
produces**, so `bundle.py` / `upload.py` / the backend / the viewer's subagent
display are all reused unchanged:

```python
AgentEntry(
    agent_id="019e7f09-bca2-7150-ac2b-54f7b075a2ea",   # child thread UUID
    tool_use_id="call_JaztjtB8FilzoNex6V4Sqayq",        # parent spawn_agent call
    agent_type="default",                               # agent_role (nickname in meta)
    description="Fetch https://example.com once and ...",# spawn_agent args.message
    jsonl_path=<child rollout path>,
    meta_path=<synthesized>,                            # {agentType, description, toolUseId, nickname}
)
```

### 4.5 Manifest and marketplace

Add `.codex-plugin/plugin.json` mirroring `.claude-plugin/plugin.json` so Codex
recognizes the plugin natively (the `codex` binary looks for
`.codex-plugin/plugin.json`; it appears to fall back to `.claude-plugin` today,
which is why it already loads). Add the corresponding marketplace entry for
Codex. The single plugin source serves both runtimes.

### 4.6 Untouched

`vibeshub_client/redact.py` (byte-level, already covers OpenAI keys),
`bundle.py` (member naming is format-agnostic; agent ids are opaque strings),
`gh_token.py`, `repo_resolve.py`, `pr_resolve.py`, `parse_pr_url.py`,
`share_trigger.py` (pure classifier), `version.py`. The Claude reader and
`subagent_link.py` stay as the `ClaudeAdapter` internals.

## 5. Backend changes

Small and additive. No new render model, no schema migration required (one
optional widening below).

- **`app/redact/bundle.py`** — relax the agent-id member regexes from
  `^agents/(a[0-9a-f]{16})\.jsonl$` (and the `.meta.json` twin) to accept Codex
  UUID thread ids as well, e.g. `^agents/([A-Za-z0-9_-]+)\.jsonl$` and
  `^agents/([A-Za-z0-9_-]+)\.meta\.json$`. Keep the jsonl↔meta pairing and
  path-traversal rejection. The id is regex-sanitized before any path
  construction, as today.
- **`app/message_count.py`** — add a Codex branch so list views show a correct
  count. Detect the Codex envelope (line 1 `type=="session_meta"` with a Codex
  `payload`) and count `response_item` `message`/`function_call` items. Claude
  branch unchanged; unknown shapes still return 0.
- **`app/api/ingest.py` / `app/api/uploads.py`** — accept and store
  `platform="codex"` (ingest reads it from `X-Vibeshub-Platform`, already
  free-text; the web path may set `source_format="codex"`). No validation that
  content is Claude-shaped exists today, so nothing rejects Codex bytes.
- **`app/api/spa_seo.py`** — the hardcoded "Claude Code session/traces" strings
  in `_render_trace_head` / `_render_user_head` / `_render_repo_head` /
  `_render_pr_head` become source-aware (derive the agent label from
  `trace.platform`) so Codex traces are not mislabeled in link previews.
- **Optional** — widen `source_format` usage to recognize `"codex"` (already a
  nullable `String(32)`; no migration). Only needed if we want a web-path marker
  distinct from `platform`.

Untouched: all of `app/github/`, `app/auth/`, `resolve_association`,
`RepoAccessChecker`, the blob store, the redaction *patterns*, the `/raw` and
summary serve endpoints, the upsert logic, and access gating.

## 6. Frontend changes

The bulk of the work. The strategy: convert a Codex rollout into the **same
clean Claude-shaped synthetic records** `buildSession` already consumes (so all
aggregation, tool grouping, token/active-time logic, and every card are reused),
keeping **Codex-native tool names** so cards are labeled honestly.

### 6.1 New: `components/trace/codexExport.ts`

Mirrors `terminalExport.ts`. Exports `looksLikeCodex(text): boolean` and
`codexToJsonl(text): string` (synthetic Claude-shaped JSONL).

**Route ALL raw-transcript parsing through one shared entry point** so the Codex
(and terminal) dispatch can never be forgotten at a call site:

```ts
// parser.ts (or a thin sessionFromRaw.ts to avoid an import cycle with codexExport)
export function buildSessionFromRaw(text: string): Session {
  const jsonl = looksLikeCodex(text)    ? codexToJsonl(text)
              : looksLikeTerminal(text) ? terminalExportToJsonl(text)
              : text;
  return buildSession(parseJsonl(jsonl));
}
```

There are **three** raw-parse sites today, and only the first is the top-level
trace. The other two re-parse a fetched *subagent* transcript and currently call
`buildSession(parseJsonl(jsonl))` directly, so they would feed a Codex child into
the Claude parser and get an empty session:

1. `routes/TraceView.tsx` + `routes/VibeViewer.tsx` (top-level trace).
2. `components/trace/tool/AgentBody.tsx:40` (nested subagent, on expand).
3. `components/trace/Outcome.tsx:94` (every subagent stream, for Files-touched).

All three switch to `buildSessionFromRaw`. This covers the CLI plugin path
(viewer fetches `/raw` → raw Codex bytes) and the web drag-upload path uniformly,
and makes Codex subagents render at arbitrary depth (each nested child is itself
dispatched).

### 6.2 Record mapping (in `codexToJsonl`)

| Codex source | Synthetic Claude record |
|---|---|
| `session_meta` + `turn_context` | a `codex-meta` marker (analogous to `terminal-meta`) carrying `cwd`, `gitBranch`, `model`, `cli_version`, `platform="codex"` |
| `event_msg.user_message` | `{type:"user", message:{content:[{type:"text", text}]}}` |
| `response_item.message` assistant `output_text` | `{type:"assistant", message:{content:[{type:"text", text}], usage}}` |
| `event_msg.agent_message phase=commentary` | `{type:"assistant", message:{content:[{type:"thinking", thinking}]}}` (visible "thinking" surface, since real reasoning is encrypted) |
| `response_item.function_call` | `{type:"assistant", message:{content:[{type:"tool_use", id:call_id, name, input}]}}` with Codex-native `name` (§6.4) |
| `response_item.function_call_output` | `{type:"user", message:{content:[{type:"tool_result", tool_use_id:call_id, content, is_error}]}, toolUseResult:{stdout, exitCode, originalTokenCount}}` (parsed from the output preamble) |
| `task_complete.duration_ms` | `{type:"system", subtype:"turn_duration", durationMs}` so Active Time is correct |
| `event_msg.token_count` | folded into the nearest assistant `usage`, mapping `input_tokens - cached_input_tokens → input_tokens`, `cached_input_tokens → cache_read_input_tokens`, `output_tokens → output_tokens` (correcting Codex's cached-inside-input convention) |

Filter out `response_item` user messages that are pure
`<environment_context>` / `<user_instructions>` / `developer`-role injections;
the real prompt comes from `event_msg.user_message`.

### 6.3 Reasoning

gpt-5.5 reasoning is encrypted, so `response_item.reasoning` with only
`encrypted_content` is skipped. When `reasoning.summary[].text` or
`reasoning.content[].text` is present (other models), emit it as a `thinking`
block. The commentary-channel `agent_message`s carry the visible "thinking out
loud" and render via the existing `ThinkingBlock`.

### 6.4 Native tool cards

Add Codex tool names to the registry and the three switch points, mapping each
to an existing body so almost no new rendering code is needed:

| Codex tool | Card | Notes |
|---|---|---|
| `exec_command` (`shell`) | `BashBody` | input `{command: cmd, description: workdir}`; result `toolUseResult.{stdout, exitCode}` from the preamble |
| `exec_command` whose `cmd` starts with `apply_patch` (or a literal `apply_patch` call) | `FileBody mode="write"` → `DiffView` | needs a small Codex apply-patch parser feeding `DiffView` (see below) |
| `update_plan` | a compact plan/checklist body | `{plan:[{step,status}], explanation}`; small new `PlanBody` (closest existing analog is the todo/task rendering) |
| `spawn_agent` | `AgentBody` | id = `call_id`; map `agent_nickname`/`agent_role` → label, `args.message` → prompt; links the nested child trace by `tool_use_id` |
| `web_search` / `tool_search` | existing `WebSearch`-style/`GenericBody` | low priority |
| `js`, MCP, other | `GenericBody` | already renders any unknown tool name |

Files touched: `components/trace/tools.ts` (`TOOL_META` entries +
`toolCat` categories/colors for the Codex names), `tool/ToolCard.tsx`
(`renderBody` switch), `components/trace/format.ts` (`toolSummary` switch),
and `components/trace/diff.ts` (a Codex apply-patch → `DiffView` row-model
parser, since Codex emits a patch envelope rather than Claude's
`structuredPatch`). `BashBody`, `FileBody`, `DiffView`, `AgentBody`,
`ThinkingBlock` are reused as-is.

### 6.5 Branding

- **`tool/AgentBody.tsx`** already links subagents by
  `AgentSummary.tool_use_id`; Codex's `call_id`-keyed `tool_use` slots straight
  in. Map nickname/role/model into the existing dispatch header.
- **`AssistantText.tsx`** — replace the hardcoded `"C"` avatar with a
  source-aware mark derived from `session.meta` / `platform` (Codex gets its own
  mark; Claude keeps `"C"`).
- **`Hero.tsx` `HeroEyebrow`** already prints `trace.platform`; add a subtle
  per-platform badge (`claude-code` vs `codex`). Keep it subtle and low-clutter
  per the project's frontend taste; no bold restructure.
- Copy strings that say "Claude Code session" in `routes/TraceView.tsx` /
  `routes/VibeViewer.tsx` become source-aware. No em-dashes in any new
  user-facing string.

### 6.6 `SessionMeta` / types

Widen `SessionMeta.sourceFormat` (currently `"terminal" | null`) to include
`"codex"`, and add a `platform`/source field threaded from the summary so the
avatar/badge/copy can branch. `agent_id` stays an opaque string, so Codex UUIDs
need no type change. `AgentSummary` (added by the existing Claude subagent
support) is reused as-is: `tool_use_id` carries the Codex `spawn_agent` `call_id`.

### 6.7 Subagent rendering (Codex-specific touches)

The subagent infrastructure from Claude subagent support is reused; these are the
Codex deltas beyond the shared `buildSessionFromRaw` fix in §6.1.

- **`tool/ToolCard.tsx` routing.** Codex's subagent tool is named `spawn_agent`,
  not `Agent`. Add it to the existing `case "Agent":` branch
  (`case "Agent": case "spawn_agent":`) so `AgentBody` and its already-forwarded
  `shortId` / `agents` props apply with no other plumbing change.
- **`AgentBody` field normalization done in the converter (so `AgentBody` stays
  untouched).** `AgentBody` reads `input.subagent_type`, `input.model`,
  `input.prompt` (lines 20–23). `codexToJsonl` emits the `spawn_agent` `tool_use`
  with exactly those keys: `subagent_type` ← `agent_nickname` (fallback
  `agent_role`), `model` ← child thread model, `prompt` ← `spawn_agent`
  `args.message`. The `tool_use` `id` is the `call_id`, which matches
  `AgentSummary.tool_use_id`.
- **Linkage / recursion via the flat agents list.** `AgentBody` matches
  `agents.find(a => a.tool_use_id === toolUseId)` against the flat
  `meta.agents`, which lists every non-guardian descendant (§4.4). Each child's
  `tool_use_id` is its spawning `call_id` in whatever transcript spawned it, so
  depth>1 works once all three parse sites use `buildSessionFromRaw`.
- **`Outcome.tsx` `deriveFiles` tool names.** It currently counts writes only for
  `Write`/`Edit`/`MultiEdit` and reads for `Read` (lines 50–51). Add the Codex
  write/read equivalents (`apply_patch` as a write; `shell`/`exec_command` reads
  are best-effort and may be skipped) so Codex "Files touched" is populated
  across the parent and subagent streams.
- **`wait_agent` status (nice-to-have).** Decorate the `AgentBody` header with
  the child's terminal status from `wait_agent` / `<subagent_notification>` (or
  the `threads.status` carried in the summary) when available; absence is
  non-fatal.

## 7. Architecture & data flow

```
CLI plugin path (auto on gh pr create / git push, or manual /share)
─────────────────────────────────────────────────────────────────
Codex turn ends / PR created
  │  hook fires (PostToolUse, matcher includes exec_command)
  ├─ select_adapter → CodexAdapter
  ├─ find_main_transcript  → ~/.codex/sessions/.../rollout-<main>.jsonl
  ├─ link_subagents        → state_<N>.sqlite ⋈ threads + spawn_agent outputs
  ├─ build_bundle (redact each):  main.jsonl
  │                               agents/<child-uuid>.jsonl
  │                               agents/<child-uuid>.meta.json
  └─ POST tar → /api/ingest   (X-Vibeshub-Platform: codex)
                                  │
Backend (dumb blob store)         ├─ unpack + redact (UUID agent ids allowed)
                                  ├─ store blobs verbatim
                                  └─ Trace row: platform=codex, agents[...]
                                  │
Frontend viewer                   GET /api/traces/<sid>/raw → raw Codex JSONL
                                  │
                  looksLikeCodex? ─► codexToJsonl() ─► buildSession() ─► cards
                                  AgentBody expand ─► /agents/<uuid> ─► same dispatch

Web path (/vibeviewer drag-upload)
──────────────────────────────────
drop rollout.jsonl → POST /api/uploads (platform/source_format=codex)
  → stored raw → viewer converts on render (main thread only; no subagents)
```

## 8. Testing strategy

Risk concentrates in three places: the **Codex subagent linker** (SQLite +
cross-link correctness, guardian exclusion), the **`codexToJsonl` converter**
(record/tool mapping, output-preamble parsing, token convention), and the
**adapter selection** (picking the wrong runtime). Everything else is shallow
plumbing or reuse.

### 8.1 Fixtures

- Plugin: `plugins/.../tests/fixtures/codex/` with a real (redacted) native
  rollout, a parent-with-three-subagents set (Godel/Raman/Poincaré) plus a
  trimmed `state_<N>.sqlite`, a guardian-present case, and a deep (depth>1) case.
- Frontend: `src/tests/fixtures/sample-codex-rollout.jsonl` (native main thread,
  with `exec_command`, an `apply_patch`-via-exec, `update_plan`, `spawn_agent`,
  token counts, `task_complete`) and a `sample-codex-subagent.jsonl`.

### 8.2 Plugin (pytest, run via `env/bin/pytest`)

- `test_platform_adapter.py`: `select_adapter` returns Codex for
  CODEX_HOME-set / `.codex/sessions` transcript_path / `exec_command` tool, and
  Claude otherwise. `extract_trigger_command` reads `cmd` (Codex) vs `command`
  (Claude).
- `test_codex_subagent_link.py`: against the fixture sqlite + transcripts,
  assert the three children resolve with correct `tool_use_id` (from
  `spawn_agent` outputs), guardians excluded, depth>1 recursion, the highest-N
  DB-discovery rule (e.g. a fixture renamed `state_6.sqlite` alongside a decoy
  `state_4.sqlite` lacking the table), and the glob fallback when no DB
  qualifies.
- `test_codex_reader.py`: `find_main_transcript` returns the payload
  `transcript_path`; fallback to newest matching rollout.
- Extend `test_pipeline.py` to run a Codex bundle end-to-end with mocked HTTP:
  correct `platform=codex` header, correct agents in the tar, correct comment
  label.

### 8.3 Backend (pytest)

- Extend `test_bundle_unpack` (or equivalent) to accept UUID agent ids and still
  reject path traversal / unpaired members.
- `test_ingest`: POST a Codex bundle, assert row `platform=codex`,
  `agent_count=3`, blobs present under UUID names, `/raw` and `/agents/<uuid>`
  serve the right bytes.
- `test_message_count`: Codex shape yields a non-zero, correct count.
- SEO: assert link-preview head for a `platform=codex` trace says Codex, not
  Claude Code.

### 8.4 Frontend (vitest + Playwright)

- `codexExport.test.ts`: `looksLikeCodex` true on native rollout / false on
  Claude jsonl and terminal export; `codexToJsonl` → `buildSession` produces the
  expected `Session` (user prompt from `user_message`, assistant text,
  shell/apply_patch/plan/spawn_agent tool events, correct token totals with the
  cached-inside-input correction, Active Time from `task_complete`).
- Viewer test: a Codex trace renders shell, apply_patch (DiffView), and plan
  cards; the platform badge and source-aware avatar show Codex; a `spawn_agent`
  card expands and fetches the nested Codex child.
- Subagent parse-site coverage (the §6.1 fix): with a Codex parent whose child
  is a Codex rollout, assert (a) `AgentBody` expand renders the child's real
  body (not empty), and (b) `Outcome` "Files touched" includes an `apply_patch`
  from the subagent stream. Both fail if `buildSessionFromRaw` is not used at the
  AgentBody/Outcome re-parse sites, so this is the regression guard.
- Reasoning: encrypted-only reasoning is omitted without error; commentary
  renders as thinking.

### 8.5 Validation that needs a live Codex (flagged risk)

The exact Codex `PostToolUse` payload and matcher behavior is the one piece not
fully confirmable by reading alone. Before relying on auto-share under Codex,
verify against the bundled `codex` binary
(`/Applications/Codex.app/Contents/Resources/codex`): confirm the hook fires on
a shell tool, the payload key for the command (`cmd`), and that `transcript_path`
points at the rollout. The manual `/share-trace` path (adapter-driven, runtime
independent) is the fallback if auto-trigger needs Codex-side iteration.

### 8.6 Explicitly not tested

- Decryption of Codex reasoning (out of scope).
- Web upload of Codex subagent bundles (out of scope, §2).
- Token-cost dollar figures (no price table in scope).

## 9. Rollout / order of operations

1. **Backend** (additive, deploy first): relax agent-id regex, Codex
   `message_count`, accept `platform=codex`, source-aware SEO. Safe with no
   clients sending Codex yet.
2. **Frontend**: `codexExport.ts`, native cards, branding, types. Until the
   plugin ships Codex traces, this is dormant for Codex but harmless (Claude and
   terminal paths unchanged). Ship behind the same build as backend.
3. **Plugin**: `PlatformAdapter` refactor, `CodexAdapter`, broadened hook
   matcher, `.codex-plugin` manifest + marketplace entry. Bump `PLUGIN_VERSION`.
   This is the step that begins producing Codex traces, so it lands after the
   backend accepts them and the frontend can render them.
4. **Verify** the live Codex hook path (§8.5); iterate the matcher/trigger if
   Codex's payload differs from the assumption.

Cross-step coordination is only "backend accepts Codex before the plugin emits
it" and "frontend can render before users share." The `PlatformAdapter` refactor
is behavior-preserving for Claude Code: existing Claude tests must stay green
through step 3.

## 10. Open questions / residual risk

- **Codex hook payload shape** (§8.5): the single unverified-by-reading
  assumption. Mitigated by a live-check step and the runtime-independent manual
  command.
- **State DB filename/schema drift** across Codex versions (the `state_<N>`
  counter will bump; the table could move): mitigated by highest-N discovery
  (§4.4 step 0) and the filesystem-glob fallback (§4.4 step 5), which needs only
  the child JSONL
  headers.
- **Encrypted reasoning** (§6.3): a fidelity ceiling inherent to Codex, not an
  engineering gap. We surface commentary and plan steps instead.
- **Apply-patch parsing**: Codex's patch envelope must be parsed into
  `DiffView`'s row model; if a patch shape is unrecognized, fall back to showing
  the raw patch text in a `BashBody`-style card rather than dropping it.
