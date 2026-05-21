# Private Repository Traces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let vibeshub host traces from private GitHub repos and gate viewing them behind the viewer's own GitHub permissions, storing no access-control lists of our own.

**Architecture:** A `Trace.is_private` flag is snapshotted at ingest from the PR's repo visibility. A new `RepoAccessChecker` asks GitHub `GET /repos/{owner}/{repo}` with the viewer's stored OAuth token (cached per `(user_id, repo)`); 200 = allow, 404 = deny. Single-trace endpoints gate with a 401/403/404 matrix; list endpoints filter inaccessible private traces. Private access is opt-in via a `?scope=private` OAuth login that requests the `repo` scope.

**Tech Stack:** FastAPI + SQLAlchemy (async) + Alembic, httpx, Authlib; React + Vite + Vitest frontend. Backend tests use pytest + respx; the in-memory SQLite test DB is bootstrapped via `create_all` from the models, so model changes take effect in tests without running migrations.

---

## File structure

**Backend (`webapp/backend/`)**
- `app/storage/models.py` — add `Trace.is_private` column.
- `alembic/versions/7f3c1a9b2d4e_add_is_private_to_traces.py` — new migration (create).
- `app/api/ingest.py` — drop the private-repo 403; set `is_private`.
- `app/github/repo_access.py` — new `RepoAccessChecker` (create).
- `app/deps.py` — construct `RepoAccessChecker`, add `get_repo_access`.
- `app/api/schemas.py` — add `is_private` to `TraceSummary`.
- `app/api/traces.py` — access helpers, gate single-trace endpoints, filter list endpoints.
- `app/api/auth.py` — `?scope=private` on login; `has_private_access` in `/me`.
- `tests/_auth_helpers.py` — accept a `token_scopes` argument.
- `tests/test_private_traces.py` — new backend tests (create).
- `tests/test_repo_access.py` — new `RepoAccessChecker` unit tests (create).

**Frontend (`webapp/frontend/src/`)**
- `types.ts` — `is_private` on `TraceSummary`, `has_private_access` on `MeResponse`.
- `components/PrivateTraceGate.tsx` — new gated-state panel (create).
- `routes/TraceView.tsx` — branch on 401/403 into the gate panel.
- `components/TraceHeader.tsx` — private lock badge.
- `components/AuthWidget.tsx` — "Enable private repositories" menu item.
- `tests/routes/TraceView.test.tsx` — gate-state tests.
- `tests/AuthWidget.test.tsx` — enable-private-link test.

---

## Task 1: Add `is_private` to the Trace model

**Files:**
- Modify: `webapp/backend/app/storage/models.py`
- Test: `webapp/backend/tests/test_models.py`

- [ ] **Step 1: Write the failing test**

Append to `webapp/backend/tests/test_models.py`:

```python
@pytest.mark.asyncio
async def test_trace_is_private_defaults_false(client):
    from app.storage.models import Trace

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = Trace(
            short_id="privdefault",
            owner_login="alice",
            repo_full_name="alice/repo",
            pr_number=1,
            pr_url="https://github.com/alice/repo/pull/1",
            pr_title="t",
            platform="claude-code",
            byte_size=10,
            message_count=1,
            blob_prefix="traces/privdefault/",
            agents=[],
            agent_count=0,
        )
        session.add(trace)
        await session.commit()
        await session.refresh(trace)
        assert trace.is_private is False
```

If `test_models.py` does not already import pytest, add `import pytest` at the top.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && ../../env/bin/pytest tests/test_models.py::test_trace_is_private_defaults_false -v`
Expected: FAIL — `AttributeError: 'Trace' object has no attribute 'is_private'` on the final assert (the column does not exist yet).

- [ ] **Step 3: Add the column**

In `webapp/backend/app/storage/models.py`, add `Boolean` to the `sqlalchemy` import block:

```python
from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    Uuid,
)
```

In class `Trace`, add this column immediately after the `redaction_count_server` line:

```python
    # Snapshotted at ingest from the PR's repo visibility. Private traces are
    # gated behind a viewer's GitHub repo-read access; see app/api/traces.py.
    is_private: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/backend && ../../env/bin/pytest tests/test_models.py::test_trace_is_private_defaults_false -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/storage/models.py webapp/backend/tests/test_models.py
git commit -m "Add is_private column to Trace model"
```

---

## Task 2: Alembic migration for `is_private`

**Files:**
- Create: `webapp/backend/alembic/versions/7f3c1a9b2d4e_add_is_private_to_traces.py`

- [ ] **Step 1: Create the migration file**

Create `webapp/backend/alembic/versions/7f3c1a9b2d4e_add_is_private_to_traces.py`:

```python
"""add is_private to traces

Revision ID: 7f3c1a9b2d4e
Revises: def14788849e
Create Date: 2026-05-21 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "7f3c1a9b2d4e"
down_revision: Union[str, Sequence[str], None] = "def14788849e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add `is_private` to traces, defaulting existing rows to public.

    A single ADD COLUMN with a server_default works natively on both
    Postgres and SQLite (3.35+), so no batch/dialect branching is needed.
    """
    op.add_column(
        "traces",
        sa.Column(
            "is_private",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    """Drop the `is_private` column."""
    op.drop_column("traces", "is_private")
```

- [ ] **Step 2: Verify the revision chain**

Run: `cd webapp/backend && ../../env/bin/alembic heads`
Expected: a single head, `7f3c1a9b2d4e (head)`. (`alembic heads` reads the versions directory only — no DB connection.)

- [ ] **Step 3: Verify the migration file is valid Python**

Run: `cd webapp/backend && ../../env/bin/python -c "import ast; ast.parse(open('alembic/versions/7f3c1a9b2d4e_add_is_private_to_traces.py').read()); print('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add webapp/backend/alembic/versions/7f3c1a9b2d4e_add_is_private_to_traces.py
git commit -m "Add migration for traces.is_private"
```

---

## Task 3: Accept private repos in ingest

**Files:**
- Modify: `webapp/backend/app/api/ingest.py`
- Test: `webapp/backend/tests/test_private_traces.py` (create)

- [ ] **Step 1: Write the failing test**

Create `webapp/backend/tests/test_private_traces.py`:

```python
import pytest
from sqlalchemy import select

from tests.test_traces import make_bundle, _ingest_headers


def _user_resp(respx_mock):
    respx_mock.get("https://api.github.test/user").respond(
        200, json={"login": "alice", "id": 7}
    )


def _pull_resp(respx_mock, *, private: bool):
    respx_mock.get(
        "https://api.github.test/repos/alice/repo/pulls/3"
    ).respond(
        200,
        json={
            "number": 3,
            "title": "Hello",
            "user": {"login": "alice"},
            "html_url": "https://github.com/alice/repo/pull/3",
            "head": {"repo": {"private": private, "full_name": "alice/repo"}},
            "base": {"repo": {"private": private, "full_name": "alice/repo"}},
        },
    )


def _ingest(client, respx_mock, *, private: bool) -> str:
    _user_resp(respx_mock)
    _pull_resp(respx_mock, private=private)
    body = make_bundle({"main.jsonl": b'{"type":"user"}\n'})
    resp = client.post(
        "/api/ingest",
        content=body,
        headers=_ingest_headers("https://github.com/alice/repo/pull/3"),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["short_id"]


@pytest.mark.asyncio
async def test_ingest_private_repo_succeeds_and_flags_trace(client, respx_mock):
    from app.storage.models import Trace

    short_id = _ingest(client, respx_mock, private=True)

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == short_id)
        )).scalar_one()
        assert trace.is_private is True


