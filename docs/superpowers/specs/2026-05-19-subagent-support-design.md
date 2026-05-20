# Subagent trace support — Design

**Status**: draft, pending implementation
**Date**: 2026-05-19
**Branch**: `feature/subagent-support`

## 1. Purpose

Claude Code persists each subagent dispatch as a separate `agent-<id>.jsonl`
file under `~/.claude/projects/<encoded-cwd>/<session-uuid>/subagents/`,
alongside a `agent-<id>.meta.json` containing `agentType` and `description`.
The vibeshub plugin today reads only the main `<session-uuid>.jsonl` and
uploads it as a single JSON blob, so the entire interior of every `Agent` tool
call is lost: viewers see the dispatch prompt and the agent's final summary,
nothing in between.

This spec adds end-to-end support for subagent traces: the plugin bundles them
with the main transcript, the backend stores them as sibling blobs, and the
frontend renders each subagent's full conversation inline under its parent
`Agent` tool card on click.

## 2. Non-goals

- Uploading or rendering the `tool-results/` sidecar folder (large Bash/Read
  outputs, WebFetch binaries). Tracked as a follow-up; orthogonal data path.
- Rendering newly-discovered in-jsonl record types (`last-prompt`,
  `queue-operation`, mid-session `permission-mode` changes, attachment subtype
  differentiation, `system.subtype` of `api_error`/`away_summary`/`local_command`).
  All ride in the existing payload today but aren't surfaced; out of scope here.
- Adding tool bodies for `TodoWrite`, `EnterWorktree`, `ExitWorktree`,
  `TaskStop`.
- Backwards-compatible ingest. We take a breaking API change (see §6).
- A separate route or drawer for subagent traces. Inline expansion only.

## 3. Architecture & data flow

```
Plugin (claude-code)                Backend                    Frontend
──────────────────────              ────────                   ─────────
session ends → hook fires
  │
  ├─ read transcript_path           POST /api/ingest
  │  + sibling subagents/             body: application/x-tar    GET /api/traces/<sid>
  │                                   ↓                            ↓
  ├─ match Agent tool_use ─────► verify auth + PR ─────────► returns Trace + agents[]
  │  ↔ subagent meta              │                            ↓
  │  by description+order         ├─ untar in memory          GET /api/traces/<sid>/raw
  │  → write meta.toolUseId       ├─ redact each file         GET /api/traces/<sid>/agents/<id>
  │                               ├─ store as:                  (lazy: only on Agent expand)
  ├─ tar:                         │   traces/<sid>/main.jsonl
  │   main.jsonl                  │   traces/<sid>/agents/agent-*.jsonl
  │   subagents/agent-*.jsonl     │   traces/<sid>/agents/agent-*.meta.json
  │   subagents/agent-*.meta.json │
  │                               └─ Trace row stores
  └─ POST tar to /api/ingest          agents JSONB column:
                                      [{agent_id, tool_use_id, agent_type,
                                        description, message_count}]
```

### 3.1 Linkage strategy (load-bearing)

The subagent jsonls do not carry `parentToolUseID`, and `meta.json.toolUseId`
is populated by Claude Code in only ~1% of observed files (1 of 147 across the
12 sessions with subagents on this machine). The plugin resolves the linkage
itself before bundling.

Algorithm:

```
collect parent_agents = [(tool_use_id, description, ts)]
        from main jsonl, in file order
collect subagents     = [(agent_id, description, first_record_ts)]
        from subagents/*.meta.json + jsonl
group both lists by description
for each description bucket:
    sort each side by timestamp
    zip pairwise → write meta.toolUseId on disk before tarring
unmatched subagents (count or desc skew):
    log warning, ship with toolUseId=null (frontend renders as orphan)
```

Validated against 12 sessions on this developer machine:

