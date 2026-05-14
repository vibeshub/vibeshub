# vibeshub — Design Spec

**Date:** 2026-05-08
**Status:** Approved (pending implementation plan)

## 1. Goal

Host Claude Code conversation traces, attached to the pull request that the conversation produced. When a user creates a PR via `gh pr create`, a Claude Code plugin uploads the session's transcript to vibeshub and posts a comment on the PR linking to a public viewer page.

The system has two top-level pieces:
- A **plugin** that runs inside Claude Code (and, later, other AI coding platforms).
- A **web app** that ingests, stores, and displays traces.

## 2. Scope (v1)

In:
- One plugin: Claude Code.
- One trigger: `PostToolUse` hook matching `gh pr create`.
- One trace per PR (the session that ran `gh pr create`).
- Public traces — anyone with the URL can view.
- Redaction with a client-side preview and y/n confirmation, plus a server-side defense-in-depth pass.
- GitHub-token-based identity for uploads (verified server-side).
- A trace viewer page that wraps the rendered output of the `claude-code-log` library.
- Deployment: a single Railway service for the FastAPI backend (which also serves the built React frontend), Railway Postgres add-on, Railway volume for blobs.

Explicitly out (deferred):
- GitHub OAuth login on the web app.
- Access controls mirroring repo permissions.
- Other platforms (Cursor, Codex, etc.) — but the plugin folder layout is built to accept them.
- Other triggers (`git push`, slash commands beyond manual retry, Stop hooks).
- Multi-session aggregation per PR.
- R2/S3 blob storage (interface designed for it; implementation later).

## 3. End-to-end flow

```
┌─────────────────────────────────────────────────────────────┐
│ Claude Code session                                          │
│                                                              │
│  Bash tool runs: gh pr create ...                            │
│       │                                                      │
│       ▼                                                      │
│  PostToolUse hook (matcher: bash command contains            │
│                              "gh pr create")                 │
│       │                                                      │
│       ├─ parse PR URL from gh stdout                         │
│       ├─ locate this session's transcript JSONL              │
│       ├─ run client-side redaction                           │
│       ├─ print preview to terminal:                          │
│       │     "12 messages, 3 redactions, 41KB"                │
│       ├─ prompt y/n on stderr                                │
│       │                                                      │
│       │  (on yes)                                            │
│       ├─ POST /api/ingest                                    │
│       │     Authorization: Bearer $(gh auth token)           │
│       │     body: { transcript_jsonl, pr_url, platform,      │
│       │             plugin_version, session_id }             │
│       │                                                      │
│       │  (on 200)                                            │
│       └─ gh pr comment <PR> -b                               │
│             "Claude Code trace: <vibeshub-url>"              │
└─────────────────────────────────────────────────────────────┘
```

The hook does not block on errors after `gh pr create` succeeds — failures print to stderr and exit 0 so Claude's main flow is unaffected.

## 4. Repo layout

```
vibeshub/
├── plugins/
│   ├── shared/                       # Python lib reused across platforms
│   │   └── vibeshub_client/
│   │       ├── reader.py             # ABC: TranscriptReader
│   │       ├── upload.py             # POST to /api/ingest
│   │       ├── redact.py             # client-side regex + entropy pass
│   │       ├── preview.py            # terminal y/n confirm
│   │       └── post_comment.py       # `gh pr comment` wrapper
│   ├── claude-code/                  # The Claude Code plugin
│   │   ├── .claude-plugin/
│   │   │   └── plugin.json
│   │   ├── skills/share-pr/          # Slash-command for manual retry
│   │   │   └── SKILL.md
│   │   ├── hooks/on_pr_create.py     # PostToolUse hook entry point
│   │   ├── reader.py                 # TranscriptReader for Claude Code JSONL
│   │   └── settings.example.json
│   └── README.md                     # "How to add a new platform"
├── webapp/
│   ├── backend/                      # FastAPI
│   │   ├── app/
│   │   │   ├── main.py               # app factory, static mount for frontend
│   │   │   ├── api/
│   │   │   │   ├── ingest.py         # POST /api/ingest
│   │   │   │   ├── traces.py         # GET/DELETE /api/traces/...
│   │   │   │   └── render.py         # internal: HTML render via claude-code-log
│   │   │   ├── auth/
│   │   │   │   └── github.py         # token verification
│   │   │   ├── redact/
│   │   │   │   └── patterns.py       # server-side defense-in-depth
│   │   │   ├── storage/
│   │   │   │   ├── db.py             # Postgres (SQLAlchemy)
│   │   │   │   ├── models.py
│   │   │   │   └── blob.py           # BlobStore interface + LocalDirBlobStore
│   │   │   └── settings.py           # pydantic-settings, env-driven
│   │   ├── alembic/                  # migrations
│   │   ├── tests/
│   │   └── pyproject.toml
│   └── frontend/                     # React + Vite
│       ├── src/
│       │   ├── routes/
│       │   │   ├── PrTracesList.tsx  # /<owner>/<repo>/pull/<n>
│       │   │   └── TraceView.tsx     # /<owner>/<repo>/pull/<n>/<short-id>
│       │   ├── components/
│       │   │   ├── TraceFrame.tsx    # sandboxed iframe wrapping rendered HTML
│       │   │   └── TraceHeader.tsx
│       │   └── api.ts
│       └── package.json
├── docs/
│   └── superpowers/specs/2026-05-08-vibeshub-design.md
├── env/                              # existing Python venv (gitignored)
└── README.md
```