@pytest.mark.asyncio
async def test_ingest_public_repo_is_not_private(client, respx_mock):
    from app.storage.models import Trace

    short_id = _ingest(client, respx_mock, private=False)

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == short_id)
        )).scalar_one()
        assert trace.is_private is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && ../../env/bin/pytest tests/test_private_traces.py -v`
Expected: `test_ingest_private_repo_succeeds_and_flags_trace` FAILS at `assert resp.status_code == 201` (ingest currently returns 403 for private repos). `test_ingest_public_repo_is_not_private` already passes — public ingest works and `is_private` defaults to `False` from the model. The private test is the meaningful red test here.

- [ ] **Step 3: Update ingest**

In `webapp/backend/app/api/ingest.py`, delete this block entirely:

```python
    if pr.repo_is_private:
        raise HTTPException(
            status_code=403,
            detail="private repos are not supported in v1; traces are public",
        )
```

Then in the `Trace(...)` constructor, add `is_private=pr.repo_is_private,` immediately after the `redaction_count_server=unpacked.total_redactions,` line:

```python
        redaction_count_server=unpacked.total_redactions,
        is_private=pr.repo_is_private,
        blob_path=None,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/backend && ../../env/bin/pytest tests/test_private_traces.py -v`
Expected: both tests PASS

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/api/ingest.py webapp/backend/tests/test_private_traces.py
git commit -m "Accept private-repo uploads and flag the trace"
```

---

## Task 4: RepoAccessChecker

**Files:**
- Create: `webapp/backend/app/github/repo_access.py`
- Test: `webapp/backend/tests/test_repo_access.py` (create)

- [ ] **Step 1: Write the failing test**

Create `webapp/backend/tests/test_repo_access.py`:

```python
import uuid

import pytest

from app.github.repo_access import RepoAccessChecker, RepoAccessError

API = "https://api.github.test"


@pytest.mark.asyncio
async def test_can_read_returns_true_on_200(respx_mock):
    respx_mock.get(f"{API}/repos/alice/repo").respond(200, json={"id": 1})
    checker = RepoAccessChecker(API)
    assert await checker.can_read(uuid.uuid4(), "tok", "alice/repo") is True


@pytest.mark.asyncio
async def test_can_read_returns_false_on_404(respx_mock):
    respx_mock.get(f"{API}/repos/alice/secret").respond(404, json={})
    checker = RepoAccessChecker(API)
    assert await checker.can_read(uuid.uuid4(), "tok", "alice/secret") is False


@pytest.mark.asyncio
async def test_can_read_raises_on_unexpected_status(respx_mock):
    respx_mock.get(f"{API}/repos/alice/repo").respond(500, text="boom")
    checker = RepoAccessChecker(API)
    with pytest.raises(RepoAccessError):
        await checker.can_read(uuid.uuid4(), "tok", "alice/repo")


@pytest.mark.asyncio
async def test_result_is_cached_within_ttl(respx_mock):
    route = respx_mock.get(f"{API}/repos/alice/repo").respond(200, json={})
    checker = RepoAccessChecker(API, ttl_seconds=60)
    uid = uuid.uuid4()
    assert await checker.can_read(uid, "tok", "alice/repo") is True
    assert await checker.can_read(uid, "tok", "alice/repo") is True
    assert route.call_count == 1


@pytest.mark.asyncio
async def test_cache_does_not_leak_across_users(respx_mock):
    respx_mock.get(f"{API}/repos/alice/repo").mock(
        side_effect=[
            __import__("httpx").Response(200, json={}),
            __import__("httpx").Response(404, json={}),
        ]
    )
    checker = RepoAccessChecker(API, ttl_seconds=60)
    user_a, user_b = uuid.uuid4(), uuid.uuid4()
    assert await checker.can_read(user_a, "tok-a", "alice/repo") is True
    assert await checker.can_read(user_b, "tok-b", "alice/repo") is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && ../../env/bin/pytest tests/test_repo_access.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.github.repo_access'`

- [ ] **Step 3: Implement RepoAccessChecker**

Create `webapp/backend/app/github/repo_access.py`:

```python
from __future__ import annotations

import uuid
from time import monotonic

import httpx


class RepoAccessError(Exception):
    """GitHub returned an unexpected status while checking repo access."""


class RepoAccessChecker:
    """Decides whether a viewer may read a GitHub repo, by asking GitHub.

    Calls `GET /repos/{owner}/{repo}` with the viewer's own OAuth token:
    200 means the viewer can read the repo, 404 means they cannot (GitHub
    returns 404 — not 403 — for private repos the caller can't see).

    Results are cached per `(user_id, repo_full_name)` with a short TTL. The
    cache is deliberately keyed by user, never shared across viewers — a
    private 200 must never be served to a different viewer.
    """

    def __init__(
        self,
        api_base: str,
        *,
        ttl_seconds: int = 60,
        timeout: float = 10.0,
    ) -> None:
        self._api_base = api_base.rstrip("/")
        self._ttl = ttl_seconds
        self._timeout = timeout
        self._cache: dict[tuple[uuid.UUID, str], tuple[bool, float]] = {}

    def cache_size(self) -> int:
        return len(self._cache)

    async def can_read(
        self, user_id: uuid.UUID, token: str, repo_full_name: str
    ) -> bool:
        key = (user_id, repo_full_name)
        now = monotonic()
        cached = self._cache.get(key)
        if cached is not None and cached[1] > now:
            return cached[0]

        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        url = f"{self._api_base}/repos/{repo_full_name}"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as http:
                resp = await http.get(url, headers=headers)
        except httpx.HTTPError as exc:
            raise RepoAccessError(str(exc)) from exc

        if resp.status_code == 200:
            allowed = True
        elif resp.status_code == 404:
            allowed = False
        else:
            # 401 (bad token), 403 (rate limited), 5xx — do not cache;
            # surface so the caller can return a clear upstream error.
            raise RepoAccessError(
                f"unexpected {resp.status_code} from repo lookup"
            )

        self._cache[key] = (allowed, now + self._ttl)
        return allowed
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/backend && ../../env/bin/pytest tests/test_repo_access.py -v`
Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/github/repo_access.py webapp/backend/tests/test_repo_access.py
git commit -m "Add RepoAccessChecker for viewer repo-access checks"
```

---

## Task 5: Wire RepoAccessChecker into app deps

**Files:**
- Modify: `webapp/backend/app/deps.py`
- Test: `webapp/backend/tests/test_deps.py`

- [ ] **Step 1: Write the failing test**

Append to `webapp/backend/tests/test_deps.py`:

```python
def test_app_state_has_repo_access(client):
    from app.github.repo_access import RepoAccessChecker

    assert isinstance(client.app.state.repo_access, RepoAccessChecker)