| Check | Result |
|---|---|
| `count(Agent tool_use)` == `count(agent-*.jsonl)` | 12/12 |
| Duplicate descriptions within a single session | 0/12 |
| Drift between Agent tool_use ts and subagent first-record ts | ~3–7 ms |
| Sort-by-timestamp matches description-by-position | 100% |

The description-grouping fallback is included as a defensive measure for
future parallel-dispatch traces with identical descriptions, even though we
have no examples in the wild yet.

### 3.2 Real edge case

Session `5c1dda5f-…` on this machine has a `subagents/` folder but no main
`.jsonl` (parent aborted before flush). The plugin must skip the upload
cleanly rather than crash — defensive `if not main.jsonl: return early` in the
pipeline.

## 4. Plugin changes

Files: 3 modified, 3 new.

### 4.1 Modified

- **`plugins/claude-code/reader.py`**. Extend
  `ClaudeCodeTranscriptReader.find_session` to also locate the sibling
  `<session-uuid>/subagents/` directory. Return a small `SessionPaths`
  dataclass: `{main_jsonl: Path, subagents_dir: Path | None}`. One caller, no
  benefit to splitting into two methods.

- **`plugins/claude-code/vibeshub_client/pipeline.py`**. Replace
  `run_share_pipeline` body:
  1. `paths = reader.find_session_paths(hook_input)`
  2. `agents = link_subagents(paths.main_jsonl, paths.subagents_dir)` →
     `list[AgentEntry]`. Unmatched entries get `tool_use_id=None` and a
     warning log line.
  3. `tar_bytes, report = build_bundle(paths.main_jsonl, agents, redact=redact_jsonl)`.
     Single pass: redact each file's bytes, write to a tarball with
     deterministic member names. Aggregate per-file `RedactionReport` into
     one total.
  4. `upload_bundle(server_url, token, tar_bytes, pr_url, plugin_version,
     session_id, redaction_count_client)`.
  5. Same `post_pr_comment` step as today.

- **`plugins/claude-code/vibeshub_client/upload.py`**. Rewrite for tar. New
  `BundlePayload(tar_bytes: bytes, pr_url: str, platform: str,
  plugin_version: str, session_id: str | None, redaction_count_client: int)`.
  Body is raw tar bytes; PR metadata moves to `X-Vibeshub-*` request headers.
  Function renamed `upload_bundle`.

### 4.2 New

- **`plugins/claude-code/vibeshub_client/subagent_link.py`**. Pure-function
  matcher:
  ```python
  @dataclass
  class AgentEntry:
      agent_id: str
      tool_use_id: str | None
      agent_type: str
      description: str
      jsonl_path: Path
      meta_path: Path

  def link_subagents(main_jsonl: Path, subagents_dir: Path | None) -> list[AgentEntry]
  ```
  Implements the §3.1 algorithm. No I/O outside the two paths.

- **`plugins/claude-code/vibeshub_client/bundle.py`**. In-memory tar builder:
  ```python
  def build_bundle(
      main_jsonl: Path,
      agents: list[AgentEntry],
      redact: Callable[[bytes], tuple[bytes, RedactionReport]],
  ) -> tuple[bytes, RedactionReport]
  ```
  Member names (exactly): `main.jsonl`, `agents/<agent_id>.jsonl`,
  `agents/<agent_id>.meta.json`. Rewrites each `meta.json` with the resolved
  `toolUseId` before adding it. Uses stdlib `tarfile` in `mode='w:gz'`. No
  new dependency.

- **`plugins/claude-code/tests/test_subagent_link.py`**,
  **`tests/test_bundle.py`**. See §7.

### 4.3 Untouched

`vibeshub_client/redact.py`, `vibeshub_client/post_comment.py`,
`vibeshub_client/gh_token.py`, `vibeshub_client/parse_pr_url.py`,
`vibeshub_client/version.py`, `hooks/on-pr-create.py`,
`commands/share-pr.py`. The hooks call `run_share_pipeline` and don't see the
wire format.

## 5. Backend changes

Files: 5 modified + 1 migration + 1 new helper.

