# Private repository traces

**Status:** design approved, ready for implementation plan
**Branch:** `private-repo-traces`

## Goal

Let vibeshub host traces from private GitHub repositories, and gate viewing
those traces behind the viewer's own GitHub permissions. We store no access
control lists of our own: a viewer may see a private trace if and only if
GitHub says they can read the underlying repository. This mirrors GitHub's
permissions and keeps permission management on our side close to zero.

## Background

Today every trace is public:

- `app/api/ingest.py` explicitly rejects private repos with
  `403 "private repos are not supported in v1"`.
- `GET /api/traces/{short_id}` and `/raw` serve any trace to anyone, no auth.
- A GitHub OAuth login already exists (session cookie, `User` row stores the
  viewer's encrypted access token), but the requested scope is only
  `read:user user:email` — no private-repo access.
- `PublicGitHubClient` can call GitHub with a viewer's token, but its cache is
  keyed by `(path, params)` only — **not** token-aware.

## Key decisions

1. **OAuth App, optional `repo` scope.** We keep the existing OAuth App. GitHub
   classic OAuth Apps offer no read-only private-repo scope — `repo` is the
   only scope granting private read, and it inherently includes write. We
   request it only when a user opts in, disclose this plainly, and never call a
   write endpoint. We did not switch to a GitHub App: that would intersect
   rather than mirror GitHub's permissions (an uninstalled-but-visible repo
   would be denied) and is a substantially larger rebuild.

2. **Private support is opt-in.** Default login keeps the minimal scope
   unchanged. A user grants `repo` only through an explicit "Enable private
   repositories" action. Public-only visitors never see the broad consent
   screen.

3. **Privacy is per-repo, not per-trace.** Every trace for a given
   `repo_full_name` shares one visibility. The access check is therefore
   `GET /repos/{owner}/{repo}` with the viewer's token (200 = can read,
   404 = cannot). The PR number is not needed for the check.

4. **Full mirror for listings.** Private traces appear in PR lists, repo
   overviews, and user profiles — but only for viewers who pass the per-repo
   access check; hidden from everyone else. They never appear on the public
   homepage / global recent feed.

5. **Privacy is snapshotted at ingest.** `is_private` is derived once, from the
   repo's visibility at upload time. A repo that flips public→private later is
   not re-derived (see Known limitations).

## Architecture

### 1. Data model & ingest

- **New column `Trace.is_private`** — boolean, default `false`. An Alembic
  migration adds it and backfills existing rows to `false`.
- **`app/api/ingest.py`** — delete the `if pr.repo_is_private: raise
  HTTPException(403, ...)` block. Private uploads now succeed and set
  `is_private=True` from `GitHubPull.repo_is_private` (already fetched). The
  uploader's `gh auth token` already carries `repo` scope, so `get_pull`
  already works for private repos. The PR-author check is unchanged. The plugin
  posts the trace link as a PR comment exactly as today — on a private PR, only
  collaborators see the comment.

### 2. Access checking

- **New module `app/github/repo_access.py`** — a `RepoAccessChecker`. Given a
  viewer's decrypted token and a `repo_full_name`, it calls
  `GET /repos/{owner}/{repo}` and returns allow (200) / deny (404).
- It has its **own cache keyed by `(user_id, repo_full_name)`** with a short
  TTL (~60s). It must not reuse `PublicGitHubClient`, whose cache is keyed by
  `(path, params)` only — a private 200 payload cached there would leak across
  users.
- Wired into app state and exposed via a `get_repo_access` dependency in
  `app/deps.py`.

### 3. View gating

`get_trace`, `get_trace_raw`, and `get_agent_raw` gate private traces. Public
traces are unchanged. For a private trace the response depends on the viewer:

