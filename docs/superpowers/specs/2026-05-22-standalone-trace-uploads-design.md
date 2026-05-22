# Standalone Trace Uploads — Design

**Date:** 2026-05-22
**Status:** Approved

## Problem

Today every trace on vibeshub is bound to a GitHub PR. A trace cannot exist
without a `repo_full_name`, `pr_number`, and `pr_url` — the schema, the ingest
endpoint, the routing, and the privacy model all assume *trace = PR*.

We want users to be able to upload a trace that is **not** tied to a PR or a
repo, with two driving use cases:

1. **Web upload (profile / "show off").** A signed-in user uploads a trace from
   their profile page to boost their public profile. They upload the main
   `chat.jsonl` and an optional zip of subagent transcripts. They may
   *optionally* attach a repo and/or PR (selected via their GitHub token), and
   may keep the trace private (a simple binary flag — no fine-grained ACL).

2. **CLI upload (`/share-trace`).** From inside a Claude Code session the user
   runs `/share-trace`. It auto-detects the PR for the current branch if one
   exists, otherwise the repo, otherwise uploads the trace standalone. When a
   PR or repo is present, privacy mirrors GitHub; otherwise the trace is public
   and viewable on the user's profile (toggleable to private in the UI).

`/share-pr` becomes redundant and is replaced outright by `/share-trace`.

## Decisions

These were settled during brainstorming:

- **shortId is the trace identity.** The canonical URL is `/t/<shortId>`. The
  existing `/<owner>/<repo>/pull/<n>/<shortId>` path keeps resolving as a
  decorative alias (shortId is globally unique). Editing a trace's repo/PR
  association therefore never breaks a link.
- **Author/collaborator only** may link a repo or PR: the uploader must be the
  PR author to attach a PR, or a repo collaborator (GitHub permission ≠
  `none`) to attach a repo.
- **Hard replace** `/share-pr` with `/share-trace` — no alias, no transition
  period.
- **Separate ingest endpoints** (Approach B): the CLI keeps `/api/ingest`
  (tar + bearer token); the web gets a new `/api/uploads` (multipart + session
  cookie). They converge on a shared internal trace-creation service.
- **Dedicated `/upload` page**, not a modal — the form is multi-step (file
  pickers + repo picker + PR picker).