### 5.1 Migration

`webapp/backend/alembic/versions/<new>_add_agents_to_traces.py`:

```sql
ALTER TABLE traces
  ADD COLUMN agents       JSONB        NULL,
  ADD COLUMN agent_count  INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN blob_prefix  VARCHAR(512) NULL;

ALTER TABLE traces ALTER COLUMN blob_path DROP NOT NULL;
```

Invariant after this migration: existing rows keep `blob_path` set and
`blob_prefix=null`; new (v2) rows set `blob_prefix` and leave `blob_path=null`.
Reader code checks `blob_prefix` first.

### 5.2 Modified

- **`app/storage/models.py`**. Add `agents: Mapped[Optional[dict]]`,
  `agent_count: Mapped[int]`, `blob_prefix: Mapped[Optional[str]]`. Make
  `blob_path` nullable.

- **`app/api/ingest.py`**. Rewrite the handler:
  - Body is `bytes` via `await request.body()`, content type
    `application/x-tar`. PR metadata moves to `X-Vibeshub-*` headers.
  - Call new `app/redact/bundle.py:unpack_and_redact(tar_bytes, max_total_bytes)`
    returning `{main_bytes, agents: [(agent_id, redacted_jsonl_bytes,
    meta_dict)], total_redactions}`. Enforces total decompressed size cap
    once. Validates member names — reject anything outside the allowlist.
  - Write blobs:
    - `traces/<sid>/main.jsonl`
    - `traces/<sid>/agents/<agent_id>.jsonl`
    - `traces/<sid>/agents/<agent_id>.meta.json`
  - Build `Trace.agents = [agent_summary]`, `agent_count`,
    `blob_prefix = f"traces/{sid}/"`.

- **`app/api/schemas.py`**. Remove `IngestRequest` (request is raw bytes).
  `IngestResponse` unchanged. Add `AgentSummary` model. Extend `TraceSummary`
  with `agent_count` and `agents`.

- **`app/api/traces.py`**:
  1. `_to_summary` includes `agents` (the subset: `agent_id`, `agent_type`,
     `description`, `tool_use_id`, `message_count`).
  2. Existing `GET /api/traces/{short_id}/raw` reads from
     `trace.blob_prefix + "main.jsonl"`. No fallback to `blob_path` — the
     one-time migration script (§9.1) guarantees every row has `blob_prefix`
     set before this code ships.
  3. New endpoint:
     ```
     GET /api/traces/{short_id}/agents/{agent_id}
     ```
     Returns the redacted agent jsonl from
     `traces/<sid>/agents/<agent_id>.jsonl`. 404 if `agent_id` not in
     `trace.agents`. Public, no auth — same posture as `/raw`.

     Meta.json blobs are not served by a separate endpoint; their content is
     already in `trace.agents`. They're stored for forensics only.
  4. `DELETE` handler deletes `main.jsonl` then iterates `trace.agents`
     and deletes each `agents/<id>.jsonl` + `agents/<id>.meta.json`. For
     migrated-legacy rows `trace.agents` is empty, so only `main.jsonl` is
     deleted — correct.

- **`app/storage/blob.py`**. No signature changes. Both backends (local-fs,
  Azure) already accept `/` in keys.

### 5.3 New

- **`app/redact/bundle.py`**. `unpack_and_redact` helper. Pure-function:
  takes raw tar bytes, returns the unpacked + redacted structures or raises
  `HTTPException`. See §7 for the adversarial test cases this must pass.

### 5.4 Untouched

`app/auth/github.py`, `app/redact/__init__.py` (the regex pass),
`app/short_id.py`, `app/deps.py`.

## 6. Frontend changes

Files: 6 modified + 2 new.

### 6.1 Data flow

Today: `TraceViewer` → `fetchRawJsonl(sid)` → `parseJsonl` → `buildSession` →
`<Thread>`. Subagents extend this by treating each agent's transcript as its
own nested `Session`, fetched lazily on `AgentBody` expand.

