# GitHub OAuth login + public GitHub stats on user/repo pages — Design

**Status**: draft, pending implementation
**Date**: 2026-05-18

## 1. Purpose

Two changes that share an HTTP slice:

1. **Sign in with GitHub.** Anonymous browsing is unchanged; logged-in viewers
   are recognized server-side and have their identity available to future
   features (uploads from a hosted profile, claiming traces, broader scopes).
2. **Replace vibeshub-derived stats on the user/repo overview pages with
   on-the-fly public GitHub stats.** Today those pages only reflect what's been
   ingested into vibeshub; that's incomplete signal for a viewer landing cold.

The two ship together because the GitHub API client built for the stats
endpoints is the same one we'll select tokens for based on the viewer's session
state, and the wider work plan benefits from doing both in one PR rather than
threading a half-built client through follow-ups.

## 2. Non-goals

- Trace uploads from logged-in users.
- Persistent storage of GitHub stats.
- Profile pages, claiming flows, profile editing.
- `repo` scope or private-repo data.
- Stats beyond the basic list below.
- Multi-process cache coherence (single Container App revision today;
  swapping in Redis is a documented follow-up).

## 3. Already-decided constraints (from the task brief)

These are inputs to the design, not open questions:

1. **Login is additive.** Anonymous browsing continues to work; logging in
   doesn't gate any page.
2. **GitHub OAuth, not email/password.**
3. **Minimal scopes: `read:user`, `user:email` only.** Public GitHub data
   needs no extra scope. We deliberately do **not** request `repo` or
   `public_repo`. Broader scopes get added in a follow-up when needed. A
   code comment near the scope list documents this.
4. **Stats are public-only, computed on the fly, with ETag + short TTL.**
   Cache is shared across viewers for the same `{login}` / `{owner}/{name}`
   key — public payloads are identical regardless of which token fetched them.
5. **Token selection per request**: viewer's OAuth token when logged in,
   server-side `GITHUB_FALLBACK_TOKEN` when anonymous. Confirmed: logged-in
   viewers use *their own* token even when viewing someone else's profile —
   the cache key stays viewer-independent, only the rate-limit bucket changes.
6. **OAuth access token is persisted, not discarded** — encrypted at rest with
   a scheme sound enough to survive future scope expansion.

## 4. Decisions made in this brainstorm

| Topic | Decision |
|---|---|
| OAuth library | **Authlib** (Starlette integration). One provider, one flow; library bundles state, redirect, token exchange. |
| Session storage | **Server-side `user_sessions` table**, opaque id in cookie. Revocable, survives secret rotation. |
| Token at rest | **Fernet** (cryptography lib), key in `VIBESHUB_TOKEN_ENCRYPTION_KEY`. `MultiFernet` for rotation. |
| Cookie attrs | **HttpOnly + SameSite=Lax + Secure-in-prod** via `cookie_secure: bool` setting. |
| Cache | **In-process dict, ~60s TTL, ETag revalidation, per-key `asyncio.Lock` single-flight**, LRU cap 512 entries. |
| Session lifetime | **30 days sliding**, `last_seen_at` written at most every 5 minutes. |
| `/api/auth/me` for anon | **`204 No Content`** (not 401). |
| `next` redirect param | Same-origin path-only validation (`scheme==""`, `netloc==""`, `path.startswith("/")`, not `//`). |
| Logout method | **`POST` only**. Lax cookie + POST-only blocks cross-site CSRF. |

## 5. Architecture

```
                          ┌──────────────────────────────────┐
 Browser  ─── cookie ───▶ │ FastAPI app                       │
                          │  ┌─────────────────────────────┐  │
                          │  │ auth router (Authlib)        │  │
                          │  │  /api/auth/github/login      │  │
                          │  │  /api/auth/github/callback   │  │
                          │  │  /api/auth/logout            │  │
                          │  │  /api/auth/me                │  │
                          │  └─────────┬───────────────────┘  │
                          │            │ upsert user, create  │
                          │            ▼ session row          │
                          │     users  ⟷  user_sessions       │
                          │            ▲                       │
                          │            │ decrypted token       │
                          │  ┌─────────┴───────────────────┐  │
                          │  │ github stats router          │  │
                          │  │  /api/github/users/{login}   │  │
                          │  │  /api/github/users/{login}/  │  │
                          │  │    repos                     │  │
                          │  │  /api/github/repos/{o}/{n}   │  │
                          │  └─────────┬───────────────────┘  │
                          │            │ token select +        │
                          │            │ cache (etag,ttl)      │
                          │            ▼                       │
                          │     PublicGitHubClient ──► api.github.com
                          └──────────────────────────────────┘
```