```

If `test_deps.py` has no `client` fixture usage yet, the shared `client` fixture from `conftest.py` is auto-available — no import needed.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && ../../env/bin/pytest tests/test_deps.py::test_app_state_has_repo_access -v`
Expected: FAIL — `AttributeError: 'State' object has no attribute 'repo_access'`

- [ ] **Step 3: Wire it into deps**

In `webapp/backend/app/deps.py`, add the import near the other `app.github` import:

```python
from app.github.public_client import PublicGitHubClient
from app.github.repo_access import RepoAccessChecker
```

In `init_state`, after the `app.state.public_github = PublicGitHubClient(...)` block, add:

```python
    app.state.repo_access = RepoAccessChecker(
        settings.github_api_base,
        ttl_seconds=60,
    )
```

At the end of the file, after `get_public_github`, add:

```python
def get_repo_access(request: Request) -> RepoAccessChecker:
    return request.app.state.repo_access
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/backend && ../../env/bin/pytest tests/test_deps.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/deps.py webapp/backend/tests/test_deps.py
git commit -m "Wire RepoAccessChecker into app state and deps"
```

---

## Task 6: Expose `is_private` in the trace summary

**Files:**
- Modify: `webapp/backend/app/api/schemas.py`
- Modify: `webapp/backend/app/api/traces.py`
- Test: `webapp/backend/tests/test_private_traces.py`

- [ ] **Step 1: Write the failing test**

Append to `webapp/backend/tests/test_private_traces.py`:

```python
@pytest.mark.asyncio
async def test_get_trace_summary_includes_is_private_false_for_public(
    client, respx_mock
):
    short_id = _ingest(client, respx_mock, private=False)
    resp = client.get(f"/api/traces/{short_id}")
    assert resp.status_code == 200
    assert resp.json()["is_private"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && ../../env/bin/pytest tests/test_private_traces.py::test_get_trace_summary_includes_is_private_false_for_public -v`
Expected: FAIL — `KeyError: 'is_private'`

- [ ] **Step 3: Add the field**

In `webapp/backend/app/api/schemas.py`, in class `TraceSummary`, add after the `created_at: str` line:

```python
    created_at: str
    is_private: bool = False
```

In `webapp/backend/app/api/traces.py`, in `_to_summary`, add `is_private=t.is_private,` after the `created_at=...` argument:

```python
        created_at=t.created_at.isoformat(),
        is_private=t.is_private,
        agent_count=t.agent_count or 0,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/backend && ../../env/bin/pytest tests/test_private_traces.py -v`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/api/schemas.py webapp/backend/app/api/traces.py webapp/backend/tests/test_private_traces.py
git commit -m "Expose is_private in the trace summary schema"
```

---

## Task 7: Gate single-trace view endpoints

**Files:**
- Modify: `webapp/backend/tests/_auth_helpers.py`
- Modify: `webapp/backend/app/api/traces.py`
- Test: `webapp/backend/tests/test_private_traces.py`

- [ ] **Step 1: Extend the auth test helper**

In `webapp/backend/tests/_auth_helpers.py`, change `_seed_user` and `authed_cookies` to accept a `token_scopes` argument.

Replace the `_seed_user` signature line and the `token_scopes=` line:

```python
async def _seed_user(SessionLocal, *, github_id: int, login: str,
                    access_token: str = "gho_test",
                    token_scopes: str = "read:user,user:email") -> User:
```

```python
            encrypted_access_token=cipher.encrypt(access_token),
            token_scopes=token_scopes,
```

Replace the `authed_cookies` signature and the `_seed_user` call inside it:

```python
async def authed_cookies(client: TestClient, *, github_id: int = 100,
                         login: str = "alice", access_token: str = "gho_user",
                         token_scopes: str = "read:user,user:email"):
    """Seed a User + UserSession and return a cookies dict for TestClient."""
    SessionLocal = client.app.state.session_maker
    user = await _seed_user(
        SessionLocal, github_id=github_id, login=login,
        access_token=access_token, token_scopes=token_scopes,
    )
    sid = await _create_session(SessionLocal, user.id)
    return {SESSION_COOKIE_NAME: sid}, user
```

- [ ] **Step 2: Write the failing tests**

Append to `webapp/backend/tests/test_private_traces.py`:

```python
from tests._auth_helpers import authed_cookies

REPO_URL = "https://api.github.test/repos/alice/repo"


@pytest.mark.asyncio
async def test_private_trace_401_for_anonymous(client, respx_mock):
    short_id = _ingest(client, respx_mock, private=True)
    resp = client.get(f"/api/traces/{short_id}")
    assert resp.status_code == 401
    assert resp.json()["detail"] == "auth_required"


@pytest.mark.asyncio
async def test_private_trace_403_when_token_lacks_repo_scope(
    client, respx_mock
):
    short_id = _ingest(client, respx_mock, private=True)
    cookies, _ = await authed_cookies(
        client, token_scopes="read:user,user:email"
    )
    resp = client.get(f"/api/traces/{short_id}", cookies=cookies)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "private_scope_required"


@pytest.mark.asyncio
async def test_private_trace_404_when_github_denies(client, respx_mock):
    short_id = _ingest(client, respx_mock, private=True)
    cookies, _ = await authed_cookies(
        client, token_scopes="repo,read:user,user:email"
    )
    respx_mock.get(REPO_URL).respond(404, json={})
    resp = client.get(f"/api/traces/{short_id}", cookies=cookies)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_private_trace_200_when_github_allows(client, respx_mock):
    short_id = _ingest(client, respx_mock, private=True)
    cookies, _ = await authed_cookies(
        client, token_scopes="repo,read:user,user:email"
    )
    respx_mock.get(REPO_URL).respond(200, json={"id": 1})
    resp = client.get(f"/api/traces/{short_id}", cookies=cookies)
    assert resp.status_code == 200
    assert resp.json()["is_private"] is True
    assert resp.headers["Cache-Control"] == "private, no-store"