### 6.2 Modified

- **`src/api.ts`**. Add:
  ```ts
  export async function fetchAgentJsonl(
    shortId: string, agentId: string,
  ): Promise<string>
  ```
  GET `/api/traces/${shortId}/agents/${agentId}` → text. Same error shape as
  `fetchRawJsonl`.

- **`src/components/trace/types.ts`**:
  - Add `AgentSummary { agent_id, agent_type, description, tool_use_id,
    message_count }`.
  - Extend `SessionMeta` with `agents: AgentSummary[]`.
  - Add optional `agentId?: string` to `Session` for nested sessions
    (omitted on root).

- **`src/components/trace/parser.ts`**. Minimal change. `buildSession`
  already handles `isSidechain: true` records correctly. One addition:
  recognize and emit the `progress` record type (sidechain-only hook events)
  as a new stream event variant `kind: "progress"` with `hookEvent`,
  `hookName`, `command`, `parentToolUseID`. Otherwise progress events
  disappear silently when rendering a subagent session.

- **`src/components/trace/tool/AgentBody.tsx`**. The centerpiece change:
  ```tsx
  function AgentBody({ input, toolUseId, shortId, agents }) {
    const agent = agents.find(a => a.tool_use_id === toolUseId);
    const [nested, setNested] = useState<Session | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function onToggle() {
      setExpanded(x => !x);
      if (!nested && !loading && !error && agent) {
        setLoading(true);
        try {
          const jsonl = await fetchAgentJsonl(shortId, agent.agent_id);
          setNested(buildSession(parseJsonl(jsonl)));
        } catch (e) {
          setError(String(e));
        } finally {
          setLoading(false);
        }
      }
    }
    // ... existing dispatch prompt + agent type render, then:
    //   - "Open subagent trace (N msgs)" toggle if agent linked
    //   - "Subagent trace not available" if !agent (orphan, tool_use_id=null)
    //   - <NestedThread session={nested} /> when expanded
    //   - error message if error set
  }
  ```
  Fetch fires the first time the user expands. Cache lives on the component
  — fine since `AgentBody` only mounts when the parent `ToolCard` is open.

- **`src/components/trace/Thread.tsx`**. Pass `agents` from
  `session.meta.agents` and the `shortId` through to each `ToolCard`. One
  prop drilled two levels; not worth a context.

- **`src/components/trace/tool/ToolCard.tsx`**. Accept `shortId` and
  `agents` props, forward to `AgentBody` in the `case "Agent"` branch.

- **`src/components/trace/TraceViewer.tsx`**. Read `agents` from the trace
  summary endpoint (already loaded for breadcrumb data), pass into `Thread`
  via session meta. No new network call here.

### 6.3 New

- **`src/components/trace/NestedThread.tsx`**. A stripped-down `<Thread>`
  variant for nested subagent sessions:
  - No `<UserPrompt>` numbering ("1/N" doesn't apply — there's only one
    synthetic user message, the dispatch prompt, already shown in the
    parent).
  - No turn separators between user prompts.
  - Same `<ToolCard>`, `<AssistantText>`, `<ThinkingBlock>` rendering.
  - Indented container with a left border for visible depth.
  - Recursive by construction: if the subagent dispatched a sub-subagent,
    that's another `AgentBody` inside this `NestedThread`, which fetches
    another level on its own.

  Don't share rendering with `Thread.tsx` via props — the differences are
  enough that two clear components beat one branching one.

- **CSS additions** (existing files use plain class names):
  ```css
  .nested-thread {
    border-left: 2px solid var(--border-muted);
    padding-left: 16px;
    margin-top: 8px;
  }
  ```

### 6.4 Untouched

`UserPrompt.tsx`, `AssistantText.tsx`, `ThinkingBlock.tsx`, `Timeline.tsx`,
`ThreadControls.tsx`, `Hero.tsx`, `ViewerTopbar.tsx`, `PrCard.tsx`, all other
`tool/*` bodies.