### New modules

| Path | Purpose |
|---|---|
| `app/auth/oauth.py` | Authlib OAuth client setup + login/callback handlers. |
| `app/auth/sessions.py` | Issue/lookup/revoke server-side sessions; FastAPI dependency `get_current_user`. |
| `app/auth/crypto.py` | Tiny Fernet wrapper around `VIBESHUB_TOKEN_ENCRYPTION_KEY`. |
| `app/api/auth.py` | `/api/auth/*` routes (login redirect, callback, logout, me). |
| `app/api/github_stats.py` | `/api/github/...` routes. |
| `app/github/public_client.py` | `PublicGitHubClient` (token-per-request, ETag+TTL cache, single-flight). |
| `app/storage/models.py` | Add `User`, `UserSession`. |
| `alembic/versions/<rev>_users_and_sessions.py` | New migration. |

The existing `GitHubClient.verify_token` in `app/auth/github.py` stays untouched
— upload-flow authentication is unaffected. The new `PublicGitHubClient` is a
separate class so test surfaces don't collide and so each class has one
contract.

## 6. Data model

Two new tables. Existing `traces` is untouched.

```python
class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    github_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    github_login: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    encrypted_access_token: Mapped[str] = mapped_column(Text)
    # Comma-separated scopes the token was issued with. Lets a future
    # "needs re-auth for repo scope" check work cleanly. Not sensitive.
    token_scopes: Mapped[str] = mapped_column(String(255), default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class UserSession(Base):
    __tablename__ = "user_sessions"

    # Opaque session id the cookie holds. 32 bytes of urlsafe randomness => 43 chars.
    # String(64) leaves room for a future `v1.<id>` prefix without another migration.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
```

Notes:

- **`github_id` is the identity.** `github_login` can be renamed on GitHub;
  upserts key on `github_id` and `github_login` is refreshed on each login.
- **Token is always encrypted.** Even v1's public-only reads store ciphertext.
- **`token_scopes` is unencrypted** — not sensitive; useful for future
  "needs re-auth" prompts.
- **`email` is nullable** — a user with `user:email` scope can still have
  only-private emails; we don't fail login over that.
- **Session id storage**: 32 random bytes, urlsafe-base64-encoded.
- **Session lifetime**: 30 days, sliding. `last_seen_at` written at most every
  5 minutes per session to avoid a write on every authed request.

**Migration**: one Alembic revision, additive only — creates the two tables
and their indexes. Down-revision is the current head `c4a0e8d51f47`. No data
backfill.

## 7. OAuth flow

### 7.1. Authlib setup

```python
# app/auth/oauth.py
oauth = OAuth()
oauth.register(
    name="github",
    client_id=settings.github_oauth_client_id,
    client_secret=settings.github_oauth_client_secret,
    access_token_url="https://github.com/login/oauth/access_token",
    authorize_url="https://github.com/login/oauth/authorize",
    api_base_url="https://api.github.com/",
    # Public-read-only scopes. Do NOT add `repo` (private repos) or
    # `public_repo` (write to public repos) here — broader scopes will be
    # added in a follow-up PR when private-repo fidelity is needed.
    client_kwargs={"scope": "read:user user:email"},
)
```

### 7.2. SessionMiddleware (for OAuth state only)

Authlib needs a Starlette session to hold the OAuth `state` between the
authorize redirect and the callback. We mount `SessionMiddleware` with a
**separate cookie name** (`oauth_state`) so it can't be confused with our
app session cookie:

```python
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.session_secret,
    session_cookie="oauth_state",
    same_site="lax",
    https_only=settings.cookie_secure,
    max_age=600,
)
```

### 7.3. Routes

| Method & Path | Behavior |
|---|---|
| `GET /api/auth/github/login?next=<path>` | `next` validated as same-origin path. Stored in Starlette session. Calls `oauth.github.authorize_redirect(request, redirect_uri)` → 302 to GitHub. |
| `GET /api/auth/github/callback?code=…&state=…` | Authlib validates `state`; mismatch → 303 to `/?auth_error=state_mismatch`. Token exchange failure → `/?auth_error=github_error`. User-denied (`?error=access_denied`) → `/?auth_error=denied`. Success: fetch `/user` and `/user/emails`, upsert `User` (encrypt token + persist scopes), create `UserSession`, set the cookie, 303 to validated `next` or `/`. |
| `POST /api/auth/logout` | Read session id from cookie; delete `UserSession`; clear cookie. Always 204 (idempotent). Locks the method — GET returns 405. |
| `GET /api/auth/me` | Authed → 200 `{id, login, name, avatar_url}`. Anonymous → 204. Expired session → 204 + `Set-Cookie: Max-Age=0`. |