## 5. Plugin (Claude Code, v1)

### 5.1 Trigger

A `PostToolUse` hook registered for the `Bash` tool with a matcher that fires when the command line contains `gh pr create`. The hook is configured via the plugin's `settings.json` template that users install.

### 5.2 Hook responsibilities

The hook script (`plugins/claude-code/hooks/on_pr_create.py`):
1. Reads the tool result from stdin (the hook protocol delivers tool inputs/outputs as JSON on stdin).
2. Extracts the PR URL from the `gh pr create` stdout. If absent (e.g., command failed), exits 0 silently.
3. Resolves the current session's transcript path. Claude Code stores transcripts at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. The session ID is available in the hook payload (Claude Code populates `session_id` in the hook input). The encoded-cwd convention is `cwd` with `/` replaced by `-`.
4. Loads the JSONL file (with one retry after 200ms in case the session writer hasn't flushed).
5. Hands off to the shared pipeline: redact → preview → upload → comment.

### 5.3 Slash command for manual retry

`/share-pr` slash command (skill at `plugins/claude-code/skills/share-pr/SKILL.md`) takes an optional PR URL or number. Use cases:
- Server was down when the hook ran.
- User created the PR through the GitHub UI rather than `gh pr create`.
- User wants to re-share after fixing something.

### 5.4 Configuration

`plugins/claude-code/settings.example.json` documents:
- `vibeshub.serverUrl` (default: `https://vibeshub.app`)
- `vibeshub.skipPreview` (default: `false`) — skip the y/n prompt; off by default in v1.

## 6. Shared client library

`plugins/shared/vibeshub_client/`:

- **`reader.py`** — abstract base class:
  ```python
  class TranscriptReader(ABC):
      @abstractmethod
      def find_session(self, hook_input: dict) -> Path: ...
      @abstractmethod
      def platform_id(self) -> str: ...
  ```
  Each platform plugin provides a concrete subclass.
- **`redact.py`** — applies a list of named regex patterns and an entropy heuristic for high-entropy tokens >32 chars. Patterns include: AWS access/secret keys, GitHub tokens (`ghp_`, `gho_`, `ghs_`), OpenAI keys (`sk-`), Anthropic keys (`sk-ant-`), Stripe keys, JWT-shaped tokens, and `.env`-style `KEY=value` lines where the value looks secret-like. Returns the redacted JSONL plus a `RedactionReport` (counts per category).
- **`preview.py`** — prints to stderr a small block: message count, total bytes, redaction counts, then prompts `Upload to vibeshub? [y/N]`. Supports `VIBESHUB_AUTO_YES=1` env var for non-interactive use.
- **`upload.py`** — `POST /api/ingest` with Bearer token from `gh auth token`. On 5xx/network error, returns a structured failure result (caller decides whether to retry).
- **`post_comment.py`** — runs `gh pr comment <PR> -b "<body>"`. Body template lives here. v1 default body:
  ```
  Claude Code trace for this PR: <vibeshub-url>

  Uploaded by the PR author. Traces are public by default.
  ```

## 7. Web app — backend (FastAPI)

### 7.1 Stack

- Python 3.12, FastAPI, Uvicorn.
- SQLAlchemy 2.x + Alembic for Postgres.
- pydantic-settings for env-driven config.
- `claude-code-log` (PyPI) for trace rendering.
- httpx for outbound calls (GitHub API).

### 7.2 API surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/ingest` | Bearer GH token | Upload a trace |
| `GET`  | `/api/traces/{owner}/{repo}/pull/{n}` | none | List traces for a PR |
| `GET`  | `/api/traces/{trace_id}` | none | Get trace metadata |
| `GET`  | `/api/traces/{trace_id}/rendered` | none | Get the rendered HTML body (cached) |
| `GET`  | `/api/traces/{trace_id}/raw` | none | Get raw redacted JSONL |
| `DELETE` | `/api/traces/{trace_id}` | Bearer GH token (owner only) | Delete a trace |

### 7.3 Ingest pipeline

`POST /api/ingest`:
1. Verify Bearer token by calling `GET https://api.github.com/user` with it. Cache the lookup for the duration of the request. If invalid → 401.
2. Parse PR URL → `(owner, repo, pr_number)`. Call `GET /repos/{owner}/{repo}/pulls/{pr_number}`:
   - Confirm the PR exists.
   - Confirm the **repo is public**. Private-repo PRs are rejected in v1 (→ 403 with a clear message) since traces would expose private code. This restriction lifts when GitHub OAuth + access controls land.
   - Confirm the PR's author login matches the verified user (`gh pr create` creates PRs as the authenticated user, so this should hold for the supported flow). Mismatch → 403.
3. Run server-side redaction over the submitted JSONL (defense in depth — the plugin's redaction is the primary layer; this catches anything missed).
4. Generate a `short_id` (10-char base32, collision-checked).
5. Write the redacted JSONL to the blob store at `traces/<short_id>.jsonl`.
6. Insert a row into `traces`.
7. Respond `201` with `{trace_id, trace_url}`.

### 7.4 Data model

```
traces
  id                 uuid   PK
  short_id           text   UNIQUE, indexed
  owner_login        text   indexed
  repo_full_name     text   indexed
  pr_number          int    indexed
  pr_url             text
  pr_title           text       -- denormalized from GitHub API at ingest
  platform           text   ('claude-code', etc.)
  plugin_version     text
  session_id         text
  byte_size          int
  message_count      int
  redaction_count_client  int
  redaction_count_server  int
  blob_path          text
  created_at         timestamptz
  deleted_at         timestamptz NULL

renders                       -- cache table for rendered HTML
  trace_id          uuid   FK -> traces.id, PK
  html              text
  rendered_at       timestamptz
  renderer_version  text       -- so we can invalidate when claude-code-log upgrades
```

### 7.5 Rendering

`GET /api/traces/{id}/rendered`:
- Look up cached row in `renders` for current `renderer_version`. If hit, return.
- Else: load JSONL from blob, invoke `claude-code-log` (in-process) to produce HTML, store in `renders`, return.

If rendering raises, return a JSON `{ error: "render_failed", fallback: "raw" }` response — the frontend then renders the raw JSONL with basic syntax highlight as a fallback path.

### 7.6 Storage

- Postgres for metadata + render cache.
- `BlobStore` interface in `storage/blob.py`. v1 implementation: `LocalDirBlobStore` writing to `BLOB_DIR` (a Railway volume mount). Future: `S3BlobStore` / `R2BlobStore` behind the same interface.

### 7.7 GitHub API usage

For ingest, we make two calls per request:
- `GET /user` (token verification, identity).
- `GET /repos/{owner}/{repo}/pulls/{pr_number}` (PR existence + ownership check).

We add an `If-None-Match`/ETag cache for the second call keyed on PR URL with a short TTL (60s) since the same PR may be re-uploaded via slash command after the comment fails.

## 8. Web app — frontend (React + Vite)

### 8.1 Routes

- `/<owner>/<repo>/pull/<n>` — list of traces for that PR. v1 will usually have one. Each entry links to the trace view.
- `/<owner>/<repo>/pull/<n>/<short-id>` — the trace view page.
- `/` — minimal landing page explaining what vibeshub is and how to install the plugin.

### 8.2 Trace view

The page is composed of:
- **Header** (our chrome): owner avatar/login, repo, PR title (denormalized at ingest time — see open questions §13), timestamp, "view raw" link. No delete UI in v1; deletion is performed by calling `DELETE /api/traces/{trace_id}` with the owner's `gh auth token` (the slash command will expose this as `/share-pr delete <url>`). A UI delete button arrives with GitHub OAuth.
- **Body**: a sandboxed `<iframe srcDoc={html}>` containing the `claude-code-log`-rendered HTML. Sandboxing isolates its CSS from ours and prevents any embedded scripts from running in our origin.
- **Fallback**: if the API returns `render_failed`, render the raw JSONL with syntax highlight (`shiki` or `prism-react-renderer`).

### 8.3 Build & serve

- `npm run build` produces `webapp/frontend/dist/`.
- The FastAPI app mounts that directory as static files at `/`, with a catch-all route that returns `index.html` for unknown paths (so client-side routing works on hard refresh).

## 9. Deployment (Railway)

- One Railway service from the repo's `webapp/backend/` Dockerfile, which also `COPY`s the pre-built frontend dist.
- Railway Postgres add-on → injected as `DATABASE_URL`.
- Railway volume mounted at `/data/blobs` → `BLOB_DIR=/data/blobs`.
- Custom domain (e.g., `vibeshub.app`) attached to the service.
- No GitHub App, no bot account — comments are posted by the user from their machine via `gh pr comment`.

## 10. Error handling

| Failure | Behavior |
|---|---|
| `gh pr create` itself failed | Hook sees no PR URL, exits 0 silently |
| User answers "n" at confirm prompt | Exit cleanly, no upload, no comment |
| Network or 5xx talking to vibeshub | Print error + retry hint to stderr, exit 0 |
| GH token missing/expired | Tell user to run `gh auth login`, exit 0 |
| Transcript file not found | One retry after 200ms, then fail loudly to stderr |
| Trace > 50MB | Reject server-side with explicit message; preview prints size before upload so user sees it coming |
| `gh pr comment` fails after successful upload | Print the trace URL to stderr so user can paste manually |
| `claude-code-log` raises during render | API returns `render_failed`; frontend renders raw JSONL fallback |
| Server-side rendering disagrees with cached version after `claude-code-log` upgrade | `renderer_version` mismatch invalidates cache automatically |

The general principle: the hook is best-effort. It must never block Claude's main flow.

## 11. Security & privacy

- Traces are public, by design, in v1. The plugin's confirm-before-upload prompt is the user's primary defense.
- Two redaction passes (client + server) cover known secret patterns. Neither is a guarantee — the README will say so.
- The Bearer token used for ingest is a personal GitHub token from `gh auth token`; we never persist it. We store only the resolved login.
- Blobs are stored on a Railway volume; access is gated by API endpoints only. There is no directory listing.
- Server-side redaction patterns are the same set as client-side, with a configurable extension list.

## 12. Testing

- **Plugin / shared client**:
  - Unit tests for redaction patterns against a fixture transcript with planted secrets.
  - Unit test for transcript path resolution given various session/cwd shapes.
  - Integration test runs the hook end-to-end against a fake server (FastAPI test client running in a thread).
- **Backend**:
  - pytest with a test Postgres (Railway dev DB or local docker-compose).
  - Mock GitHub API for token verification + PR lookup.
  - Snapshot test: ingest a fixture JSONL, assert resulting blob and DB rows.
  - Render endpoint test: assert HTML cached on second call.
- **Frontend**:
  - Playwright smoke test that loads a fixture trace via a stubbed API and verifies the iframe + chrome render.
- **Fixtures**:
  - `tests/fixtures/sample-session.jsonl` — a real, anonymized Claude Code session committed to the repo, used across all layers.

## 13. Open questions to resolve during implementation

- Exact `claude-code-log` invocation API: confirm whether to call it as a Python function or shell out to its CLI per render. Either is fine; pick whichever is less brittle when we get there.
- The PR title is denormalized into the `traces` row at ingest time (the GH PR-lookup call already happens for ownership verification, so we get the title for free). Open question: whether to also store the PR description, or fetch fresh on view. Lean toward title-only for now to avoid stale-content concerns.
- The `short_id` length and character set — start at 10 base32 chars, revisit if collisions become non-trivial.

## 14. Future work (not v1)

- GitHub OAuth login on the web app + access controls that mirror repo visibility.
- Additional triggers (`git push`, Stop hook, manual slash command extension).
- Additional platforms — `plugins/cursor/`, `plugins/codex/`, etc., reusing `plugins/shared/`.
- Multi-session aggregation per PR.
- R2/S3 blob storage swap-in.
- Search across a user's traces.
- Diff between conversation traces (e.g., compare two attempts at the same PR).