## 7. API contract

### 7.1 `POST /api/ingest` (breaking change)

```
Method:           POST
Path:             /api/ingest
Content-Type:     application/x-tar
Authorization:    Bearer <github-pat>

Required headers:
  X-Vibeshub-Pr-Url:             https://github.com/<owner>/<repo>/pull/<n>
  X-Vibeshub-Platform:           claude-code
  X-Vibeshub-Plugin-Version:     <semver>
  X-Vibeshub-Client-Redactions:  <int>
Optional headers:
  X-Vibeshub-Session-Id:         <uuid>

Body: gzipped tar (plugin uses tarfile mode='w:gz'). Allowed members:
  main.jsonl                          (required, exactly 1)
  agents/<agent_id>.jsonl             (0..N)
  agents/<agent_id>.meta.json         (0..N, one per .jsonl above)

<agent_id> must match /^a[0-9a-f]{16}$/  (Claude Code format).
Total decompressed size <= settings.max_trace_bytes.
```

Response 201 (unchanged shape):
```json
{ "trace_id": "...", "short_id": "...", "trace_url": "..." }
```

Error codes:
- `400` — malformed tar, member name not in allowlist, agent jsonl without
  matching meta.json (or vice versa), missing required header
- `401` — auth (unchanged)
- `403` — PR ownership / private repo (unchanged)
- `404` — PR not found (unchanged)
- `413` — total decompressed size exceeds `max_trace_bytes`
- `502` — GitHub upstream (unchanged)

### 7.2 `agents/<agent_id>.meta.json` shape (in the tar)

```json
{
  "agentType": "Explore",
  "description": "Audit session read/render gaps",
  "toolUseId": "toolu_01YWpjaUGqQUW3vNtJb2dbvi"
}
```

`toolUseId` is plugin-resolved by the linker. May be `null` for orphan
subagents (count skew between Agent tool_uses and subagent files).

### 7.3 `TraceSummary` (returned by `GET /api/traces/{short_id}` and list endpoints)

New fields; existing fields unchanged.

```ts
interface TraceSummary {
  // ... existing fields
  agent_count: number;
  agents: AgentSummary[];
}

interface AgentSummary {
  agent_id: string;          // a-prefixed hex from filename
  tool_use_id: string | null;
  agent_type: string;
  description: string;
  message_count: number;
}
```

### 7.4 `GET /api/traces/{short_id}/raw` (unchanged externally)

Returns `main.jsonl` text. Internally reads `traces/<sid>/main.jsonl`
exclusively — the one-time migration (§9.1) brings all pre-existing rows
into this layout before this code ships, so no `blob_path` fallback exists.

### 7.5 `GET /api/traces/{short_id}/agents/{agent_id}` (new)

```
200 Content-Type: application/x-ndjson   (text body of agent-<id>.jsonl)
404                                       if agent_id not in trace.agents
```

Public, no auth. Same posture as `/raw`.

### 7.6 Blob store layout

```
traces/<sid>/main.jsonl
traces/<sid>/agents/<agent_id>.jsonl
traces/<sid>/agents/<agent_id>.meta.json
```

Names deterministic. `<agent_id>` is regex-sanitized before any path
construction.

### 7.7 Shared constants (plugin and backend both hardcode)

1. Allowed tar member names: `main.jsonl`, `agents/<id>.jsonl`,
   `agents/<id>.meta.json`.
2. Agent ID regex: `^a[0-9a-f]{16}$`.
3. Meta JSON shape: `{agentType, description, toolUseId}`.

Documented here as the source of truth; no shared module across Python and
TypeScript since duplication is two strings.

## 8. Testing strategy

The risk surface concentrates in three places: the **linker** (silent
miscategorization), the **tar roundtrip** (data loss / path traversal), and
the **frontend lazy fetch** (race conditions on rapid expand/collapse).
Everything else is shallow plumbing.