@pytest.mark.asyncio
async def test_private_trace_raw_gated_for_anonymous(client, respx_mock):
    short_id = _ingest(client, respx_mock, private=True)
    resp = client.get(f"/api/traces/{short_id}/raw")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_private_trace_raw_served_when_allowed(client, respx_mock):
    short_id = _ingest(client, respx_mock, private=True)
    cookies, _ = await authed_cookies(
        client, token_scopes="repo,read:user,user:email"
    )
    respx_mock.get(REPO_URL).respond(200, json={"id": 1})
    resp = client.get(f"/api/traces/{short_id}/raw", cookies=cookies)
    assert resp.status_code == 200
    assert resp.headers["Cache-Control"] == "private, no-store"
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd webapp/backend && ../../env/bin/pytest tests/test_private_traces.py -k "private_trace" -v`
Expected: FAIL — anonymous gets 200 instead of 401 (endpoints are currently ungated).

- [ ] **Step 4: Add access helpers and gate the endpoints**

In `webapp/backend/app/api/traces.py`, update the imports block to:

```python
from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import AgentSummary, TraceSummary
from app.auth.crypto import TokenCipher
from app.auth.github import GitHubAuthError, GitHubClient
from app.auth.sessions import get_current_user
from app.deps import (
    get_app_settings,
    get_blob_store,
    get_github,
    get_repo_access,
    get_session,
)
from app.github.repo_access import RepoAccessChecker, RepoAccessError
from app.settings import Settings
from app.short_id import looks_like_short_id
from app.storage.blob import BlobStore
from app.storage.models import Trace, User, utcnow
```

Immediately after the `_AGENT_ID_RE = ...` line, add the helpers:

```python
def _has_repo_scope(user: User) -> bool:
    return "repo" in (user.token_scopes or "").split(",")


def _viewer_token(user: User, settings: Settings) -> str | None:
    try:
        return TokenCipher(settings.token_encryption_key).decrypt(
            user.encrypted_access_token
        )
    except Exception:
        return None


async def _can_view_repo(
    repo_full_name: str,
    user: User | None,
    settings: Settings,
    access: RepoAccessChecker,
) -> bool:
    """True if `user` may read `repo_full_name` per GitHub. Never raises."""
    if user is None or not _has_repo_scope(user):
        return False
    token = _viewer_token(user, settings)
    if token is None:
        return False
    try:
        return await access.can_read(user.id, token, repo_full_name)
    except RepoAccessError:
        return False


async def _require_trace_access(
    trace: Trace,
    user: User | None,
    settings: Settings,
    access: RepoAccessChecker,
) -> None:
    """Raise the appropriate HTTPException if a viewer may not see `trace`.

    Public traces pass unconditionally. Private traces produce: 401 when the
    viewer is anonymous, 403 when logged in without `repo` scope, 404 when
    GitHub says the viewer cannot read the repo.
    """
    if not trace.is_private:
        return
    if user is None:
        raise HTTPException(status_code=401, detail="auth_required")
    if not _has_repo_scope(user):
        raise HTTPException(status_code=403, detail="private_scope_required")
    token = _viewer_token(user, settings)
    if token is None:
        raise HTTPException(status_code=403, detail="private_scope_required")
    try:
        allowed = await access.can_read(
            user.id, token, trace.repo_full_name
        )
    except RepoAccessError:
        raise HTTPException(
            status_code=502, detail="github_upstream_error"
        )
    if not allowed:
        raise HTTPException(status_code=404, detail="not_found")


async def _filter_visible(
    rows: list[Trace],
    user: User | None,
    settings: Settings,
    access: RepoAccessChecker,
) -> list[Trace]:
    """Drop private traces whose repo `user` cannot read. Public rows pass.

    Checks once per distinct private repo — privacy is a property of the
    repo, so all of a repo's traces share one access decision.
    """
    private_repos = {t.repo_full_name for t in rows if t.is_private}
    if not private_repos:
        return list(rows)
    visible: set[str] = set()
    for repo in private_repos:
        if await _can_view_repo(repo, user, settings, access):
            visible.add(repo)
    return [
        t for t in rows
        if not t.is_private or t.repo_full_name in visible
    ]
```

Replace the `get_trace` function with:

```python
@router.get("/api/traces/{short_id}", response_model=TraceSummary)
async def get_trace(
    short_id: str,
    response: Response,
    session: AsyncSession = Depends(get_session),
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
    access: RepoAccessChecker = Depends(get_repo_access),
):
    if not looks_like_short_id(short_id):
        raise HTTPException(status_code=404, detail="not found")
    stmt = select(Trace).where(
        Trace.short_id == short_id,
        Trace.deleted_at.is_(None),
    )
    trace = (await session.execute(stmt)).scalar_one_or_none()
    if trace is None:
        raise HTTPException(status_code=404, detail="not found")
    await _require_trace_access(trace, user, settings, access)
    if trace.is_private:
        response.headers["Cache-Control"] = "private, no-store"
    return _to_summary(trace)
```

Replace the `get_trace_raw` function with:

```python
@router.get("/api/traces/{short_id}/raw")
async def get_trace_raw(
    short_id: str,
    session: AsyncSession = Depends(get_session),
    blob_store: BlobStore = Depends(get_blob_store),
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
    access: RepoAccessChecker = Depends(get_repo_access),
):
    if not looks_like_short_id(short_id):
        raise HTTPException(status_code=404, detail="not found")
    stmt = select(Trace).where(
        Trace.short_id == short_id,
        Trace.deleted_at.is_(None),
    )
    trace = (await session.execute(stmt)).scalar_one_or_none()
    if trace is None:
        raise HTTPException(status_code=404, detail="not found")
    await _require_trace_access(trace, user, settings, access)
    if trace.blob_prefix is None:
        # Should not happen post-migration. 500 so we notice.
        raise HTTPException(status_code=500, detail="trace not migrated to v2 layout")
    data = await blob_store.get(f"{trace.blob_prefix}main.jsonl")
    headers = (
        {"Cache-Control": "private, no-store"} if trace.is_private else None
    )
    return Response(
        content=data, media_type="application/x-ndjson", headers=headers
    )
