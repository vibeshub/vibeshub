# Trace digest agent — Design

**Status**: draft, pending implementation
**Date**: 2026-06-06
**Branch**: `feature/trace-digest-agent`

## 1. Purpose

A trace today opens with Claude Code's built-in `ai-title` (one short line) and the existing `Outcome` card (stats, files touched, last assistant message). To understand *what actually happened* the reader still scrolls through 100-300 messages. The blog doc `docs/blog/team-feature-ideas.md` (P0 #1) calls out a trace digest as the single biggest accelerant for the "review starts from intent" workflow; this spec is the design for that digest.

At upload time, the backend distills the trace into a compact text form and runs one LLM call that returns a fixed-shape 5-line digest plus a list of semantic "chapters" that anchor to specific events in the trace. The digest is persisted alongside the blob, surfaced in the trace viewer's hero, embedded in the PR comment body, and queryable via Postgres for cost and failure-mode rollups.

The whole LLM stack lives in a new `webapp/backend/app/agents/` folder; the trace digest is the first agent. Future agents (semantic search reranker, diff-to-reasoning correlator) get their own sibling subfolders and reuse the same shared client and observability table.

## 2. Non-goals

- Backfilling existing traces. Pre-feature uploads have no digest; re-uploading a PR is the only path to enrichment. Matches the `migration_simplicity` preference: prefer accepting data degradation over an enrichment script.
- LLM-output quality evaluation. No "is the digest good" tests; output quality is reviewed by hand against real traces after deploy.
- A separate route or modal for the digest. The digest renders inline in the existing trace hero; no new viewer page.
- A separate dashboard for `agent_run` metrics. The table is the durable observability surface; ad-hoc SQL is the query layer for v1.
- Backfilling stable element IDs on every thread event for deep-linking. We add only the IDs the chapter anchors need; full deep-linking is team-feature item #2 and a separate ticket.
- Multi-model or multi-provider abstraction. The OpenAI Python SDK pointed at the configured endpoint is the only LLM client; this is not a model gateway.

## 3. Architecture & data flow

```
Plugin (claude-code)            Backend                            Frontend
──────────────────              ───────                            ─────────
upload(jsonl + agent jsonls)
                      ─────►   POST /api/traces
                                  ├─ existing: redact + store blob
                                  ├─ NEW: agents.digest.compute_digest(
                                  │       blob, subagent_blobs)
                                  │   ├─ distill → compact text
                                  │   ├─ hash distilled; reuse if unchanged
                                  │   ├─ OpenAI responses.create (json_object)
                                  │   ├─ Pydantic + anchor + em-dash validation
                                  │   ├─ persist digest_json + digest_input_hash
                                  │   │   on the trace row
                                  │   └─ record_run() → agent_run table
                                  │
                                  └─ response: {short_id, trace_url, digest?}
                      ◄─────
build_comment_body(
  trace_url, pr_url,
  digest=digest)
gh pr comment ...

                                                GET /api/traces/{id}
                                                returns TraceSummary
                                                with ai_digest field
                                                       │
                                                       ▼
                                                Hero renders DigestPanel
                                                Thread renders inline
                                                ChapterDividers at
                                                anchored events
```

Upload latency on the hook grows from ~1s to ~5-15s (the LLM call). The plugin blocks on the upload response before posting the PR comment so the comment body contains the digest; that latency lives inside the existing PostToolUse hook and is invisible inside a long Claude Code session.

## 4. Module layout

### 4.1 Backend

```
webapp/backend/app/
├── agents/
│   ├── __init__.py
│   ├── _client.py            # shared OpenAI client + env-var loader
│   │                         #   VIBESHUB_OPENAI_API_KEY
│   │                         #   VIBESHUB_OPENAI_ENDPOINT
│   │                         #   VIBESHUB_OPENAI_MODEL
│   ├── _usage.py             # record_run() helper
│   └── digest/
│       ├── __init__.py       # exports compute_digest, Digest
│       ├── distill.py        # tier classification, adaptive pass
│       ├── prompt.py         # SYSTEM_PROMPT constant
│       ├── schema.py         # Pydantic Digest + Chapter models
│       ├── pipeline.py       # orchestration
│       └── README.md         # what this agent does, prompt knobs,
│                             # known degradation modes
├── storage/
│   └── models.py             # adds digest_json, digest_input_hash on Trace
│                             # adds AgentRun model
└── api/
    └── traces.py             # calls agents.digest.compute_digest on upload
```