### 8.1 Fixtures

Build `tests/fixtures/sessions/` (committed, redacted of user content):

- `single-agent/` — 1 dispatch, 1 subagent file. Smallest case.
- `multi-agent/` — 5+ dispatches, mixed `agentType`, unique descriptions.
- `parallel-same-desc/` — synthetic: 3 dispatches with identical
  description, interleaved timestamps. Exercises the description-grouped
  fallback.
- `orphan-agent/` — main jsonl has 2 Agent calls, subagents/ has 1 file.
  Exercises `tool_use_id=null` path.
- `aborted-parent/` — subagents/ folder with no main jsonl. Plugin skips
  cleanly.

Each fixture is a directory mirroring the on-disk layout, so the same
fixtures feed the linker and bundle tests.

### 8.2 Plugin (pytest)

- **`tests/test_subagent_link.py`**. One assertion per fixture against the
  expected `list[AgentEntry]`. Orphan and aborted cases also assert
  `caplog` contains the expected warning lines.

- **`tests/test_bundle.py`**. Per fixture: (a) tar contains exactly the
  expected members (set equality); (b) untarring + comparing per-file bytes
  against `redact_jsonl(original)` is byte-identical. One additional test:
  input meta has no `toolUseId`, output meta has the linker's resolved
  value.

- **`tests/test_pipeline.py`**. Integration with mocked HTTP. Each fixture
  through `run_share_pipeline`. Assert: correct agents in payload, correct
  PR comment posted, no exception on `aborted-parent`.

### 8.3 Backend (pytest)

- **`tests/test_bundle_unpack.py`**. Adversarial-input unit tests:
  - Path traversal (`../../etc/passwd`) → 400.
  - Member outside allowlist → 400.
  - Agent jsonl without paired meta.json → 400.
  - Meta.json without paired jsonl → 400.
  - Decompressed size > `max_trace_bytes` → 413.
  - Tar bomb: bytes cap enforced before OOM.
  - Malformed tar → 400, no traceback leaked.

- **`tests/test_ingest.py`**. Build a valid bundle in-test using
  `build_bundle` from the plugin, POST to `/api/ingest`, assert: response
  201, trace row has correct `agents`, `agent_count`, `blob_prefix`,
  `blob_path=null`, blob store has expected keys.

- **`tests/test_e2e.py`** (existing). Extend round-trip: upload
  `multi-agent` bundle, `GET /api/traces/{sid}` returns
  `agent_count=N`, `GET /api/traces/{sid}/raw` returns main jsonl,
  `GET /api/traces/{sid}/agents/{agent_id}` returns each agent jsonl. One
  DELETE test confirming all blobs removed.

- **Skip**: re-running Azure-vs-local blob-store coverage for the new keys
  — they're indistinguishable from existing keys to `BlobStore`.

### 8.4 Frontend (vitest + Playwright)

- **`e2e/viewer.spec.ts`**. Mock summary endpoint with 2 agents, mock `/raw`
  with 2 `Agent` tool_use blocks, mock `/agents/<id1>` and `<id2>`. Assert:
  Agent cards visible with header, click → fetch fires, nested thread
  renders subagent assistant text; collapse → no re-fetch; click second →
  independent fetch and state. One adversarial: subagent fetch 404 →
  AgentBody shows error, can collapse, doesn't crash.

- **`src/components/trace/parser.test.ts`** (new). Feed a real subagent
  jsonl. Assert `buildSession` produces expected mix of `user_prompt`,
  `assistant_text`, `tool_use`, `progress` events. Snapshot test on
  `multi-agent/agents/<first-id>.jsonl` for regression.

- **Skip**: unit-testing `NestedThread` in isolation — covered by e2e.

### 8.5 Explicitly not tested

- Token-level redaction quality for subagent jsonls. `redact.py` is
  byte-level and the input bytes are indistinguishable from main jsonls;
  existing redaction tests cover it.