```

Replace the `get_agent_raw` function with:

```python
@router.get("/api/traces/{short_id}/agents/{agent_id}")
async def get_agent_raw(
    short_id: str,
    agent_id: str,
    session: AsyncSession = Depends(get_session),
    blob_store: BlobStore = Depends(get_blob_store),
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
    access: RepoAccessChecker = Depends(get_repo_access),
):
    if not looks_like_short_id(short_id):
        raise HTTPException(status_code=404, detail="not found")
    if not _AGENT_ID_RE.match(agent_id):
        raise HTTPException(status_code=404, detail="not found")

    stmt = select(Trace).where(
        Trace.short_id == short_id,
        Trace.deleted_at.is_(None),
    )
    trace = (await session.execute(stmt)).scalar_one_or_none()
    if trace is None:
        raise HTTPException(status_code=404, detail="not found")
    await _require_trace_access(trace, user, settings, access)
    if trace.blob_prefix is None:
        raise HTTPException(status_code=500, detail="trace not migrated to v2 layout")

    known_ids = {a["agent_id"] for a in (trace.agents or [])}
    if agent_id not in known_ids:
        raise HTTPException(status_code=404, detail="agent not found")

    data = await blob_store.get(f"{trace.blob_prefix}agents/{agent_id}.jsonl")
    headers = (
        {"Cache-Control": "private, no-store"} if trace.is_private else None
    )
    return Response(
        content=data, media_type="application/x-ndjson", headers=headers
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd webapp/backend && ../../env/bin/pytest tests/test_private_traces.py tests/test_traces.py -v`
Expected: all PASS (existing public-trace tests in `test_traces.py` still pass — public traces are ungated).

- [ ] **Step 6: Commit**

```bash
git add webapp/backend/app/api/traces.py webapp/backend/tests/_auth_helpers.py webapp/backend/tests/test_private_traces.py
git commit -m "Gate single-trace endpoints behind viewer repo access"
```

---

## Task 8: Filter private traces out of list endpoints

**Files:**
- Modify: `webapp/backend/app/api/traces.py`
- Test: `webapp/backend/tests/test_private_traces.py`

- [ ] **Step 1: Write the failing tests**

Append to `webapp/backend/tests/test_private_traces.py`:

```python
@pytest.mark.asyncio
async def test_pr_list_hides_private_from_anonymous(client, respx_mock):
    _ingest(client, respx_mock, private=True)
    resp = client.get("/api/traces/alice/repo/pull/3")
    assert resp.status_code == 200
    assert resp.json()["traces"] == []


@pytest.mark.asyncio
async def test_pr_list_shows_private_to_authorized_viewer(
    client, respx_mock
):
    _ingest(client, respx_mock, private=True)
    cookies, _ = await authed_cookies(
        client, token_scopes="repo,read:user,user:email"
    )
    respx_mock.get(REPO_URL).respond(200, json={"id": 1})
    resp = client.get("/api/traces/alice/repo/pull/3", cookies=cookies)
    assert resp.status_code == 200
    assert len(resp.json()["traces"]) == 1


@pytest.mark.asyncio
async def test_repo_overview_hides_private_from_anonymous(
    client, respx_mock
):
    _ingest(client, respx_mock, private=True)
    resp = client.get("/api/repos/alice/repo")
    assert resp.status_code == 200
    assert resp.json()["traces"] == []
    assert resp.json()["stats"]["trace_count"] == 0


@pytest.mark.asyncio
async def test_user_overview_hides_private_from_anonymous(
    client, respx_mock
):
    _ingest(client, respx_mock, private=True)
    resp = client.get("/api/users/alice")
    assert resp.status_code == 200
    assert resp.json()["traces"] == []
    assert resp.json()["repos"] == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webapp/backend && ../../env/bin/pytest tests/test_private_traces.py -k "list or overview" -v`
Expected: FAIL — private traces currently appear in all list endpoints.

- [ ] **Step 3: Filter the list endpoints**

In `webapp/backend/app/api/traces.py`, replace `list_pr_traces` with:

```python
@router.get("/api/traces/{owner}/{repo}/pull/{number}")
async def list_pr_traces(
    owner: str,
    repo: str,
    number: int,
    session: AsyncSession = Depends(get_session),
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
    access: RepoAccessChecker = Depends(get_repo_access),
):
    full_name = f"{owner}/{repo}"
    stmt = select(Trace).where(
        Trace.repo_full_name == full_name,
        Trace.pr_number == number,
        Trace.deleted_at.is_(None),
    ).order_by(Trace.created_at.desc())
    rows = (await session.execute(stmt)).scalars().all()
    rows = await _filter_visible(list(rows), user, settings, access)
    return {"traces": [_to_summary(t).model_dump() for t in rows]}
```

Replace `get_user_overview` with:

```python
@router.get("/api/users/{login}")
async def get_user_overview(
    login: str,
    session: AsyncSession = Depends(get_session),
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
    access: RepoAccessChecker = Depends(get_repo_access),
):
    # All traces hosted under repos owned by this user
    # (repo_full_name like "{login}/...").
    prefix = f"{login}/"
    list_stmt = (
        select(Trace)
        .where(
            Trace.repo_full_name.startswith(prefix),
            Trace.deleted_at.is_(None),
        )
        .order_by(Trace.created_at.desc())
    )
    rows = (await session.execute(list_stmt)).scalars().all()
    rows = await _filter_visible(list(rows), user, settings, access)

    # Aggregate repos from the visible rows so private repos the viewer
    # cannot see never appear in the repo breakdown.
    repo_counts: dict[str, int] = {}
    for t in rows:
        repo_counts[t.repo_full_name] = repo_counts.get(t.repo_full_name, 0) + 1
    repos = [
        {
            "repo_full_name": rn,
            "repo_name": rn.split("/", 1)[1] if "/" in rn else rn,
            "trace_count": count,
        }
        for rn, count in sorted(
            repo_counts.items(), key=lambda kv: (-kv[1], kv[0])
        )
    ]

    total_messages = sum(t.message_count for t in rows)
    total_bytes = sum(t.byte_size for t in rows)
    last_at = rows[0].created_at.isoformat() if rows else None

    return {
        "login": login,
        "stats": {
            "trace_count": len(rows),
            "repo_count": len(repos),
            "message_count": total_messages,
            "byte_size": total_bytes,
            "last_trace_at": last_at,
        },
        "repos": repos,
        "traces": [_to_summary(t).model_dump() for t in rows],
    }
```

Replace `get_repo_overview` with:

```python
@router.get("/api/repos/{owner}/{repo}")
async def get_repo_overview(
    owner: str,
    repo: str,
    session: AsyncSession = Depends(get_session),
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
    access: RepoAccessChecker = Depends(get_repo_access),
):
    full_name = f"{owner}/{repo}"
    list_stmt = (
        select(Trace)
        .where(
            Trace.repo_full_name == full_name,
            Trace.deleted_at.is_(None),
        )
        .order_by(Trace.created_at.desc())
    )
    rows = (await session.execute(list_stmt)).scalars().all()
    rows = await _filter_visible(list(rows), user, settings, access)

    # Aggregate contributors from the visible rows.
    contrib_counts: dict[str, int] = {}
    for t in rows:
        contrib_counts[t.owner_login] = contrib_counts.get(t.owner_login, 0) + 1
    contributors = [
        {"login": loginname, "trace_count": count}
        for loginname, count in sorted(
            contrib_counts.items(), key=lambda kv: (-kv[1], kv[0])
        )
    ]

    pr_count = len({t.pr_number for t in rows})
    total_messages = sum(t.message_count for t in rows)
    total_bytes = sum(t.byte_size for t in rows)
    last_at = rows[0].created_at.isoformat() if rows else None

    return {
        "owner": owner,
        "repo": repo,
        "repo_full_name": full_name,
        "stats": {
            "trace_count": len(rows),
            "pr_count": pr_count,
            "contributor_count": len(contributors),
            "message_count": total_messages,
            "byte_size": total_bytes,
            "last_trace_at": last_at,
        },
        "contributors": contributors,
        "traces": [_to_summary(t).model_dump() for t in rows],
    }
```

The `func` import from `sqlalchemy` is now unused — change `from sqlalchemy import func, select` to `from sqlalchemy import select`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webapp/backend && ../../env/bin/pytest tests/test_private_traces.py tests/test_traces.py -v`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/api/traces.py webapp/backend/tests/test_private_traces.py
git commit -m "Filter inaccessible private traces from list endpoints"
```

---

## Task 9: Scope-upgrade login and `has_private_access`

**Files:**
- Modify: `webapp/backend/app/api/auth.py`
- Test: `webapp/backend/tests/test_auth_oauth.py`, `webapp/backend/tests/test_auth_me.py`

- [ ] **Step 1: Write the failing tests**

Append to `webapp/backend/tests/test_auth_oauth.py`:

```python
def test_login_with_scope_private_requests_repo_scope(client):
    resp = client.get(
        "/api/auth/github/login?scope=private", follow_redirects=False
    )
    assert resp.status_code in (302, 307)
    location = resp.headers["location"]
    # GitHub's authorize URL carries the scope as a query param; `repo`
    # must be present when the private upgrade was requested.
    assert "repo" in location


def test_login_default_does_not_request_repo_scope(client):
    resp = client.get(
        "/api/auth/github/login", follow_redirects=False
    )
    assert resp.status_code in (302, 307)
    location = resp.headers["location"]
    assert "repo" not in location
```

Append to `webapp/backend/tests/test_auth_me.py`:

```python
@pytest.mark.asyncio
async def test_me_reports_has_private_access_false_without_repo_scope(
    client,
):
    from tests._auth_helpers import authed_cookies

    cookies, _ = await authed_cookies(
        client, token_scopes="read:user,user:email"
    )
    resp = client.get("/api/auth/me", cookies=cookies)
    assert resp.status_code == 200
    assert resp.json()["has_private_access"] is False


@pytest.mark.asyncio
async def test_me_reports_has_private_access_true_with_repo_scope(client):
    from tests._auth_helpers import authed_cookies

    cookies, _ = await authed_cookies(
        client, token_scopes="repo,read:user,user:email"
    )
    resp = client.get("/api/auth/me", cookies=cookies)
    assert resp.status_code == 200
    assert resp.json()["has_private_access"] is True
```

If `test_auth_me.py` lacks `import pytest`, add it at the top.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webapp/backend && ../../env/bin/pytest tests/test_auth_oauth.py tests/test_auth_me.py -k "scope or private" -v`
Expected: FAIL — `repo` is never requested; `/me` has no `has_private_access` key.

- [ ] **Step 3: Update the login route**

In `webapp/backend/app/api/auth.py`, add a module-level constant after the `router = APIRouter(...)` line:

```python
# The minimal scope is fixed in app/auth/oauth.py's client registration.
# A `?scope=private` login additionally requests classic `repo` — the only
# scope a classic OAuth App can use to read private repos (it also grants
# write; vibeshub never calls a write endpoint).
PRIVATE_SCOPE = "read:user user:email repo"
```

Replace the `github_login` function with:

```python
@router.get("/github/login")
async def github_login(
    request: Request,
    next: str | None = None,
    scope: str | None = None,
    settings: Settings = Depends(get_app_settings),
):
    _require_oauth_configured(settings)
    request.session["next_path"] = _validated_next(next)
    oauth = request.app.state.oauth
    redirect_uri = settings.public_base_url.rstrip("/") + "/api/auth/github/callback"
    log.info("auth.login.start scope=%s", "private" if scope == "private" else "default")
    if scope == "private":
        return await oauth.github.authorize_redirect(
            request, redirect_uri, scope=PRIVATE_SCOPE
        )
    return await oauth.github.authorize_redirect(request, redirect_uri)
```

The OAuth callback already stores GitHub's returned scope string into `User.token_scopes` — no change needed there.

Replace the `me` function's return dict (the `return {...}` for a non-None user) with:

```python
    return {
        "id": str(user.id),
        "login": user.github_login,
        "name": user.name,
        "avatar_url": user.avatar_url,
        "has_private_access": "repo" in (user.token_scopes or "").split(","),
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webapp/backend && ../../env/bin/pytest tests/test_auth_oauth.py tests/test_auth_me.py -v`
Expected: all PASS

- [ ] **Step 5: Run the full backend suite**

Run: `cd webapp/backend && ../../env/bin/pytest -q`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add webapp/backend/app/api/auth.py webapp/backend/tests/test_auth_oauth.py webapp/backend/tests/test_auth_me.py
git commit -m "Add scope-upgrade login and has_private_access in /me"
```

---

## Task 10: Frontend types

**Files:**
- Modify: `webapp/frontend/src/types.ts`

- [ ] **Step 1: Update the types**

In `webapp/frontend/src/types.ts`, in `interface TraceSummary`, add after `created_at: string;`:

```typescript
  created_at: string;
  is_private: boolean;
```

In `interface MeResponse`, add after `avatar_url: string | null;`:

```typescript
  avatar_url: string | null;
  has_private_access: boolean;
```

- [ ] **Step 2: Verify the project still type-checks**

Run: `cd webapp/frontend && npx tsc --noEmit`
Expected: errors only in files that construct `TraceSummary` / `MeResponse` literals (test files) — those are fixed in Tasks 11 and 13. No errors in `src/` non-test files.

- [ ] **Step 3: Commit**

```bash
git add webapp/frontend/src/types.ts
git commit -m "Add is_private and has_private_access to frontend types"
```

---

## Task 11: Frontend gated-trace states

**Files:**
- Create: `webapp/frontend/src/components/PrivateTraceGate.tsx`
- Modify: `webapp/frontend/src/routes/TraceView.tsx`
- Test: `webapp/frontend/src/tests/routes/TraceView.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `webapp/frontend/src/tests/routes/TraceView.test.tsx`, first add `is_private: false,` to the `mockFetchSequence` call's trace-summary object inside the existing "renders the hero title…" test (after its `created_at` line), so it satisfies the updated type.

Then append these tests inside the `describe("TraceView", ...)` block:

```typescript
  it("shows a sign-in gate when the trace summary returns 401", async () => {
    vi.spyOn(global, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith(`/api/traces/${SHORT_ID}`)) {
        return Promise.resolve(
          new Response(JSON.stringify({ detail: "auth_required" }), {
            status: 401,
          }),
        );
      }
      return Promise.resolve(new Response("", { status: 200 }));
    });

    renderAt(`/alice/repo/pull/7/${SHORT_ID}`);

    const link = await screen.findByRole("link", {
      name: /sign in with github/i,
    });
    expect(link.getAttribute("href")).toContain("/api/auth/github/login");
  });

  it("shows an enable-private gate when the summary returns 403", async () => {
    vi.spyOn(global, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith(`/api/traces/${SHORT_ID}`)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ detail: "private_scope_required" }),
            { status: 403 },
          ),
        );
      }
      return Promise.resolve(new Response("", { status: 200 }));
    });

    renderAt(`/alice/repo/pull/7/${SHORT_ID}`);

    const link = await screen.findByRole("link", {
      name: /enable private repositories/i,
    });
    expect(link.getAttribute("href")).toContain("scope=private");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webapp/frontend && npx vitest run src/tests/routes/TraceView.test.tsx`
Expected: the two new tests FAIL — no sign-in/enable links rendered (the current code shows a generic error).

- [ ] **Step 3: Create the gate component**

Create `webapp/frontend/src/components/PrivateTraceGate.tsx`:

```typescript
import { useLocation } from "react-router-dom";

interface Props {
  kind: "signin" | "enable";
}

/**
 * Shown when a private trace cannot be displayed: either the viewer is
 * signed out (`signin`), or signed in without the `repo` scope (`enable`).
 * Both route through the GitHub OAuth login; `enable` adds `scope=private`
 * to request the broader scope needed to read private repos.
 */
export function PrivateTraceGate({ kind }: Props) {
  const location = useLocation();
  const next = encodeURIComponent(location.pathname + location.search);
  const href =
    kind === "enable"
      ? `/api/auth/github/login?scope=private&next=${next}`
      : `/api/auth/github/login?next=${next}`;

  return (
    <div className="private-gate" role="status">
      <h2>🔒 This trace is private</h2>
      {kind === "signin" ? (
        <p>
          This trace belongs to a private repository. Sign in with GitHub
          to view it — you'll only see it if your GitHub account can access
          the repository.
        </p>
      ) : (
        <p>
          To view private-repository traces, GitHub needs to grant vibeshub
          access to your repositories. GitHub will ask for read/write access
          to your private repos — vibeshub only ever reads them.
        </p>
      )}
      <a className="iconbtn primary" href={href}>
        {kind === "enable"
          ? "Enable private repositories"
          : "Sign in with GitHub"}
      </a>
    </div>
  );
}
```

- [ ] **Step 4: Wire it into TraceView**

Replace the entire contents of `webapp/frontend/src/routes/TraceView.tsx` with:

```typescript
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, fetchRawJsonl, fetchTrace } from "../api";
import type { TraceSummary } from "../types";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { PrivateTraceGate } from "../components/PrivateTraceGate";
import { TraceHeader } from "../components/TraceHeader";
import { TraceViewer } from "../components/trace/TraceViewer";
import { buildSession, parseJsonl } from "../components/trace/parser";
import type { Session } from "../components/trace/types";
import styles from "./TraceView.module.css";

type HeadState =
  | { kind: "loading" }
  | { kind: "ready"; trace: TraceSummary }
  | { kind: "gate"; gate: "signin" | "enable" }
  | { kind: "error"; message: string };

type BodyState =
  | { kind: "loading" }
  | { kind: "ready"; jsonl: string }
  | { kind: "error"; message: string };

export function TraceView() {
  const { shortId } = useParams<{ shortId: string }>();
  const [head, setHead] = useState<HeadState>({ kind: "loading" });
  const [body, setBody] = useState<BodyState>({ kind: "loading" });

  useEffect(() => {
    if (!shortId) return;
    setHead({ kind: "loading" });
    fetchTrace(shortId)
      .then((trace) => setHead({ kind: "ready", trace }))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          setHead({ kind: "gate", gate: "signin" });
        } else if (e instanceof ApiError && e.status === 403) {
          setHead({ kind: "gate", gate: "enable" });
        } else {
          setHead({ kind: "error", message: String(e) });
        }
      });
  }, [shortId]);

  useEffect(() => {
    if (!shortId) return;
    setBody({ kind: "loading" });
    fetchRawJsonl(shortId)
      .then((jsonl) => setBody({ kind: "ready", jsonl }))
      .catch((e) => setBody({ kind: "error", message: String(e) }));
  }, [shortId]);

  const trace = head.kind === "ready" ? head.trace : null;

  const session: Session | null = useMemo(() => {
    if (body.kind !== "ready") return null;
    const built = buildSession(parseJsonl(body.jsonl));
    if (trace?.agents) {
      built.meta.agents = trace.agents;
    }
    return built;
  }, [body, trace]);

  if (head.kind === "gate") return <PrivateTraceGate kind={head.gate} />;
  if (head.kind === "error") return <ErrorState message={head.message} />;
  if (head.kind === "loading") return <LoadingState label="Loading trace…" />;

  return (
    <div className={styles.container}>
      <TraceHeader trace={head.trace} />
      {body.kind === "loading" && <LoadingState label="Loading trace…" />}
      {body.kind === "error" && <ErrorState message={body.message} />}
      {body.kind === "ready" && session && (
        <TraceViewer
          session={session}
          shortId={head.trace.short_id}
          rawHref={`/api/traces/${head.trace.short_id}/raw`}
          repoOwner={head.trace.repo_full_name.split("/")[0]}
          repoName={head.trace.repo_full_name.split("/")[1]}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd webapp/frontend && npx vitest run src/tests/routes/TraceView.test.tsx`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add webapp/frontend/src/components/PrivateTraceGate.tsx webapp/frontend/src/routes/TraceView.tsx webapp/frontend/src/tests/routes/TraceView.test.tsx
git commit -m "Render sign-in / enable-private gates for private traces"
```

---

## Task 12: Private lock badge in the trace header

**Files:**
- Modify: `webapp/frontend/src/components/TraceHeader.tsx`
- Test: `webapp/frontend/src/tests/routes/TraceView.test.tsx`

- [ ] **Step 1: Write the failing test**

Append inside the `describe("TraceView", ...)` block in `webapp/frontend/src/tests/routes/TraceView.test.tsx`:

```typescript
  it("renders a Private badge for a private trace", async () => {
    mockFetchSequence({
      trace_id: "id",
      short_id: SHORT_ID,
      owner_login: "alice",
      repo_full_name: "alice/repo",
      pr_number: 7,
      pr_url: "https://github.com/alice/repo/pull/7",
      pr_title: "Add thing",
      platform: "claude-code",
      byte_size: FIXTURE.length,
      message_count: 100,
      created_at: "2026-05-17T00:00:00Z",
      is_private: true,
    });

    renderAt(`/alice/repo/pull/7/${SHORT_ID}`);

    expect(await screen.findByText(/🔒 Private/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/frontend && npx vitest run src/tests/routes/TraceView.test.tsx -t "Private badge"`
Expected: FAIL — no "🔒 Private" badge rendered.

- [ ] **Step 3: Add the badge**

In `webapp/frontend/src/components/TraceHeader.tsx`, replace the `<h1>` element with the title plus a conditional badge:

```typescript
        <h1 className={styles.title}>
          {trace.pr_title ?? `PR #${trace.pr_number}`}
          {trace.is_private && (
            <span
              style={{
                marginLeft: 8,
                fontSize: "0.7em",
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: 999,
                border: "1px solid var(--border, #ccc)",
                verticalAlign: "middle",
              }}
            >
              🔒 Private
            </span>
          )}
        </h1>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/frontend && npx vitest run src/tests/routes/TraceView.test.tsx`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/components/TraceHeader.tsx webapp/frontend/src/tests/routes/TraceView.test.tsx
git commit -m "Show a Private badge in the trace header"
```

---

## Task 13: "Enable private repositories" in the auth menu

**Files:**
- Modify: `webapp/frontend/src/components/AuthWidget.tsx`
- Test: `webapp/frontend/src/tests/AuthWidget.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `webapp/frontend/src/tests/AuthWidget.test.tsx`, replace the `mockUser` constant with two variants:

```typescript
const mockUser = {
  id: "u-1",
  login: "alice",
  name: "Alice",
  avatar_url: "https://avatars/alice.png",
  has_private_access: false,
};

const mockUserWithPrivate = { ...mockUser, has_private_access: true };
```

Then append these tests inside the `describe("AuthWidget", ...)` block:

```typescript
  it("shows Enable private repositories when the user lacks the scope", () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      loading: false, user: mockUser, refresh: vi.fn(), signOut: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={["/alice/repo"]}>
        <AuthWidget />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /@alice/i }));
    const link = screen.getByRole("link", {
      name: /enable private repositories/i,
    });
    expect(link.getAttribute("href")).toContain("scope=private");
  });

  it("hides Enable private repositories once the user has the scope", () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      loading: false, user: mockUserWithPrivate, refresh: vi.fn(),
      signOut: vi.fn(),
    });

    render(
      <MemoryRouter>
        <AuthWidget />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /@alice/i }));
    expect(
      screen.queryByRole("link", { name: /enable private repositories/i }),
    ).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webapp/frontend && npx vitest run src/tests/AuthWidget.test.tsx`
Expected: the two new tests FAIL — no "Enable private repositories" link exists.

- [ ] **Step 3: Add the menu item**

In `webapp/frontend/src/components/AuthWidget.tsx`, inside the `role="menu"` div, add the link immediately before the existing "Sign out" `<button>`:

```typescript
        <div
          role="menu"
          className="auth-menu"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            background: "var(--surface, white)",
            border: "1px solid var(--border, #ccc)",
            borderRadius: 6,
            padding: 4,
            minWidth: 140,
            zIndex: 10,
          }}
        >
          {!user.has_private_access && (
            <a
              className="iconbtn"
              href={`/api/auth/github/login?scope=private&next=${encodeURIComponent(
                location.pathname + location.search,
              )}`}
              style={{ width: "100%", textAlign: "left", display: "block" }}
            >
              Enable private repositories
            </a>
          )}
          <button
            type="button"
            className="iconbtn"
            onClick={() => signOut()}
            style={{ width: "100%", textAlign: "left" }}
          >
            Sign out
          </button>
        </div>