### 4.2 Frontend

```
webapp/frontend/src/components/trace/
├── DigestPanel.tsx           # 5-bullet abstract + "Jump to" chapter rail
├── DigestPanel.module.css
├── ChapterDivider.tsx        # inline soft-rule + title + caption
└── ChapterDivider.module.css
```

Plus a small type addition to `webapp/frontend/src/types.ts::TraceSummary` and a one-line wrapper change in `webapp/frontend/src/components/trace/Thread.tsx` so each event renders with an `id` attribute of the form `evt-<uuid>`.

### 4.3 Plugin

```
plugins/cli/vibeshub_client/
├── upload.py                 # UploadResult gains optional digest field
└── post_comment.py           # build_comment_body accepts digest kwarg
```

## 5. Distillation

The distiller (`agents/digest/distill.py::distill`) walks the JSONL once and classifies every event into a tier. Pure function, no I/O, easy to unit-test.

Each emitted line is prefixed with its source event UUID in `[uuid]` form so the LLM can reference any retained event as a chapter `anchor_uuid`. Dropped (Tier-4) and collapsed-away (subagent body, adaptive-pass) events have no UUID in the output and therefore cannot be picked as anchors — the anchor-validation pass in §6.4 enforces this by construction.

### 5.1 Tiers

**Tier 1 — verbatim (the spine of the story)**
- User prompts (full text).
- Assistant text blocks (decisions and reasoning).
- Each subagent's *final* assistant text (its return value to the parent).

**Tier 2 — collapse to a one-liner (the actions)**
- `tool_use` (parent): `<Tool> <terse-input>`. Concretely:
  - `Edit webapp/frontend/src/components/trace/Hero.tsx`
  - `Bash: git diff main --stat` (command truncated to ~120 chars)
  - `Read webapp/frontend/src/api.ts:120-200`
  - `Grep "fetchTrace" in webapp/frontend/src`
- `tool_result`: status word + first ~80 chars of stdout. Errors keep ~400 chars (dead ends are load-bearing for the "Dead ends" bullet).
- Drops `new_string` / `old_string` / file contents entirely. Biggest token saving.