- Cross-platform tar quirks. stdlib `tarfile` is robust on Linux/macOS; no
  Windows plugin.
- Browser back/forward state on Agent expansion. Not URL-reflected for v1.

### 8.6 CI gate

Existing pytest jobs in `plugins/claude-code/` and `webapp/backend/` pick up
the new tests. Existing vitest + Playwright jobs cover frontend additions.
The migration applies cleanly on the CI seed DB before merge.

## 9. Rollout

This is a breaking ingest change. Existing plugin builds in the wild will
hard-fail against the new endpoint. Acceptable because:

- The project is pre-1.0 with no external users.
- The plugin ships out of the same repo; bumping both in lockstep is
  routine.
- The breaking change avoids carrying two ingest schemas in the backend
  permanently.

### 9.1 One-time storage migration

Pre-existing traces (all uploaded from this developer's machine, ~10–20 rows)
are migrated from the legacy single-blob layout to the v2 prefix layout via
a one-time script. This lets the backend read code be single-shape from day
one — no `blob_prefix ?? blob_path` fallback.

The script does the minimum: copy blobs into the new layout and update DB
columns. It does **not** attempt to enrich old traces with subagent data
from local files; old traces ship with `agents=[]` permanently. Subagent
content for those traces is lost as data but recoverable as UX (`AgentBody`
already falls back to dispatch prompt + final summary when `agents=[]` — see
§6.2).

**Location**: `webapp/backend/scripts/migrate_to_v2_storage.py`. Run via
`python -m scripts.migrate_to_v2_storage` from the backend package. Uses
the existing `BlobStore` and `Session` dependencies, so works against both
local-fs (dev) and Azure Blob (prod) without code changes.

**Algorithm** (idempotent — re-running is a no-op):

```python
for trace in session.execute(select(Trace).where(Trace.blob_prefix.is_(None))):
    old_key = trace.blob_path                       # "traces/<sid>.jsonl"
    new_key = f"traces/{trace.short_id}/main.jsonl"

    data = await blob_store.get(old_key)
    await blob_store.put(new_key, data)
    # blob_store.delete(old_key) — deferred to a second pass after DB commits

    trace.blob_prefix = f"traces/{trace.short_id}/"
    trace.blob_path = None
    trace.agents = []
    trace.agent_count = 0

await session.commit()

# Second pass: now-orphaned legacy blobs.
for trace in session.execute(select(Trace)):  # all rows have blob_prefix now
    legacy_key = f"traces/{trace.short_id}.jsonl"
    try:
        await blob_store.delete(legacy_key)
    except NotFound:
        pass
```

Two passes so a crash between blob-write and DB-commit doesn't lose the
original blob. The script supports `--dry-run` (prints planned actions
without writing) and `--limit N` (process N rows then exit, for cautious
first runs).

After this runs, every row has `blob_prefix` set and `blob_path` is null.
The `blob_path` column is left in place but unused — drop in a follow-up
migration whenever convenient.

### 9.2 Order of operations

1. Land migration #1 (DDL adds `agents`, `agent_count`, `blob_prefix`;
   makes `blob_path` nullable). No code changes yet — backend still reads
   from `blob_path` because the new columns are all null/empty.
2. Run `migrate_to_v2_storage.py` against prod. All rows now have
   `blob_prefix` set; `blob_path` is null on all rows.
3. Land backend code change (new `/api/ingest`, new `/agents/<id>`
   endpoint, single-shape read code). Old `/api/ingest` JSON path is
   removed in the same commit. Smoke-test by hitting `/raw` and a few
   `/agents/<id>` endpoints — all should work.
4. Land plugin change in the next PR. Bump `PLUGIN_VERSION`.
5. Land frontend rendering. Until this lands, new traces uploaded by
   step-4 plugins render with Agent cards showing today's UI (no expand
   affordance yet) — graceful.

Cross-PR coordination is only "step 2 must run before step 3 deploys"
and "plugin must not ship before backend".