```

(`location` is already available from the existing `useLocation()` call at the top of the component.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webapp/frontend && npx vitest run src/tests/AuthWidget.test.tsx`
Expected: all tests PASS

- [ ] **Step 5: Run the full frontend suite and type-check**

Run: `cd webapp/frontend && npx vitest run && npx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add webapp/frontend/src/components/AuthWidget.tsx webapp/frontend/src/tests/AuthWidget.test.tsx
git commit -m "Add Enable private repositories action to the auth menu"
```

---

## Task 14: Documentation

**Files:**
- Modify: `webapp/backend/app/auth/oauth.py`
- Modify: `README.md`

- [ ] **Step 1: Update the stale scope comment**

In `webapp/backend/app/auth/oauth.py`, replace the comment above `client_kwargs` with:

```python
        # Default (minimal) scopes for an ordinary login. A `?scope=private`
        # login overrides this per-request with `repo` added — see
        # PRIVATE_SCOPE in app/api/auth.py — so private-repo traces can be
        # access-checked against the viewer's own GitHub permissions.
        client_kwargs={"scope": "read:user user:email"},
```

- [ ] **Step 2: Update the README "How it works" section**

In `README.md`, replace the "How it works" item 6 with items 6 and 7:

```markdown
6. Visiting the URL loads the SPA, which fetches the raw JSONL from the backend and renders it as a single-page trace viewer (hero + collapsible tool cards + activity timeline + light/dark theme).
7. Private-repository traces are gated: the backend checks the signed-in viewer's GitHub access to the repo (via their OAuth token) before serving the trace, mirroring GitHub's own permissions. Viewers grant private access with an opt-in "Enable private repositories" login.
```

- [ ] **Step 3: Verify nothing else references the old restriction**

Run: `cd /Users/bhavya/git/vibeshub && grep -rn "private repos are not supported" --include=*.py --include=*.md`
Expected: no output (the old 403 string is fully gone).

- [ ] **Step 4: Commit**

```bash
git add webapp/backend/app/auth/oauth.py README.md
git commit -m "Document private-repo trace support"
```

---

## Final verification

- [ ] **Run the full backend suite**

Run: `cd webapp/backend && ../../env/bin/pytest -q`
Expected: all PASS

- [ ] **Run the full frontend suite and type-check**

Run: `cd webapp/frontend && npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors

- [ ] **Confirm the migration head**

Run: `cd webapp/backend && ../../env/bin/alembic heads`
Expected: single head `7f3c1a9b2d4e (head)`