`redirect_uri` = `settings.public_base_url + "/api/auth/github/callback"`,
which must be registered in the GitHub OAuth app settings.

### 7.4. Session cookie

```
Set-Cookie: vibeshub_session=<id>;
            Path=/; HttpOnly; SameSite=Lax;
            Secure        (only when settings.cookie_secure=True)
            Max-Age=2592000
```

### 7.5. `get_current_user` dependency

1. Read cookie → look up `UserSession` by id.
2. If missing or expired → return `None`.
3. If `last_seen_at` older than 5 minutes → update `last_seen_at` and bump
   `expires_at` to `now + 30d`.
4. Return the joined `User`.

A second dependency `require_current_user` wraps it and 401s if `None`. Not
used by any endpoint in this PR; defined so future endpoints can adopt it.

### 7.6. New settings

```python
github_oauth_client_id: str = Field(default="")
github_oauth_client_secret: str = Field(default="")
github_fallback_token: str = Field(default="")
session_secret: str = Field(default="")          # >= 32 chars
token_encryption_key: str = Field(default="")    # Fernet key, 44 chars; or "new,old" for rotation
cookie_secure: bool = Field(default=True)        # set False for local dev
```

Backend boots without these so contributors who haven't set up OAuth can still
work on other endpoints. If `github_oauth_client_id` is empty, the auth routes
return `503 oauth_not_configured`. If `github_fallback_token` is empty and the
viewer is anonymous, stats routes return `503 github_not_configured`.

## 8. Public GitHub client

### 8.1. Class shape

```python
class PublicGitHubClient:
    def __init__(self, api_base: str, fallback_token: str, ttl_seconds: int = 60):
        self._api_base = api_base.rstrip("/")
        self._fallback_token = fallback_token
        self._ttl = ttl_seconds
        # key = (path, frozenset(sorted query params))
        # val = CacheEntry(etag, payload, expires_at)
        self._cache: OrderedDict[CacheKey, CacheEntry] = OrderedDict()
        self._locks: dict[CacheKey, asyncio.Lock] = {}

    async def get_json(self, path: str, *, viewer_token: str | None,
                       params: dict | None = None) -> Any: ...
```

### 8.2. Behavior of `get_json`

1. **Token selection**: `viewer_token or self._fallback_token`. Both empty →
   raise `GitHubAuthError`. Public payloads are identical regardless of which
   token is used.
2. **Cache key excludes the token** by design. Public data is shared across
   viewers; caching per-viewer would explode the cache and add nothing.
3. **Hit within TTL** → return cached payload immediately.
4. **Stale / miss** → acquire per-key `asyncio.Lock`. Recheck after acquiring
   (another task may have refreshed). Issue `GET` with:
   - `Accept: application/vnd.github+json`
   - `X-GitHub-Api-Version: 2022-11-28`
   - `Authorization: Bearer <selected_token>`
   - `If-None-Match: <cached_etag>` if we have one
5. **Response handling**:
   - `304` → bump `expires_at = now + TTL`, return cached payload.
   - `200` → store `{etag, payload, expires_at}`. Return payload.
   - `401` → raise `GitHubAuthError` (not cached). Surfaced as `502
     github_upstream_error` from stats endpoints; logged so we can spot a
     misconfigured fallback PAT or a viewer's revoked token.
   - `404` → raise `GitHubNotFound` (not cached).
   - `403` with `X-RateLimit-Remaining: 0` → raise `GitHubRateLimited` carrying
     `reset_at` (not cached). A 403 *without* that header (e.g. abuse
     detection) maps to `GitHubUpstreamError`.
   - `5xx` or network error → raise `GitHubUpstreamError` (not cached).
6. **LRU cap**: 512 entries. `OrderedDict.move_to_end` on access; oldest
   evicted on insert past cap.

Cache lifetime is process-scoped (held on `app.state.public_github`). Wiped on
restart. Multi-process Redis swap-in is a documented follow-up.

### 8.3. Single-flight invariant

Per-key `asyncio.Lock` taken **before** the upstream call. Ten concurrent
viewers of the same hot user trigger exactly one upstream call. The lock dict
is not aggressively GC'd — bounded by cache cap.

