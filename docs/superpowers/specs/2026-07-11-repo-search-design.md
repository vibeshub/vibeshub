# Repo search: code and semantic search over session history

Date: 2026-07-11
Status: approved

## Problem

Teams accumulate agent sessions attached to PRs, but there is no way to ask
"why is this code like this?" after the fact. Competitors (Entire) now ship
"Code and Semantic Search" over session history. vibeshub has the raw
material (digests with ask/decisions/dead_ends/chapters, linked to PRs) and
no search of any kind, not even keyword.

A second problem is cold start: a repo that just installed the plugin has no
sessions, so search over sessions alone is useless on day one.

## Decisions

- Consumer: humans on vibeshub.ai (an MCP/agent surface is a possible later
  layer, not in scope).
- Scope: repo-scoped. Search lives on the repo page and queries one repo's
  corpus. Global and profile search are out of scope.
- Indexed unit: digest-derived documents (summary, chapters, file notes),
  not raw transcript messages.
- Retrieval: hybrid lexical + semantic. Postgres FTS plus pgvector cosine
  over OpenAI embeddings, merged with reciprocal-rank fusion. Keyword-only
  is the degraded fallback mode, not a milestone. RAG answer synthesis
  ("ask this repo") is phase 2, layered on this retrieval.
- Cold start: backfill merged PR titles/descriptions from GitHub as
  first-class search documents so search works before any trace exists.

## Data model

New table `search_documents`; one row is one searchable snippet.

| column | type | notes |
|---|---|---|
| id | UUID pk | |
| repo_full_name | String(255), indexed, NOT NULL | standalone traces (no repo) are excluded from v1 |
| trace_id | UUID FK traces.id, nullable, ON DELETE CASCADE | null for PR docs |
| source_type | String(16) | `summary` \| `chapter` \| `files` \| `pr` |
| title | Text | chapter title, PR title, or trace title |
| body | Text | the searchable text |
| anchor_uuid | String(64), nullable | chapter deep link into the trace viewer |
| pr_number | Integer, nullable | PR docs and trace docs alike (for linking) |
| pr_url | String(512), nullable | |
| is_private | Boolean, NOT NULL | copied from trace / repo visibility at index time |
| embedding | vector(1536) on Postgres, JSON on SQLite | via a TypeDecorator |
| embedding_model | String(64), nullable | enables scripted re-embeds on model swap |
| content_hash | String(64) | sha256 of title+body; skip re-embed when unchanged |
| created_at, updated_at | DateTime(tz) | |

Postgres-only, in the alembic migration behind a dialect guard:

- generated tsvector column `search_tsv` over `title || ' ' || body`, GIN
  indexed
- `CREATE EXTENSION IF NOT EXISTS vector`

No HNSW/ivfflat index in v1. Queries are repo-scoped; exact scan is fast at
thousands of rows and skipping the index removes a tuning knob.

## Trace ingest

At the end of the digest pipeline, after `digest_json` is persisted, explode
the digest into up to 12 docs (1 summary + up to 10 chapters + 1 files doc;
a digest with no chapters or file notes still yields the summary doc):

- one `summary` doc: body = ask + decisions + dead_ends + tests
- one `chapter` doc per chapter: title + caption, with `anchor_uuid`
- one `files` doc: all file_note paths + captions concatenated (this is
  what makes path queries like `auth/sessions.py` hit)

All docs for a trace are embedded in a single batched OpenAI embeddings call
(text-embedding-3-small). Indexing is delete-then-insert keyed on
`trace_id`, so digest regeneration and PR-update re-uploads stay consistent
and refresh `is_private`. Before deleting, embeddings from prior rows whose
`content_hash` is unchanged are carried over to the new rows, so a re-index
without content changes costs zero embedding calls.

Failure handling mirrors the digest agent: failures are recorded in
`agent_run` (`agent_name="search_index"`), the upload still succeeds, and on
embedding failure the docs are inserted without embeddings so FTS still
works. Embeddings are backfillable by re-running indexing (content_hash
makes it idempotent).