**Tier 3 — subagents (don't inline transcripts)**
- The parent `Task` tool_use becomes a single line:
  `Subagent[<agent_type>]: <one-line distilled outcome>`
- The one-liner is computed heuristically (no separate LLM call): take the subagent's final assistant_text, first sentence, ~120 chars. If absent, fall back to `(N tool calls, last action: Edit foo.ts)`.
- A trace with 10 subagents grows by 10 lines, not 10×N events.

**Tier 4 — drop entirely**
- `permission-mode`, `file-history-snapshot`, `attachment`, `last-prompt`, `ai-title`.
- Thinking blocks (the assistant_text that follows captures the decision).
- `TodoWrite` tool_uses (scratchpad; real work shows up in subsequent tool calls).
- Identical adjacent duplicates.

### 5.2 Adaptive pass

After Tiers 1-4, if the distilled form is still over a 60k-token target:

- Identify "exploration runs" — stretches of ≥6 consecutive tool calls with no intervening assistant_text. Collapse each into one line: `[exploration: 23 reads, 5 greps under webapp/frontend]`.
- If still over the 200k-token hard cap, head/tail truncate: keep first 30%, last 30%, drop the middle 40% with a `[… N events elided …]` marker. Log a warning and set `extra.distill_truncated = true` on the `agent_run` row.

### 5.3 Expected compression

| Trace | Raw | Tier 1+2 distilled (est.) |
|---|---|---|
| 3.5 MB, 311 events | ~900k tokens | ~25-40k tokens |
| 1.4 MB, 332 events | ~350k tokens | ~10-18k tokens |
| 1.3 MB, 316 events | ~330k tokens | ~10-15k tokens |

Roughly 20-30× compression on a typical trace. The adaptive pass kicks in only for outliers with deep subagent fan-out.

## 6. LLM call

### 6.1 Client

`agents/_client.py` constructs a module-level `OpenAI` client at import time, mirroring `polybot/storybot/twitter_pipeline.py:1928`:

```python
from openai import OpenAI

API_KEY = os.environ.get("VIBESHUB_OPENAI_API_KEY", "")
ENDPOINT = os.environ.get("VIBESHUB_OPENAI_ENDPOINT", "")
MODEL = os.environ.get("VIBESHUB_OPENAI_MODEL", "")

def get_client() -> OpenAI | None:
    if not (API_KEY and ENDPOINT and MODEL):
        return None
    return OpenAI(base_url=ENDPOINT, api_key=API_KEY)
```

Returning `None` when env vars are unset is the sentinel every agent checks before calling.

### 6.2 Call shape

Mirrors `pick_event` / `pick_chart` in `polybot/storybot/twitter_pipeline.py`:

```python
response = client.responses.create(
    model=MODEL,
    instructions=SYSTEM_PROMPT,
    input=distilled,
    max_output_tokens=4000,
    reasoning={"effort": "low"},
    text={"format": {"type": "json_object"}},
)
```

`reasoning.effort="low"` is appropriate: structured summarization over a pre-distilled input is not a reasoning-heavy task.

### 6.3 Output schema

`agents/digest/schema.py`:

```python
class Chapter(BaseModel):
    anchor_uuid: str
    title: str = Field(max_length=80)
    caption: str = Field(max_length=160)

class Digest(BaseModel):
    ask: str = Field(max_length=200)
    decisions: str = Field(max_length=200)
    files: str = Field(max_length=200)
    tests: str = Field(max_length=200)
    dead_ends: str = Field(max_length=200)
    chapters: list[Chapter] = Field(default_factory=list, max_length=10)
```

### 6.4 Post-validation

After Pydantic validation:

1. **Anchor UUID check.** Each `chapter.anchor_uuid` must appear in the set of event UUIDs the distiller emitted. Invalid chapters are dropped silently; if all chapters drop, the digest still ships with `chapters: []`. The drop count is recorded on `agent_run.extra.chapters_kept` / `chapters_total`.
2. **Em-dash sweep.** Strip `—` from every string field per the user's no-em-dashes preference. Replace with `,` or `.` depending on adjacency (regex; no model retry).

## 7. Persistence

### 7.1 Trace row additions

`storage/models.py::Trace` gains:

- `digest_json` (jsonb, nullable) — the validated `Digest` Pydantic model serialized.
- `digest_input_hash` (text, nullable) — sha256 of the distilled string at the time of the call.

These are denormalized for the hot path (`/api/traces/{id}` returns the digest inline). One Alembic migration adds both columns.

### 7.2 agent_run table

New table for observability. Populated by `agents/_usage.py::record_run()` after every digest attempt (success, skip, or failure):

```
agent_run
─────────
id                uuid    pk
agent_name        text    "digest" today; future agents reuse
trace_id          text    fk → trace.short_id (nullable for non-trace agents)
created_at        timestamptz
model             text    snapshot of VIBESHUB_OPENAI_MODEL at call time
input_tokens      int
output_tokens     int
latency_ms        int
outcome           text    ok | skip_unchanged | skip_no_config |
                          fail_call | fail_schema | fail_anchors
error_detail      text    nullable; first 500 chars of error / raw output
extra             jsonb   per-agent metadata; for digest:
                          {chapters_kept, chapters_total, distill_truncated}

indexes:
  (agent_name, created_at)
  (trace_id)
  (outcome, created_at)
```

Writes are fire-and-forget: wrapped in try/except, never blocks the upload. The structured `digest_run` log line stays as well — it is the running tape; the table is the durable observability surface.

### 7.3 Why two stores

`digest_json` + `digest_input_hash` on the trace row are the *current* state (read on the hot path by the trace viewer). `agent_run` is the *history* of runs (analytical queries: cost rollups, failure rates, latency trends). Separate access patterns; separate storage.

## 8. Re-upload idempotency

Same PR pushed again → trace blob re-uploaded → today re-runs everything. With the digest:

1. Distill the new blob.
2. Compute the distilled hash.
3. If it matches `trace.digest_input_hash`, skip the LLM call, return the persisted digest, record `outcome=skip_unchanged` on `agent_run`.
4. Otherwise call the LLM, persist the new digest, update the hash.

This is the biggest real-world cost saver: most "comment refresh" pushes touch one file and don't change the distilled story, so they reuse for free. The PR-comment-edit step also skips when the digest is unchanged.

## 9. Failure handling

Every layer fails open. The upload path never fails because of the digest.

| Failure | Behavior |
|---|---|
| Env vars unset | `record_run(outcome=skip_no_config)`. No call. Upload succeeds. |
| OpenAI 429 / 5xx / timeout | One retry with backoff, then `record_run(outcome=fail_call)`. |
| Invalid JSON output | `record_run(outcome=fail_schema, error_detail=output[:500])`. No retry. |
| Pydantic schema mismatch | Same as invalid JSON. |
| All chapter anchors invalid | Digest persists with `chapters=[]`. `record_run(outcome=ok, extra.chapters_kept=0)`. Not a failure. |
| Distilled input empty | Skip the call entirely. |
| Distilled input over 200k tokens after adaptive pass | Truncate, log a warning, call anyway, set `extra.distill_truncated=true`. |

If a previous digest exists on the trace row and the new call fails, the previous digest stays — the viewer never loses ground.

## 10. Plugin and PR-comment integration

### 10.1 Upload response

`webapp/backend/app/api/traces.py` extends the upload response with an optional `digest` field. When the digest call succeeds, the full `Digest` JSON is included. When it skips or fails, the field is absent.

### 10.2 UploadResult

`plugins/cli/vibeshub_client/upload.py::UploadResult` gains an optional `digest: dict | None` field. The plugin treats it as optional: absent is fine, present is consumed.

### 10.3 Comment body

`plugins/cli/vibeshub_client/post_comment.py::build_comment_body` accepts an optional `digest` kwarg. When present, the body becomes:

```
**Ask:** <ask>
**Key decisions:** <decisions>
**Files touched:** <files>
**Tests added:** <tests>
**Dead ends:** <dead_ends>

Claude Code trace for this PR: <pr-style trace URL>
```

When absent, the body is the existing one-line form verbatim. Subsequent pushes refresh the same comment with the latest digest.

## 11. Frontend integration

### 11.1 TraceSummary type

`webapp/frontend/src/types.ts::TraceSummary` gains:

```ts
ai_digest?: {
  ask: string;
  decisions: string;
  files: string;
  tests: string;
  dead_ends: string;
  chapters: Array<{ anchor_uuid: string; title: string; caption: string }>;
};
```

### 11.2 DigestPanel

New `webapp/frontend/src/components/trace/DigestPanel.tsx`, rendered by `Hero` above the existing `Outcome` card when `trace.ai_digest` is present. Renders the five bullets as a tight panel, and (when `chapters.length > 0`) a "Jump to" rail with one button per chapter.

### 11.3 ChapterDivider

New `webapp/frontend/src/components/trace/ChapterDivider.tsx`. `Thread` renders one inline above the event whose UUID matches each chapter anchor: soft horizontal rule + chapter title + caption (italic, ~14px).

### 11.4 Anchor mechanism

`Thread.tsx` wraps each event in `<div id={`evt-${uuid}`}>` so the DigestPanel buttons and inline dividers can target the same element ids via `scrollIntoView`. URL-hash deep-linking is out of scope for this spec; it falls under team-feature item #2 (deep-linkable trace steps). Whoever lands first sets up the IDs; the other ships for free.

### 11.5 Failure-mode chart

| Backend state | What renders |
|---|---|
| Digest present, chapters present | DigestPanel (full) + inline ChapterDividers |
| Digest present, chapters empty | DigestPanel (no "Jump to" rail) |
| Digest absent | Existing viewer, no DigestPanel |

## 12. Testing

### 12.1 Backend unit tests (`webapp/backend/tests/agents/digest/`)

`test_distill.py` — golden-file tests against 3 anonymized fixtures (short, long-with-subagents, tool-result-heavy):
- Tier classification: every event lands in exactly one tier; Tier-4 events never appear in output.
- Subagent collapse: parent context grows by exactly one line per subagent dispatch.
- Adaptive pass: synthesized over-threshold fixture triggers exploration collapse; below-threshold does not.
- Hard-cap truncation: head/tail kept, middle elided with marker, `distill_truncated` flag set.
- Determinism: same input → identical distilled string.

`test_pipeline.py` — orchestration with a mocked OpenAI client:
- Happy path: digest persisted, `agent_run` row written with `outcome=ok`.
- Call uses `text={"format": {"type": "json_object"}}`.
- Env vars unset → `outcome=skip_no_config`, no API call, upload succeeds.
- API raises → retry → fail → `outcome=fail_call`, upload succeeds.
- Invalid JSON → `outcome=fail_schema`, error_detail captures first 500 chars.
- Bogus anchors → invalid chapters dropped, digest persisted, `extra.chapters_kept` reflects the drop.
- Em-dash sweep: model output with `—` is stripped before persist.
- Idempotency: identical distilled input → `outcome=skip_unchanged`, no API call.

`test_schema.py` — Pydantic max_length enforcement, missing fields rejected, chapters cap at 10.

### 12.2 Backend integration test

`webapp/backend/tests/api/test_traces_digest.py`: POST a real fixture trace to `/api/traces` with the OpenAI client patched at the seam. Assert the response includes `digest`, the trace row has `digest_input_hash` and `digest_json` populated, and a row exists in `agent_run`.

### 12.3 Plugin tests

- `test_upload.py`: `UploadResult.digest` round-trips when present; absent backend field is handled.
- `test_post_comment.py`: `build_comment_body(..., digest=...)` includes the 5-line digest above the link; the existing one-line body is preserved when `digest=` is absent (regression guard).
- `test_hook_e2e.py`: end-to-end mock confirming the PR comment body reflects whatever the backend returned.

### 12.4 Frontend tests

- `routes/TraceView.test.tsx`: three cases mirroring the failure-mode chart.
- `components/trace/DigestPanel.test.tsx`: renders all five bullets; chapter buttons trigger scroll-into-view on the right element id.
- `components/trace/Thread.test.tsx`: ChapterDivider appears above the right event when chapters are present; doesn't render when empty.

### 12.5 What's explicitly not tested

- LLM output quality. The OpenAI call is mocked everywhere. Output quality is evaluated by hand against real traces after deploy.
- No fuzz or property tests on the distiller; golden-file diffs are the most informative signal at this scale.

## 13. Operations

### 13.1 Env vars (new, set in production secrets)

- `VIBESHUB_OPENAI_API_KEY`
- `VIBESHUB_OPENAI_ENDPOINT`
- `VIBESHUB_OPENAI_MODEL`

Until all three are set, every digest call records `outcome=skip_no_config` and the upload still succeeds. This means the code can ship to production with the keys unset, and the digest turns on the moment they're added.

### 13.2 Cost rollups

```sql
SELECT date_trunc('day', created_at) AS day,
       sum(input_tokens) AS in_tok,
       sum(output_tokens) AS out_tok
FROM agent_run
WHERE agent_name = 'digest'
GROUP BY 1
ORDER BY 1 DESC;
```

### 13.3 Failure-mode rollup

```sql
SELECT outcome, count(*)
FROM agent_run
WHERE agent_name = 'digest' AND created_at > now() - interval '7 days'
GROUP BY 1
ORDER BY 2 DESC;
```

### 13.4 Per-trace history

```sql
SELECT created_at, outcome, input_tokens, output_tokens, extra
FROM agent_run
WHERE trace_id = '<short_id>'
ORDER BY created_at;
```

## 14. Open questions deferred to implementation

- Exact prompt copy for `SYSTEM_PROMPT`. Drafted during implementation against the three sample traces; reviewed before merge.
- Whether `reasoning.effort` is `low` or `medium`. Start with `low`; revisit once we see real outputs.
- Exact cost numbers per trace. Pending the model id being wired in production; the `agent_run` rollup quantifies this directly after first deploy.