## 9. Stats endpoints

All endpoints resolve the viewer via `get_current_user`, pick the token
accordingly, and project responses to a tight shape (we do not pass GitHub's
raw response through).

### 9.1. `GET /api/github/users/{login}`

Up to **3** upstream calls:

1. `GET /users/{login}` → profile fields.
2. If `public_repos > 0`: walk `GET /users/{login}/repos?per_page=100&sort=pushed`
   up to **3 pages (300 repos max)**. Sum `stargazers_count`, tally `language`
   frequencies and return the top 3.

Hard cap rationale: keeps worst-case latency under ~1.5s and bounds quota cost.
For users with >300 repos, the sum is over the 300 most-recently-pushed and
`stars_truncated` is set to `true`. The brief's "defer cross-repo aggregations
beyond ~30 items" guidance permits this.

Response:

```json
{
  "login": "octocat",
  "name": "The Octocat",
  "bio": "GitHub mascot",
  "avatar_url": "...",
  "html_url": "https://github.com/octocat",
  "followers": 1234,
  "following": 9,
  "public_repos": 42,
  "total_public_stars": 18234,
  "top_languages": ["TypeScript", "Python", "Go"],
  "created_at": "2008-01-14T04:33:35Z",
  "stars_truncated": false
}
```

### 9.2. `GET /api/github/users/{login}/repos?page=N`

Passthrough to `/users/{login}/repos?sort=pushed&per_page=30&page=N`, projected
to:

```json
{
  "repos": [
    {
      "name": "...",
      "description": "...",
      "html_url": "...",
      "stargazers_count": 0,
      "forks_count": 0,
      "language": "Go",
      "pushed_at": "..."
    }
  ],
  "has_next": true
}
```

`has_next` derived from the `Link: <…>; rel="next"` header.

### 9.3. `GET /api/github/repos/{owner}/{name}`

Single call to `GET /repos/{owner}/{name}`. Response:

```json
{
  "full_name": "octocat/Hello-World",
  "description": "...",
  "html_url": "...",
  "default_branch": "main",
  "stargazers_count": 80,
  "forks_count": 9,
  "watchers_count": 80,
  "open_issues_count": 3,
  "primary_language": "Ruby",
  "license_spdx": "MIT",
  "topics": ["ruby", "example"],
  "created_at": "...",
  "updated_at": "..."
}
```

## 10. Frontend changes

### 10.1. API client (`webapp/frontend/src/api.ts`)

```ts
export type GithubUser = { ... };
export type GithubRepo = { ... };
export type GithubRepoListPage = { repos: GithubRepo[]; has_next: boolean };
export type MeResponse = { id: string; login: string; name: string|null; avatar_url: string|null };

export async function fetchGithubUser(login: string): Promise<GithubUser>;
export async function fetchGithubUserRepos(login: string, page?: number): Promise<GithubRepoListPage>;
export async function fetchGithubRepo(owner: string, name: string): Promise<GithubRepo>;
export async function fetchMe(): Promise<MeResponse | null>;
export async function logout(): Promise<void>;
```

`fetchMe()` returns `null` when the backend responds with 204 (anonymous).
`logout()` POSTs to `/api/auth/logout` and resolves on 204.

### 10.2. `AuthContext`

A small React context populated once in `App.tsx` via `fetchMe()` on mount.
Exposes `{user, refresh, signOut}`. No suspense, no external library — a
`useEffect` + `useState`.

### 10.3. Header

New `SiteHeader.tsx` (or extension of `PageTopbar.tsx`) consumed by both
overview pages:

- **Anonymous**: button "Sign in with GitHub" → navigates to
  `/api/auth/github/login?next=<current path>`.
- **Authenticated**: avatar + `@login ▾` dropdown with a "Sign out" item that
  calls `logout()` and reloads the page.

### 10.4. `UserPage.tsx` / `RepoPage.tsx`

- Keep the existing `fetchUserOverview` / `fetchRepoOverview` calls (vibeshub
  data — traces, contributors, PR groupings). That remains the source of truth
  for traces.
- Add a parallel fetch — `fetchGithubUser(login)` / `fetchGithubRepo(owner,
  repo)` — and render its result into the `stat-strip`.
- The current "Traces / Messages / Size / Last upload" cells are **replaced**
  by GitHub stats. The traces count moves into the existing tab label (where
  it already shows) and into a small subtitle on the page header — we don't
  drop the vibeshub-specific signal entirely.