A one-shot script (`scripts/backfill_search_documents.py` pattern) indexes
existing traces that already have digests.

Consistency cascades: trace soft-delete also deletes its search documents.
The FK cascade covers hard deletes.

## Cold start: GitHub PR backfill

Trigger: a signed-in viewer clicks "Index PR history" on the repo page
(prominent in the empty state, small action elsewhere). Runs as a background
task using that user's stored OAuth token. Manual and re-runnable; no cron
or webhooks in v1.

Fetch: the GitHub list-PRs endpoint returns title and body, so the last 200
merged PRs cost 2-3 API calls. Each merged PR becomes one `pr` doc: title =
PR title, body = description truncated to 2,000 chars. Review threads and
commit messages are explicitly out of scope for v1 (API cost explodes;
phase 2 if PR bodies prove too thin).

Bookkeeping: new table `repo_search_index` (repo_full_name pk, status,
last_indexed_at, pr_count, indexed_by_login). Drives the UI ("312 PRs
indexed, 2 days ago", refresh action) and makes refresh incremental: fetch
only PRs updated since last_indexed_at, upsert by (repo_full_name,
pr_number). Runs are also logged to `agent_run` for usage tracking.

Privacy: repo visibility is read from the GitHub API at backfill time and
stamped on docs as `is_private`.

Blending: PR docs and trace docs share the table and the ranked results. A
PR that later gains a trace keeps its PR doc; the human-written description
and the digest are complementary and link to different places (GitHub vs
the trace viewer).

## Query path and API

`GET /api/repos/{owner}/{repo}/search?q=...`

1. Embed the query with a 2s timeout. On failure or timeout, degrade
   silently to FTS-only.
2. Run both retrievals repo-scoped: FTS via `websearch_to_tsquery` ranked
   by `ts_rank`, and pgvector cosine distance. Top 20 each.
3. Merge with reciprocal-rank fusion, k=60, no per-source weighting in v1.
4. Return top 10 results:
   `{type, title, snippet, trace_short_id?, anchor_uuid?, pr_number?,
   pr_url?, created_at}`. Snippets come from `ts_headline` when FTS
   matched, otherwise the truncated doc body.

Private docs are filtered with the same repo-read-access dependency used by
the private-trace endpoints. Per-IP rate limit of 30 requests/min
(in-memory) caps anonymous OpenAI embed spend.

SQLite dev fallback: the same endpoint loads the repo's docs and does LIKE
matching plus in-Python cosine over the JSON embeddings, feeding the
identical RRF and response code. Only the retrieval primitive differs
between environments.

## Frontend

One search input on the repo page above the existing tabs, styled to match
the page (subtle, no restructure). Typing 3+ chars, debounced 300ms, swaps
the tab content area for a results list; clearing or Esc restores the tabs.

Result row: small type glyph (chapter / session / PR), title, highlighted
snippet, relative date. Chapter results deep-link into the trace viewer at
the anchor. PR results link to GitHub.

Empty repo: the empty state carries the "Index PR history" affordance. No
em-dashes in any user-facing copy.

## Error handling

- Embedding API down at query time: FTS-only results, no user-visible
  error.
- Indexing failure at upload: upload unaffected, recorded in `agent_run`.
- Backfill failure midway: `repo_search_index.status` reflects it; refresh
  re-runs incrementally.

## Testing

- Backend pytest (`env/bin/pytest`): digest-to-docs explosion, RRF merge
  math, private-doc gating, FTS-degraded path, SQLite fallback path.
  OpenAI mocked, following the digest test pattern.
- Frontend vitest: search input behavior and result rendering.
- Playwright e2e: excluded (broken on main pre-existing).

## Out of scope / phase 2

- RAG answer synthesis ("ask this repo") on top of this retrieval.
- MCP/agent-facing search surface.
- Global and profile-scoped search.
- Transcript message-level indexing.
- PR review threads and commit messages in the backfill.
- HNSW vector index and RRF weight tuning (wait for real queries).
