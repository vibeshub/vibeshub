# Trace digest agent

Generates a 5-line digest + 3-8 semantic chapter anchors for an uploaded
Claude Code trace. Surfaces in the trace viewer's Hero panel and in the
PR comment body posted by the plugin.

## Flow

1. Backend calls `compute_digest(session, trace, blob, subagent_blobs)`
   from `app/api/trace_service.py::create_or_update_trace`, after the
   blob is written, before the transaction is committed.
2. `distill_with_uuids` (in `distill.py`) walks the JSONL once and
   classifies every event into a tier (see spec §5). Output is a single
   string with each retained event prefixed by `[uuid]`.
3. `pipeline.compute_digest` computes `sha256(distilled)` and compares
   to `trace.digest_input_hash`. Match → reuse persisted digest,
   `outcome=skip_unchanged`, no LLM call.
4. Otherwise: calls OpenAI `responses.parse` with `text_format=Digest`
   (Structured Outputs, so the schema is enforced server-side) and
   `reasoning.effort=low`.
5. Reads the already-validated `Digest` from `response.output_parsed`
   (None → `outcome=fail_schema`). Drops chapters whose `anchor_uuid`
   isn't in the distilled UUID surface. Strips em-dashes from every
   string field.
6. Persists `digest_json` and `digest_input_hash` on the Trace row.
7. Records the run in `agent_run` via `record_run`.

## Env vars

- `VIBESHUB_OPENAI_API_KEY`
- `VIBESHUB_OPENAI_ENDPOINT`
- `VIBESHUB_OPENAI_MODEL`

All three must be set. Missing any → `outcome=skip_no_config`, upload
still succeeds, viewer hides the DigestPanel.

## Known degradation modes

- **Trace exceeds 200k-token hard cap after the adaptive pass** — the
  distiller head/tail-truncates with a `[… elided N events …]` marker.
  `extra.distill_truncated=true` on the agent_run row. Digest may miss
  middle-of-trace decisions.
- **All chapter anchors invalid** — digest persists with `chapters=[]`,
  `outcome=ok`, `extra.chapters_kept=0`. The DigestPanel still renders
  the 5 bullets; just no "Jump to" rail.
- **LLM call fails / output is malformed** — `outcome=fail_call` /
  `fail_schema`. The viewer shows the existing Outcome card without a
  DigestPanel; the PR comment falls back to the one-line trace link.

## Operations

Daily cost rollup:
```sql
SELECT date_trunc('day', created_at) AS day,
       sum(input_tokens) AS in_tok,
       sum(output_tokens) AS out_tok
FROM agent_run
WHERE agent_name = 'digest'
GROUP BY 1 ORDER BY 1 DESC;
```

Failure-mode snapshot (last 7 days):
```sql
SELECT outcome, count(*) FROM agent_run
WHERE agent_name = 'digest' AND created_at > now() - interval '7 days'
GROUP BY 1 ORDER BY 2 DESC;
```

Per-trace history (debug a specific upload):
```sql
SELECT created_at, outcome, input_tokens, output_tokens, extra
FROM agent_run
WHERE trace_id = '<short_id>' ORDER BY created_at;
```

## Adding a new agent

1. Create `webapp/backend/app/agents/<name>/` with the same five files
   (`__init__.py`, `schema.py`, `pipeline.py`, `prompt.py`, README).
2. Reuse `app.agents._client.get_client/get_model` and
   `app.agents._usage.record_run`. The `Outcome` enum is shared.
3. Add a column to `agent_run.extra` for any per-agent metadata; no
   schema change required.