- If the GitHub fetch fails or 404s, the stat strip shows a "GitHub stats
  unavailable" placeholder; the rest of the page (traces, PRs, contributors)
  is unaffected.

## 11. Error handling

### 11.1. Mapping

| Upstream | Backend response | Frontend behavior |
|---|---|---|
| GitHub 404 user/repo | `404 user_not_found` / `repo_not_found` | Stat strip: "Not found on GitHub". Traces/PRs still render. |
| GitHub 403 rate-limited | `503 github_rate_limited`, header `Retry-After: <seconds>` | Stat strip: "GitHub stats temporarily unavailable". |
| GitHub 5xx / network | `502 github_upstream_error` | Same fallback. |
| OAuth state mismatch | 303 to `/?auth_error=state_mismatch` | Toast: "Sign-in expired, please try again." |
| OAuth user denied | 303 to `/?auth_error=denied` | Toast: "Sign-in cancelled." |
| OAuth token exchange fails | 303 to `/?auth_error=github_error` | Toast: "Couldn't sign in, try again." |
| `/api/auth/me` with bad cookie | clear cookie, return 204 | Treated as anonymous. |

### 11.2. Observability

- `PublicGitHubClient.get_json` logs entry with `(path, cache_state ∈ {hit,
  stale, miss})` and exit with `(status, source ∈ {cache, network})`. `INFO`,
  structured.
- Auth events: `auth.login.start`, `auth.login.success` (with `github_id`,
  `login`), `auth.login.failure` (with `reason`), `auth.logout`. `INFO`.
- Nothing sensitive logged: tokens, cookies, raw error bodies stay out of
  structured fields.

### 11.3. Edge cases

1. **GitHub login rename**: upsert by `github_id`; refresh `github_login` on
   each login.
2. **Self-viewing**: no special path; same endpoints, same payloads.
3. **Private-only email**: `email` null on `User` row; login succeeds.
4. **Token revoked on GitHub after login**: local session still works; stored
   token starts returning 401 from GitHub, surfaced as `502 github_upstream_error`.
   We do **not** auto-log-them-out for this PR — one transient 401 is not
   reliable revocation signal. Tracked as a follow-up.
5. **Fallback PAT unset + anonymous viewer**: stats endpoints return
   `503 github_not_configured`. Trace listings unaffected.
6. **`session_secret` / `token_encryption_key` unset at boot**: backend boots,
   auth routes return `503 oauth_not_configured`. Tests use fixed keys via
   fixture env.
7. **Multi-process deploy**: out of scope today. Cache is per-process; sessions
   are DB-backed so multi-process-safe.

### 11.4. Security checks

- `next` redirect param parsed with `urlparse`; accept only paths where
  `scheme == ""`, `netloc == ""`, `path.startswith("/")`, not `//`. Anything
  else falls back to `/`.
- Logout is `POST` only; Lax cookie blocks cross-site POSTs.
- Fernet key loaded once at boot, never logged. `MultiFernet([new, old])`
  supported via comma-separated env var; v1 doesn't ship the rotation tooling
  but the design accommodates it without a schema change.

## 12. Settings & env vars

Added to `app/settings.py` with `VIBESHUB_` prefix:

| Setting | Required | Example |
|---|---|---|
| `github_oauth_client_id` | for auth | `Iv1.abc…` |
| `github_oauth_client_secret` | for auth | (GitHub-issued secret) |
| `github_fallback_token` | for anon stats | `ghp_…` PAT, no special scopes |
| `session_secret` | for auth | ≥ 32 chars random |
| `token_encryption_key` | for auth | Fernet 44-char key, or `new,old` for rotation |
| `cookie_secure` | optional, default true | `false` in local dev |

The existing `deploy/azure/.env.example` is updated with each new var
(this file is the only `.env.example` in the repo), including a note on
registering `<public_base_url>/api/auth/github/callback` as the authorized
callback in the GitHub OAuth app settings, and a note that `cookie_secure`
must remain `true` for the Azure deploy.

## 13. Tests

### Backend (`webapp/backend/tests/`)

**`test_auth_oauth.py`**:
- `test_login_redirects_to_github` — 302 to authorize URL with correct client_id
  and scope.
- `test_callback_success` — respx mocks token exchange + `/user` + `/user/emails`;
  asserts User row, encrypted_access_token round-trip via `crypto.decrypt`,
  UserSession row, 303 to next, cookie attrs.