| Viewer state | Response | Detail code |
|---|---|---|
| Not logged in | `401` | `auth_required` |
| Logged in, token lacks `repo` | `403` | `private_scope_required` |
| Logged in, has `repo`, GitHub denies | `404` | `not_found` |
| Logged in, has `repo`, GitHub upstream error | `502` | `github_upstream_error` |
| Logged in, has `repo`, GitHub allows | `200` + trace | — |

Successful private responses set `Cache-Control: private, no-store`; the gated
error responses (401/403/404/502) set `Cache-Control: no-store`. Public
responses stay cacheable as today. Returning `404` (not `403`) for a genuine
denial avoids confirming the trace exists to someone GitHub says cannot see the
repo. The `502` path fails closed — a transient GitHub outage denies access
rather than serving the trace.

### 4. List filtering

`list_pr_traces`, `get_repo_overview`, and `get_user_overview` each: gather the
distinct private repos in the result set, run one access check per repo, and
drop traces whose repo the viewer cannot access.

- PR-list and repo-overview are single-repo — one check gates the page.
- User-overview spans repos — one check per distinct private repo.
- The homepage / global recent feed excludes private traces unconditionally,
  even for authorized viewers.

### 5. Auth scope-upgrade flow

- Default login is unchanged — minimal `read:user user:email`.
- `/api/auth/github/login` gains an optional `scope=private` query param. When
  present, the OAuth redirect additionally requests `repo` via Authlib's
  per-call `scope=` override on `authorize_redirect`; `build_oauth` is
  unchanged.
- The OAuth callback already writes GitHub's returned scope string into the
  existing `User.token_scopes` column. An escalated login overwrites the user's
  token and scopes with the `repo`-bearing ones. No new column.
- **`/api/auth/me`** gains `has_private_access: bool`, derived from whether
  `token_scopes` contains `repo`.
- The opt-in UI discloses: "GitHub will ask for read/write access to your
  private repos — vibeshub only ever reads."

### 6. Frontend

- `MeResponse` type and `AuthContext` carry `has_private_access`.
- `TraceView` maps the new statuses: `401` → a sign-in panel; `403
  private_scope_required` → an "Enable private repositories" panel linking to
  the scope-upgrade login with `next` set back to the trace; `404` → the
  existing not-found state.
- A small **lock badge** in `TraceHeader` / `ViewerTopbar` when `is_private` is
  true, so authorized viewers know the trace is gated.
- `AuthWidget` (or settings) shows an "Enable private repositories" action for
  logged-in users without `repo` scope, so they can opt in proactively rather
  than only when blocked.
- The `TraceSummary` API schema exposes `is_private` so the UI can render the
  badge.

## Testing

Test-driven. Backend:

- ingest accepts a private PR and sets `is_private=True`;
- `RepoAccessChecker` allow/deny and cache behavior (including no cross-user
  leakage);
- the four-way response matrix for each gated view endpoint;
- list filtering drops inaccessible private traces; homepage excludes private;
- scope-upgrade login requests `repo`, and `/api/auth/me` reflects
  `has_private_access`.

Frontend:

- `TraceView` renders each gated state (`401` / `403` / `404`);
- the auth widget shows the opt-in for users without `repo` scope.

## Known limitations (v1)

- **Public→private drift.** Privacy is snapshotted at ingest. A repo that flips
  public→private after a trace is uploaded keeps `is_private=false` and stays
  public. There is no background re-sync job. (A future mitigation: a cached,
  low-frequency re-check via the fallback token on the public-trace view path.)
- **No read-only private scope.** Imposed by GitHub's classic OAuth App scope
  model. The `repo` grant is read+write; we only ever read.
- **Revocation lag.** `RepoAccessChecker` caches an allow/deny decision per
  `(user_id, repo)` for ~60s, so a viewer whose GitHub repo access is revoked
  may still load a private trace for up to that window.
- **No global recent feed.** The backend has no homepage/recent-feed endpoint,
  so there is nothing to filter today. If one is ever added it must exclude
  `is_private` traces.