- **Web uploads do not post a PR comment**, even when a PR is linked. The CLI
  keeps posting (matches today's auto `gh pr create` hook behavior).

## Architecture

### 1. Data model (`app/storage/models.py`)

Make three `Trace` columns nullable:

- `repo_full_name: Mapped[str]` → `Mapped[Optional[str]]`
- `pr_number: Mapped[int]` → `Mapped[Optional[int]]`
- `pr_url: Mapped[str]` → `Mapped[Optional[str]]`

`owner_login` stays non-null — it is always the uploader. `pr_title` is already
nullable. `is_private` stays and carries the privacy state for both the
standalone and repo-associated cases (see §3).

No new columns. One Alembic migration alters the three columns to nullable.
Existing rows already populate all three, so they are untouched. The
`repo_full_name` and `pr_number` indexes remain (nullable indexed columns are
fine).

YAGNI: no separate `user_visibility` column, no `upload_source` column.

### 2. Routing & URLs

- New canonical route `/t/:shortId` → `TraceView`. The viewer loads by shortId
  through the existing `GET /api/traces/{short_id}`.
- The existing `/:owner/:repo/pull/:number/:shortId` route keeps resolving;
  its path parameters become decorative.
- `IngestResponse.trace_url` (and the equivalent web response) returns the
  `/t/<sid>` form. The auto `gh pr create` hook's PR comment will use this URL.
- New `/upload` route — an auth-gated standalone upload page.

### 3. Privacy & access control (`app/api/traces.py`)

`is_private` semantics split by whether the trace is associated with a repo:

- **Standalone** (`repo_full_name IS NULL`): `is_private` is a user-controlled
  boolean. A private standalone trace is **owner-only**:
  - anonymous viewer → `401 auth_required`
  - signed-in non-owner → `404 not_found`
  - owner → allowed
- **Repo-associated**: `is_private` is synced from the repo's GitHub visibility
  at ingest and on every association edit. A private repo-associated trace
  keeps today's behavior — the live repo-read-access check via
  `RepoAccessChecker`. The UI privacy toggle is **disabled** for these traces
  (privacy mirrors GitHub).

`_require_trace_access` gains a branch: public → pass; private + standalone →
owner-only check; private + repo-associated → existing repo-access check.
`_filter_visible` / `_can_view_repo` similarly handle standalone-private rows
(visible only to their owner).

Every gated error response keeps `Cache-Control: no-store`.

### 4. Shared trace-creation service

Extract a `create_or_update_trace(...)` function (likely in a new
`app/api/_trace_service.py` or `app/storage/`) used by both ingest paths. It
takes: the unpacked+redacted bundle (main bytes + agent list), `owner_login`,
optional PR/repo metadata, `is_private`, `session_id`, `platform`,
`plugin_version`, redaction counts. It writes blobs under `traces/<sid>/`,
performs the existing session-id upsert, and returns the row + `created` flag.
Both `/api/ingest` and `/api/uploads` call it.

### 5. `/api/ingest` (CLI path — modified)

`X-Vibeshub-Pr-Url` becomes **optional**. New optional `X-Vibeshub-Repo` header
(`owner/name`).

- **PR present** → verify token, fetch the PR, **enforce uploader == PR
  author** (`403` otherwise), snapshot the repo's `is_private` from PR repo
  visibility. Unchanged from today.
- **Repo only** → verify the uploader is a collaborator on the repo via the
  GitHub permission endpoint (`/repos/{owner}/{repo}/collaborators/{user}/
  permission`, permission ≠ `none`); `403` otherwise. Snapshot `is_private`
  from repo visibility.
- **Neither** → standalone trace, `is_private = False`, `owner_login` = the
  token user.

### 6. `/api/uploads` (web path — new)

- **Auth:** session cookie via `get_current_user`; `403` if anonymous.
- **Body:** `multipart/form-data`:
  - `transcript` — the main `.jsonl` file (required)
  - `subagents` — a `.zip` of subagent `.jsonl` files (optional)
  - `is_private` — boolean form field (default `false`)
  - `pr_url` — optional
  - `repo_full_name` — optional
- **Processing:** unzip the subagents, run the subagent-linking logic (the same
  matching `vibeshub_client/subagent_link.py` does, adapted to in-memory
  files), redact server-side, build the internal unpacked form, and call
  `create_or_update_trace`.
- **Linking:** if `pr_url` / `repo_full_name` is given, run the same
  author/collaborator check as §5 using the signed-in user's stored (decrypted)
  GitHub token, and snapshot `is_private` from repo visibility.
- **No PR comment** is posted.
- Size limits reuse `settings.max_trace_bytes`.
- Errors: `401` anon, `422` missing transcript, `413` too big, `400` malformed
  jsonl/zip, `403` not author/collaborator on a linked repo/PR.

### 7. `PATCH /api/traces/:shortId` (new)

- **Auth:** session cookie, **owner-only** (`owner_login` == signed-in user;
  `403` otherwise, `404` if the trace is missing).
- **Body:** JSON, all fields optional:
  - `is_private` — honored **only** when the trace is standalone; ignored /
    rejected when a repo is associated (privacy mirrors GitHub there).
  - `pr_url` — set (string) or clear (`null`).
  - `repo_full_name` — set (string) or clear (`null`).
- Setting/changing a PR or repo re-runs the author/collaborator check (§5) via
  the user's stored token and re-syncs `is_private` from repo visibility.
- Clearing all association reverts the trace to standalone; `is_private` keeps
  its current value and the owner may then toggle it.

### 8. GitHub picker endpoints (`/api/github`, cookie auth, stored token)

Two new endpoints proxying GitHub with the signed-in user's decrypted token:

- `GET /api/github/my-repos?q=` — repos the user owns or collaborates on,
  filtered by an optional query.
- `GET /api/github/repo-prs?repo=owner/name&q=` — PRs the user authored in the
  given repo.

Both reuse the error handling in `app/api/github_stats.py` (rate limit, 404,
upstream error).

### 9. Frontend

- **`/upload` page** (auth-gated): file pickers for the transcript `.jsonl`
  (required) and the subagents `.zip` (optional), a privacy toggle defaulting
  to **public**, an optional searchable repo picker that, once a repo is
  chosen, enables an optional PR picker. Submit → `POST /api/uploads` → redirect
  to `/t/<id>`. A short hint explains where to find the transcript files
  (`~/.claude/projects/...`).
- **`UserPage`**: an "Upload a trace" button on the *viewer's own* profile.
- **`/t/:shortId` route** → `TraceView` (reused). When the viewer is the trace
  owner, show an Edit affordance: a privacy toggle (standalone only) and a
  repo/PR picker → `PATCH /api/traces/:shortId`.
- **`TraceHeader`** and the trace summaries handle null repo/PR — a standalone
  trace shows no PR breadcrumb.
- **`PrivateTraceGate`** handles the standalone-private (owner-only) case:
  anonymous → prompt sign-in; signed-in non-owner → not-found.

### 10. CLI `/share-trace`

- Rename `plugins/claude-code/commands/share-pr.{md,py}` →
  `share-trace.{md,py}`; delete the old command.
- **Resolution order:**
  1. Open PR authored by the user on the current branch → upload with the PR
     (author check; posts a PR comment, as today).
  2. No PR but inside a git repo with a GitHub remote → upload with the repo
     (collaborator check).
  3. Neither → standalone upload (public). The command prints the `/t/<id>`
     URL and a note that privacy can be toggled in the UI.
- `delete` subcommand: keep it; accept a PR URL, a `/t/<id>` URL, or a bare
  short id.
- `vibeshub_client/pipeline.py`: `RunOptions.pr_url` becomes optional; add
  `repo_full_name`. The PR-comment step runs only when a PR is present.
- `vibeshub_client/upload.py`: `X-Vibeshub-Pr-Url` header optional; add the
  `X-Vibeshub-Repo` header.

The auto `gh pr create` hook is unchanged — it stays PR-based.

## Testing

- **Backend:** the model migration; `/api/ingest` with PR / with repo / with
  neither; `/api/uploads` happy path with and without the subagents zip;
  author/collaborator rejection; `PATCH` add / change / clear association and
  privacy toggle; the full access matrix (public; standalone-private as owner /
  non-owner / anonymous; repo-private). Reuse the patterns in
  `webapp/backend/tests/`.
- **Frontend:** the `/upload` page, repo/PR pickers, the Edit UI on
  `TraceView`, standalone-trace rendering (no PR breadcrumb), and
  `PrivateTraceGate` for the standalone-private case.
- **CLI:** `/share-trace` resolution for the PR / repo / neither paths, and the
  `delete` subcommand against all three id forms.

## Rollout

Existing traces all carry repo + PR data and are unaffected by the migration.
`/share-pr` is removed. The implementation plan is staged:

1. Model + migration + access-control rework + shared service.
2. Endpoints — `/api/ingest` (optional PR/repo), `/api/uploads`,
   `PATCH /api/traces/:shortId`, GitHub picker endpoints.
3. Frontend — `/upload` page, pickers, Edit UI, standalone rendering, routing.
4. CLI — `/share-trace` rename and the resolution logic.