- `test_callback_state_mismatch` — forged state → `/?auth_error=state_mismatch`,
  no rows written.
- `test_callback_github_error` — token exchange 500 → `/?auth_error=github_error`.
- `test_callback_user_denied` — `?error=access_denied` → `/?auth_error=denied`.
- `test_login_rejects_open_redirect_next` — `?next=https://evil` and `?next=//evil`
  fall back to `/`.
- `test_repeat_login_upserts` — same `github_id`, renamed login → updates,
  no duplicate row.

**`test_auth_me.py`**:
- `test_me_anonymous_returns_204`.
- `test_me_authenticated_returns_user_fields`.
- `test_me_expired_session_returns_204_and_clears_cookie`.

**`test_auth_logout.py`**:
- `test_logout_deletes_session_and_clears_cookie`.
- `test_logout_anonymous_is_idempotent_204`.
- `test_logout_get_returns_405`.

**`test_crypto.py`**:
- Round-trip.
- Tampered ciphertext raises `InvalidToken`.
- `MultiFernet` rotation: comma-separated keys decrypt old ciphertext; new
  writes use the new key.

**`test_public_github_client.py`**:
- `test_uses_viewer_token_when_present`.
- `test_falls_back_to_pat_when_viewer_token_none`.
- `test_raises_when_no_tokens_configured`.
- `test_cache_hit_within_ttl_skips_network`.
- `test_stale_revalidates_with_etag` — `If-None-Match` sent, `304` returned,
  payload from cache, expires_at refreshed.
- `test_etag_200_replaces_payload`.
- `test_single_flight_under_concurrency` — 10 concurrent calls → 1 upstream
  call.
- `test_404_raises_not_found_and_is_not_cached`.
- `test_403_rate_limited_raises_typed_error_with_reset_at`.
- `test_5xx_raises_upstream_error_and_is_not_cached`.
- `test_lru_eviction_at_cap`.

**`test_github_stats_endpoints.py`**:
- `test_user_endpoint_happy_path` — sum-of-stars and top-3 languages correct.
- `test_user_endpoint_truncates_at_300_repos` — walk stops at 3 pages,
  `stars_truncated=true`.
- `test_user_endpoint_404_maps_to_404`.
- `test_user_endpoint_uses_viewer_token_when_logged_in` — outgoing
  Authorization header carries decrypted user token.
- `test_user_endpoint_uses_fallback_pat_when_anon`.
- `test_user_repos_paginates`.
- `test_repo_endpoint_happy_path`.
- `test_repo_endpoint_404`.
- `test_rate_limited_returns_503_with_retry_after_header`.

### Frontend (`webapp/frontend/`)

Vitest (`src/tests/api.test.ts`):
- `fetchMe()` returns `null` on 204.
- `logout()` POSTs and resolves on 204.
- `fetchGithubUser` / `fetchGithubRepo` parse typed responses.

Component test for `SiteHeader`:
- Anonymous → "Sign in with GitHub" anchor with correct `next` param.
- Authenticated → avatar + login + Sign out; clicking calls `logout()` then
  reloads.

Playwright (`e2e/auth.spec.ts`) — one smoke test:
- Page-route `/api/auth/me` to return mocked user → header shows `@login`.
- Page-route `/api/auth/me` to 204 → header shows "Sign in with GitHub".
- Click Sign out → POST 204 → header reverts.

### Test infrastructure

- `tests/conftest.py` gains an `auth_env` autouse fixture setting
  `VIBESHUB_GITHUB_OAUTH_CLIENT_ID`, `_CLIENT_SECRET`, `_SESSION_SECRET`,
  `_TOKEN_ENCRYPTION_KEY` (fixed test Fernet key), `_GITHUB_FALLBACK_TOKEN`,
  `_COOKIE_SECURE=false`.
- A helper `make_authed_client(user)` creates a `User` + `UserSession` and
  returns an `httpx.AsyncClient` with the cookie pre-set.

## 14. Verification checklist (before claiming done)

- All new backend tests pass; existing tests still pass.
- Frontend `npm run build` succeeds; vitest + Playwright pass.
- Anonymous browsing of `/`, `/{owner}`, `/{owner}/{repo}`, and existing
  trace viewer pages is unchanged.
- Sign-in → callback → cookie → `/api/auth/me` round trip works in dev (with
  a real GitHub OAuth app).
- Sign-out clears the cookie and the `UserSession` row.
- User and repo overview pages show real GitHub stats for both anonymous and
  logged-in viewers.
- `.env.example` documents every new env var.
