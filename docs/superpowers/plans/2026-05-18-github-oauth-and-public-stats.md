# GitHub OAuth Login + Public GitHub Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Sign in with GitHub" (OAuth) to vibeshub *and* replace the vibeshub-derived stats on the user/repo overview pages with on-the-fly public GitHub stats. Anonymous browsing keeps working unchanged.

**Architecture:** Authlib drives the OAuth code-grant flow; sessions are server-side rows in a new `user_sessions` table referenced by an opaque cookie; OAuth tokens are stored Fernet-encrypted in a new `users` table. A new `PublicGitHubClient` (separate from the existing upload-flow `GitHubClient`) selects between the viewer's OAuth token and a server-side `GITHUB_FALLBACK_TOKEN`, caches responses in-process with ETag + 60s TTL + per-key single-flight, and powers three small stats endpoints the frontend swaps in.

**Tech Stack:** FastAPI + SQLAlchemy 2 (async) + Alembic + Postgres; `authlib` + `cryptography` + Starlette `SessionMiddleware`; React 19 + Vite + React Router 7; pytest + respx + vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-05-18-github-oauth-and-public-stats-design.md`

---

## File map

### Backend — files this plan creates

| Path | Owner |
|---|---|
| `webapp/backend/app/auth/crypto.py` | Tiny Fernet (+ MultiFernet) wrapper. |
| `webapp/backend/app/auth/sessions.py` | Session row CRUD + `get_current_user` / `require_current_user` deps. |
| `webapp/backend/app/auth/oauth.py` | Authlib OAuth client registration. |
| `webapp/backend/app/api/auth.py` | `/api/auth/github/login`, `/api/auth/github/callback`, `/api/auth/logout`, `/api/auth/me`. |
| `webapp/backend/app/github/__init__.py` | Package marker. |
| `webapp/backend/app/github/public_client.py` | `PublicGitHubClient` (token select, ETag+TTL cache, single-flight, LRU cap). |
| `webapp/backend/app/api/github_stats.py` | `/api/github/users/{login}`, `/api/github/users/{login}/repos`, `/api/github/repos/{owner}/{name}`. |
| `webapp/backend/alembic/versions/<rev>_users_and_sessions.py` | Adds `users` + `user_sessions` tables. Down-rev `c4a0e8d51f47`. |
| `webapp/backend/tests/test_auth_crypto.py` | Crypto tests. |
| `webapp/backend/tests/test_auth_oauth.py` | OAuth flow tests with respx. |
| `webapp/backend/tests/test_auth_me.py` | `/api/auth/me` tests. |
| `webapp/backend/tests/test_auth_logout.py` | Logout tests. |
| `webapp/backend/tests/test_public_github_client.py` | Public client tests. |
| `webapp/backend/tests/test_github_stats_endpoints.py` | Stats endpoint tests. |
| `webapp/backend/tests/_auth_helpers.py` | `make_authed_client(...)` helper used by several test files. |

### Backend — files this plan modifies

| Path | Edit |
|---|---|
| `webapp/backend/pyproject.toml` | Add `authlib`, `itsdangerous`, `cryptography` deps. |
| `webapp/backend/app/settings.py` | Add the six new settings. |
| `webapp/backend/app/storage/models.py` | Add `User` and `UserSession` models. |
| `webapp/backend/app/deps.py` | Build `PublicGitHubClient` and attach to `app.state`. |
| `webapp/backend/app/main.py` | Mount `SessionMiddleware`; include new routers. |
| `webapp/backend/tests/conftest.py` | Autouse `auth_env` fixture; export the helper. |
| `deploy/azure/.env.example` | Document the six new env vars. |

### Frontend — files this plan creates

| Path | Owner |
|---|---|
| `webapp/frontend/src/auth/AuthContext.tsx` | Context + provider populated by `fetchMe()`. |
| `webapp/frontend/src/components/AuthWidget.tsx` | Sign-in button / `@login ▾` dropdown. Rendered inside `PageTopbar`. |
| `webapp/frontend/src/tests/AuthWidget.test.tsx` | Component test (vitest + testing-library). |
| `webapp/frontend/e2e/auth.spec.ts` | Playwright smoke test of header state. |

### Frontend — files this plan modifies

| Path | Edit |
|---|---|
| `webapp/frontend/src/api.ts` | Add `fetchMe`, `logout`, `fetchGithubUser`, `fetchGithubUserRepos`, `fetchGithubRepo`. |
| `webapp/frontend/src/types.ts` | Add `MeResponse`, `GithubUser`, `GithubRepo`, `GithubRepoListPage`. |
| `webapp/frontend/src/App.tsx` | Wrap routes in `<AuthProvider>`. |
| `webapp/frontend/src/components/PageTopbar.tsx` | Render `<AuthWidget />`. |
| `webapp/frontend/src/routes/UserPage.tsx` | Fetch + render `GithubUser`; replace stat-strip cells. |
| `webapp/frontend/src/routes/RepoPage.tsx` | Fetch + render `GithubRepo`; replace stat-strip cells. |
| `webapp/frontend/src/tests/api.test.ts` | Cover the new fetchers. |

---

## Test infrastructure note

Backend tests already have:
- `_settings_env` fixture (sets `VIBESHUB_DATABASE_URL`, `BLOB_DIR`, `GITHUB_API_BASE`, `PUBLIC_BASE_URL`).
- `client` fixture (constructs `create_app()` via `TestClient`).
- `respx_mock` fixture.

We extend `_settings_env` (via `auth_env` autouse) with the new vars so every test boots a fully-configured app.

A canonical valid Fernet test key (used in tests only):

```
TEST_FERNET_KEY = "uPL4kPYxOJ-9pTewq6Vg0_LZeQyzrIw0idl_Ld_AQ7E="
```

(Verify in a REPL with `Fernet(TEST_FERNET_KEY.encode())` — should not raise.)

---

## Task A1: Add backend dependencies and new settings

**Files:**
- Modify: `webapp/backend/pyproject.toml`
- Modify: `webapp/backend/app/settings.py`
- Modify: `webapp/backend/tests/conftest.py`

- [ ] **Step 1: Write the failing test for new settings fields**

Add to `webapp/backend/tests/test_settings.py` (create if it doesn't exist):

```python
import os
import pytest


def test_new_auth_settings_load_from_env(monkeypatch):
    monkeypatch.setenv("VIBESHUB_GITHUB_OAUTH_CLIENT_ID", "Iv1.abc")
    monkeypatch.setenv("VIBESHUB_GITHUB_OAUTH_CLIENT_SECRET", "secret")
    monkeypatch.setenv("VIBESHUB_GITHUB_FALLBACK_TOKEN", "ghp_x")
    monkeypatch.setenv("VIBESHUB_SESSION_SECRET", "x" * 32)
    monkeypatch.setenv(
        "VIBESHUB_TOKEN_ENCRYPTION_KEY",
        "uPL4kPYxOJ-9pTewq6Vg0_LZeQyzrIw0idl_Ld_AQ7E=",
    )
    monkeypatch.setenv("VIBESHUB_COOKIE_SECURE", "false")

    from app.settings import Settings

    s = Settings()
    assert s.github_oauth_client_id == "Iv1.abc"
    assert s.github_oauth_client_secret == "secret"
    assert s.github_fallback_token == "ghp_x"
    assert s.session_secret == "x" * 32
    assert s.token_encryption_key.endswith("=")
    assert s.cookie_secure is False


def test_new_auth_settings_default_empty():
    from app.settings import Settings
    s = Settings(_env_file=None)
    assert s.github_oauth_client_id == ""
    assert s.cookie_secure is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && pytest tests/test_settings.py -v`
Expected: FAIL with `AttributeError: 'Settings' object has no attribute 'github_oauth_client_id'`.

- [ ] **Step 3: Add new settings fields**

Edit `webapp/backend/app/settings.py`:

```python
from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VIBESHUB_", env_file=".env")

    database_url: str = Field(default="sqlite+aiosqlite:///:memory:")
    blob_dir: Path = Field(default=Path("/tmp/vibeshub-blobs"))
    azure_storage_account_url: str | None = Field(default=None)
    azure_storage_connection_string: str | None = Field(default=None)
    azure_blob_container: str | None = Field(default=None)
    github_api_base: str = Field(default="https://api.github.com")
    max_trace_bytes: int = Field(default=50 * 1024 * 1024)
    public_base_url: str = Field(default="https://vibeshub.ai")

    # OAuth + sessions + cache config. All default to empty/secure so the app
    # boots for contributors who haven't set up OAuth — auth routes return
    # 503 oauth_not_configured if github_oauth_client_id is empty.
    github_oauth_client_id: str = Field(default="")
    github_oauth_client_secret: str = Field(default="")
    github_fallback_token: str = Field(default="")
    session_secret: str = Field(default="")
    token_encryption_key: str = Field(default="")
    cookie_secure: bool = Field(default=True)


def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 4: Add the deps to pyproject**

Edit `webapp/backend/pyproject.toml` — extend the `dependencies` array (keep existing entries):

```toml
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "sqlalchemy[asyncio]>=2.0",
    "alembic>=1.13",
    "psycopg[binary]>=3.2",
    "pydantic>=2.7",
    "pydantic-settings>=2.4",
    "httpx>=0.27",
    "authlib>=1.3",
    "itsdangerous>=2.2",
    "cryptography>=43",
]
```

Then install:

```bash
cd webapp/backend && pip install -e .
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd webapp/backend && pytest tests/test_settings.py -v`
Expected: PASS, both tests.

- [ ] **Step 6: Add `auth_env` fixture to conftest**

Edit `webapp/backend/tests/conftest.py`:

```python
import pytest
import respx
from fastapi.testclient import TestClient


TEST_FERNET_KEY = "uPL4kPYxOJ-9pTewq6Vg0_LZeQyzrIw0idl_Ld_AQ7E="


@pytest.fixture(autouse=True)
def _settings_env(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBESHUB_DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setenv("VIBESHUB_BLOB_DIR", str(tmp_path / "blobs"))
    monkeypatch.setenv("VIBESHUB_GITHUB_API_BASE", "https://api.github.test")
    monkeypatch.setenv("VIBESHUB_PUBLIC_BASE_URL", "https://vibeshub.test")
    # Auth / OAuth / cache config — fixed test values.
    monkeypatch.setenv("VIBESHUB_GITHUB_OAUTH_CLIENT_ID", "Iv1.test")
    monkeypatch.setenv("VIBESHUB_GITHUB_OAUTH_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("VIBESHUB_GITHUB_FALLBACK_TOKEN", "ghp_fallback")
    monkeypatch.setenv("VIBESHUB_SESSION_SECRET", "x" * 32)
    monkeypatch.setenv("VIBESHUB_TOKEN_ENCRYPTION_KEY", TEST_FERNET_KEY)
    monkeypatch.setenv("VIBESHUB_COOKIE_SECURE", "false")


@pytest.fixture
def client(_settings_env):
    from app.main import create_app
    app = create_app()
    with TestClient(app) as c:
        yield c


@pytest.fixture
def respx_mock():
    with respx.mock(assert_all_called=False) as router:
        yield router
```

Note: `_settings_env` is now `autouse=True` so pre-existing tests that don't explicitly request it still get a clean environment. Previously they relied on the leaked process env. This is intentional — we want every test to know it's seeing the auth-enabled config.

- [ ] **Step 7: Run the full backend suite to confirm nothing regressed**

Run: `cd webapp/backend && pytest -q`
Expected: All existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add webapp/backend/pyproject.toml webapp/backend/app/settings.py \
        webapp/backend/tests/conftest.py webapp/backend/tests/test_settings.py
git commit -m "feat(backend): add OAuth/session/cache settings and deps"
```

---

## Task A2: Crypto wrapper (Fernet + MultiFernet rotation)

**Files:**
- Create: `webapp/backend/app/auth/crypto.py`
- Create: `webapp/backend/tests/test_auth_crypto.py`

- [ ] **Step 1: Write the failing tests**

Create `webapp/backend/tests/test_auth_crypto.py`:

```python
import pytest
from cryptography.fernet import Fernet, InvalidToken

from app.auth.crypto import TokenCipher


def test_round_trip():
    key = Fernet.generate_key().decode()
    cipher = TokenCipher(key)
    plaintext = "gho_abcdef1234567890"
    ct = cipher.encrypt(plaintext)
    assert ct != plaintext
    assert cipher.decrypt(ct) == plaintext


def test_tampered_ciphertext_raises():
    key = Fernet.generate_key().decode()
    cipher = TokenCipher(key)
    ct = cipher.encrypt("hello")
    bad = ct[:-2] + ("AA" if ct[-2:] != "AA" else "BB")
    with pytest.raises(InvalidToken):
        cipher.decrypt(bad)


def test_rotation_decrypts_old_writes_new():
    old_key = Fernet.generate_key().decode()
    new_key = Fernet.generate_key().decode()

    old_only = TokenCipher(old_key)
    rotating = TokenCipher(f"{new_key},{old_key}")

    ct_old = old_only.encrypt("legacy")
    # Rotating cipher can decrypt old ciphertext
    assert rotating.decrypt(ct_old) == "legacy"
    # And writes new ciphertext with the first key
    ct_new = rotating.encrypt("fresh")
    assert TokenCipher(new_key).decrypt(ct_new) == "fresh"


def test_empty_key_raises_at_construction():
    with pytest.raises(ValueError):
        TokenCipher("")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && pytest tests/test_auth_crypto.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.auth.crypto'`.

- [ ] **Step 3: Implement `TokenCipher`**

Create `webapp/backend/app/auth/crypto.py`:

```python
from __future__ import annotations

from cryptography.fernet import Fernet, MultiFernet


class TokenCipher:
    """Fernet-based at-rest encryption for OAuth access tokens.

    Pass a single key for normal use, or a comma-separated list of keys for
    rotation: writes use the first key; reads try keys in order. Each key
    must be a 44-char urlsafe-base64-encoded 32-byte value (the output of
    `cryptography.fernet.Fernet.generate_key()`).
    """

    def __init__(self, key_or_keys: str) -> None:
        if not key_or_keys:
            raise ValueError("token encryption key is required")
        keys = [k.strip() for k in key_or_keys.split(",") if k.strip()]
        if not keys:
            raise ValueError("token encryption key is required")
        fernets = [Fernet(k.encode()) for k in keys]
        self._cipher = MultiFernet(fernets) if len(fernets) > 1 else fernets[0]

    def encrypt(self, plaintext: str) -> str:
        return self._cipher.encrypt(plaintext.encode()).decode()

    def decrypt(self, ciphertext: str) -> str:
        return self._cipher.decrypt(ciphertext.encode()).decode()
```

Also create `webapp/backend/app/auth/__init__.py` if it doesn't already exist (it does — leave it).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webapp/backend && pytest tests/test_auth_crypto.py -v`
Expected: PASS, all four tests.

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/auth/crypto.py webapp/backend/tests/test_auth_crypto.py
git commit -m "feat(backend): Fernet token cipher with rotation"
```

---

## Task A3: `User` + `UserSession` models and migration

**Files:**
- Modify: `webapp/backend/app/storage/models.py`
- Create: `webapp/backend/alembic/versions/a1b2c3d4e5f6_users_and_sessions.py` (rev id will be auto-generated; the example uses `a1b2c3d4e5f6` as a placeholder for the value Alembic returns)
- Add tests to: `webapp/backend/tests/test_storage_db.py` (existing) — append a model smoke test.

- [ ] **Step 1: Write the failing model smoke test**

Append to `webapp/backend/tests/test_storage_db.py`:

```python
@pytest.mark.asyncio
async def test_user_and_session_models_round_trip(tmp_path):
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy import select
    from app.storage.models import Base, User, UserSession
    from datetime import datetime, timedelta, timezone
    import uuid

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    from sqlalchemy.ext.asyncio import async_sessionmaker
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as session:
        u = User(
            github_id=42,
            github_login="alice",
            name="Alice",
            avatar_url="https://avatars/alice.png",
            email=None,
            encrypted_access_token="ct",
            token_scopes="read:user,user:email",
        )
        session.add(u)
        await session.flush()

        s = UserSession(
            id="sess_abc",
            user_id=u.id,
            expires_at=datetime.now(timezone.utc) + timedelta(days=30),
        )
        session.add(s)
        await session.commit()

        loaded = (await session.execute(
            select(UserSession).where(UserSession.id == "sess_abc")
        )).scalar_one()
        assert loaded.user_id == u.id
```

(If `test_storage_db.py` doesn't import `pytest`, prepend `import pytest`. It does — line 1.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && pytest tests/test_storage_db.py::test_user_and_session_models_round_trip -v`
Expected: FAIL with `ImportError: cannot import name 'User' from 'app.storage.models'`.

- [ ] **Step 3: Add the models**

Edit `webapp/backend/app/storage/models.py` — add at end of file:

```python
from sqlalchemy import ForeignKey


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # `github_id` is the immutable identity. github_login can be renamed; we
    # upsert on github_id and refresh github_login on each login.
    github_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    github_login: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Fernet ciphertext of the OAuth access token. Always set on insert.
    encrypted_access_token: Mapped[str] = mapped_column(Text)
    # Comma-separated OAuth scopes the token was issued with. Plaintext.
    token_scopes: Mapped[str] = mapped_column(String(255), default="")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class UserSession(Base):
    __tablename__ = "user_sessions"

    # Opaque session id from `secrets.token_urlsafe(32)` (43 chars). String(64)
    # leaves room for a future `v1.<id>` prefix without another migration.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/backend && pytest tests/test_storage_db.py::test_user_and_session_models_round_trip -v`
Expected: PASS.

- [ ] **Step 5: Generate Alembic migration**

```bash
cd webapp/backend
VIBESHUB_DATABASE_URL=sqlite+aiosqlite:///alembic-temp.db \
  alembic revision --autogenerate -m "users and sessions"
```

Open the generated file under `alembic/versions/`. Confirm:
- `down_revision = 'c4a0e8d51f47'`
- `upgrade()` creates `users` and `user_sessions` with the columns above and the indexes (`github_id` unique, `github_login` unique, `user_sessions.user_id` index, `user_sessions.expires_at` index).
- `downgrade()` drops both tables in reverse order.

Hand-edit if autogenerate missed an index. Delete `alembic-temp.db` afterward.

- [ ] **Step 6: Smoke-test the migration round trip**

```bash
cd webapp/backend
VIBESHUB_DATABASE_URL=sqlite+aiosqlite:///alembic-temp.db alembic upgrade head
VIBESHUB_DATABASE_URL=sqlite+aiosqlite:///alembic-temp.db alembic downgrade base
rm alembic-temp.db
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add webapp/backend/app/storage/models.py \
        webapp/backend/alembic/versions/*_users_and_sessions.py \
        webapp/backend/tests/test_storage_db.py
git commit -m "feat(backend): users and user_sessions tables with migration"
```

---

## Task B1: Server-side session helpers and `get_current_user` dependency

**Files:**
- Create: `webapp/backend/app/auth/sessions.py`
- Create: `webapp/backend/tests/_auth_helpers.py`

This task ships the session machinery without exposing any HTTP route yet. The route tasks consume these helpers.

- [ ] **Step 1: Write the failing test**

Create `webapp/backend/tests/test_auth_sessions.py`:

```python
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.auth.sessions import (
    SESSION_COOKIE_NAME,
    create_session,
    delete_session,
    load_user_by_session,
    new_session_id,
)
from app.storage.models import User, UserSession


@pytest.mark.asyncio
async def test_new_session_id_is_urlsafe_and_long_enough():
    sid = new_session_id()
    assert isinstance(sid, str)
    # token_urlsafe(32) -> 43 chars; never exceeds 64.
    assert 40 <= len(sid) <= 64


@pytest.mark.asyncio
async def test_create_load_delete_session(client):
    # Reach into the app's session maker to set up data directly.
    app = client.app
    SessionLocal = app.state.session_maker

    async with SessionLocal() as session:
        user = User(
            github_id=1,
            github_login="alice",
            encrypted_access_token="ct",
            token_scopes="read:user",
        )
        session.add(user)
        await session.flush()

        sid = await create_session(session, user.id, ttl_days=30)
        await session.commit()

    # Load it back
    async with SessionLocal() as session:
        loaded = await load_user_by_session(session, sid)
        assert loaded is not None
        assert loaded.github_login == "alice"

    # Delete and confirm gone
    async with SessionLocal() as session:
        await delete_session(session, sid)
        await session.commit()
        loaded = await load_user_by_session(session, sid)
        assert loaded is None


@pytest.mark.asyncio
async def test_load_user_by_session_expired_returns_none(client):
    app = client.app
    SessionLocal = app.state.session_maker

    async with SessionLocal() as session:
        user = User(
            github_id=2,
            github_login="bob",
            encrypted_access_token="ct",
        )
        session.add(user)
        await session.flush()

        expired = UserSession(
            id="sess_expired",
            user_id=user.id,
            expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
        )
        session.add(expired)
        await session.commit()

    async with SessionLocal() as session:
        assert await load_user_by_session(session, "sess_expired") is None


@pytest.mark.asyncio
async def test_load_user_slides_expiry_after_throttle_window(client, monkeypatch):
    app = client.app
    SessionLocal = app.state.session_maker

    async with SessionLocal() as session:
        user = User(
            github_id=3,
            github_login="carol",
            encrypted_access_token="ct",
        )
        session.add(user)
        await session.flush()

        old_seen = datetime.now(timezone.utc) - timedelta(minutes=10)
        s = UserSession(
            id="sess_slide",
            user_id=user.id,
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            last_seen_at=old_seen,
        )
        session.add(s)
        await session.commit()

    async with SessionLocal() as session:
        await load_user_by_session(session, "sess_slide")
        await session.commit()

    async with SessionLocal() as session:
        s = (await session.execute(
            select(UserSession).where(UserSession.id == "sess_slide")
        )).scalar_one()
        # expires_at extended to ~30d out
        assert s.expires_at > datetime.now(timezone.utc) + timedelta(days=29)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && pytest tests/test_auth_sessions.py -v`
Expected: FAIL — `ImportError` on `app.auth.sessions`.

- [ ] **Step 3: Implement session helpers**

Create `webapp/backend/app/auth/sessions.py`:

```python
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_session
from app.storage.models import User, UserSession


SESSION_COOKIE_NAME = "vibeshub_session"
DEFAULT_SESSION_TTL_DAYS = 30
LAST_SEEN_THROTTLE = timedelta(minutes=5)


def new_session_id() -> str:
    return secrets.token_urlsafe(32)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def create_session(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    ttl_days: int = DEFAULT_SESSION_TTL_DAYS,
) -> str:
    sid = new_session_id()
    row = UserSession(
        id=sid,
        user_id=user_id,
        expires_at=_utcnow() + timedelta(days=ttl_days),
    )
    session.add(row)
    return sid


async def delete_session(session: AsyncSession, sid: str) -> None:
    await session.execute(delete(UserSession).where(UserSession.id == sid))


async def load_user_by_session(
    session: AsyncSession, sid: str
) -> Optional[User]:
    """Return the User for `sid` if the session exists and is unexpired.

    Side effect: if `last_seen_at` is older than LAST_SEEN_THROTTLE, refresh
    it AND bump `expires_at = now + 30d` (sliding session). The caller is
    responsible for committing.
    """
    row = (await session.execute(
        select(UserSession).where(UserSession.id == sid)
    )).scalar_one_or_none()
    if row is None:
        return None

    now = _utcnow()
    if row.expires_at <= now:
        return None

    if now - row.last_seen_at >= LAST_SEEN_THROTTLE:
        row.last_seen_at = now
        row.expires_at = now + timedelta(days=DEFAULT_SESSION_TTL_DAYS)

    return (await session.execute(
        select(User).where(User.id == row.user_id)
    )).scalar_one_or_none()


async def get_current_user(
    session: AsyncSession = Depends(get_session),
    sid: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> User | None:
    if not sid:
        return None
    user = await load_user_by_session(session, sid)
    # Commit any sliding-window writes from load_user_by_session.
    await session.commit()
    return user


async def require_current_user(
    user: User | None = Depends(get_current_user),
) -> User:
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return user
```

- [ ] **Step 4: Add an auth helper for later tests**

Create `webapp/backend/tests/_auth_helpers.py`:

```python
from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth.crypto import TokenCipher
from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.settings import get_settings
from app.storage.models import User


async def _seed_user(SessionLocal, *, github_id: int, login: str,
                    access_token: str = "gho_test") -> User:
    cipher = TokenCipher(get_settings().token_encryption_key)
    async with SessionLocal() as session:
        user = User(
            github_id=github_id,
            github_login=login,
            name=login.title(),
            avatar_url=f"https://avatars/{login}.png",
            email=None,
            encrypted_access_token=cipher.encrypt(access_token),
            token_scopes="read:user,user:email",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


async def _create_session(SessionLocal, user_id) -> str:
    async with SessionLocal() as session:
        sid = await create_session(session, user_id)
        await session.commit()
        return sid


async def authed_cookies(client: TestClient, *, github_id: int = 100,
                         login: str = "alice", access_token: str = "gho_user"):
    """Seed a User + UserSession and return a cookies dict for TestClient."""
    SessionLocal = client.app.state.session_maker
    user = await _seed_user(
        SessionLocal, github_id=github_id, login=login,
        access_token=access_token,
    )
    sid = await _create_session(SessionLocal, user.id)
    return {SESSION_COOKIE_NAME: sid}, user
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd webapp/backend && pytest tests/test_auth_sessions.py -v`
Expected: PASS, all four tests.

- [ ] **Step 6: Commit**

```bash
git add webapp/backend/app/auth/sessions.py \
        webapp/backend/tests/test_auth_sessions.py \
        webapp/backend/tests/_auth_helpers.py
git commit -m "feat(backend): server-side session helpers and current-user dep"
```

---

## Task C1: OAuth client setup, SessionMiddleware, and `/api/auth/me`

This task ships the smallest end-to-end visible auth piece — the `/api/auth/me` endpoint — together with the boilerplate it needs (Authlib registration, SessionMiddleware). The actual `login` and `callback` routes come in C2.

**Files:**
- Create: `webapp/backend/app/auth/oauth.py`
- Create: `webapp/backend/app/api/auth.py`
- Modify: `webapp/backend/app/main.py`
- Create: `webapp/backend/tests/test_auth_me.py`

- [ ] **Step 1: Write the failing tests**

Create `webapp/backend/tests/test_auth_me.py`:

```python
import asyncio

import pytest

from app.auth.sessions import SESSION_COOKIE_NAME
from tests._auth_helpers import authed_cookies


def test_me_anonymous_returns_204(client):
    r = client.get("/api/auth/me")
    assert r.status_code == 204
    assert r.content == b""


def test_me_authenticated_returns_user_fields(client):
    cookies, user = asyncio.get_event_loop().run_until_complete(
        authed_cookies(client, login="alice", github_id=7)
    )
    r = client.get("/api/auth/me", cookies=cookies)
    assert r.status_code == 200
    body = r.json()
    assert body["login"] == "alice"
    assert body["name"] == "Alice"
    assert body["avatar_url"].endswith("alice.png")
    assert "id" in body


def test_me_unknown_session_returns_204_and_clears_cookie(client):
    r = client.get("/api/auth/me", cookies={SESSION_COOKIE_NAME: "no_such_sid"})
    assert r.status_code == 204
    # Set-Cookie header clears the cookie
    set_cookie = r.headers.get("set-cookie", "")
    assert SESSION_COOKIE_NAME in set_cookie
    assert "Max-Age=0" in set_cookie or 'max-age=0' in set_cookie.lower()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webapp/backend && pytest tests/test_auth_me.py -v`
Expected: FAIL — 404 on `/api/auth/me`.

- [ ] **Step 3: Implement Authlib registration**

Create `webapp/backend/app/auth/oauth.py`:

```python
from __future__ import annotations

from authlib.integrations.starlette_client import OAuth

from app.settings import Settings


def build_oauth(settings: Settings) -> OAuth:
    """Build a fresh Authlib OAuth registry from settings.

    Called at app start; not a module-global so tests get a clean instance
    per app build.
    """
    oauth = OAuth()
    oauth.register(
        name="github",
        client_id=settings.github_oauth_client_id,
        client_secret=settings.github_oauth_client_secret,
        access_token_url="https://github.com/login/oauth/access_token",
        authorize_url="https://github.com/login/oauth/authorize",
        api_base_url="https://api.github.com/",
        # Public-read-only scopes. Do NOT add `repo` (private repos) or
        # `public_repo` (write to public repos) here — broader scopes will
        # be added in a follow-up PR when private-repo fidelity is needed.
        client_kwargs={"scope": "read:user user:email"},
    )
    return oauth
```

- [ ] **Step 4: Implement `/api/auth/me`**

Create `webapp/backend/app/api/auth.py`:

```python
from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from app.auth.sessions import (
    SESSION_COOKIE_NAME,
    get_current_user,
)
from app.storage.models import User


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/me")
async def me(
    response: Response,
    user: User | None = Depends(get_current_user),
):
    if user is None:
        # Clear any stale cookie a misbehaving client may still be sending.
        response.delete_cookie(SESSION_COOKIE_NAME, path="/")
        response.status_code = 204
        return None
    return {
        "id": str(user.id),
        "login": user.github_login,
        "name": user.name,
        "avatar_url": user.avatar_url,
    }
```

- [ ] **Step 5: Wire middleware + router into the app**

Edit `webapp/backend/app/main.py` — replace the file with:

```python
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.api import (
    auth as auth_api,
    health,
    ingest as ingest_api,
    traces as traces_api,
)
from app.deps import init_state
from app.settings import get_settings


_PLACEHOLDER_HTML = """<!doctype html>
<html><head><title>vibeshub</title></head>
<body>
<h1>vibeshub</h1>
<p>Frontend build not present. Run <code>npm run build</code> in
<code>webapp/frontend</code> to populate <code>dist/</code>, then redeploy.</p>
</body></html>"""


_frontend_dist_override: Path | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_state(app)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="vibeshub", version="0.1.0", lifespan=lifespan)

    # SessionMiddleware drives Authlib's `state` storage during the OAuth
    # dance. Its cookie ("oauth_state") is distinct from our app session
    # cookie ("vibeshub_session"); short-lived (10 min).
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret or "dev-placeholder-secret-not-for-prod",
        session_cookie="oauth_state",
        same_site="lax",
        https_only=settings.cookie_secure,
        max_age=600,
    )

    app.include_router(health.router)
    app.include_router(ingest_api.router)
    app.include_router(traces_api.router)
    app.include_router(auth_api.router)

    frontend_dist = _frontend_dist_override or (
        Path(__file__).resolve().parent.parent / "frontend_dist"
    )
    if (frontend_dist / "index.html").is_file():
        if (frontend_dist / "assets").is_dir():
            app.mount(
                "/assets",
                StaticFiles(directory=frontend_dist / "assets"),
                name="spa-assets",
            )
        index_html = (frontend_dist / "index.html").read_text()

        @app.get("/{full_path:path}", response_class=HTMLResponse)
        async def _spa(full_path: str) -> str:
            return index_html
    else:
        @app.get("/", response_class=HTMLResponse)
        async def _root() -> str:
            return _PLACEHOLDER_HTML

    return app


app = create_app()
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd webapp/backend && pytest tests/test_auth_me.py -v`
Expected: PASS, all three tests.

- [ ] **Step 7: Run the full backend suite**

Run: `cd webapp/backend && pytest -q`
Expected: All tests pass — existing tests should not have regressed.

- [ ] **Step 8: Commit**

```bash
git add webapp/backend/app/auth/oauth.py webapp/backend/app/api/auth.py \
        webapp/backend/app/main.py webapp/backend/tests/test_auth_me.py
git commit -m "feat(backend): /api/auth/me with session middleware wired"
```

---

## Task C2: `/api/auth/github/login` + `/api/auth/github/callback`

**Files:**
- Modify: `webapp/backend/app/api/auth.py`
- Modify: `webapp/backend/app/deps.py`
- Create: `webapp/backend/tests/test_auth_oauth.py`

- [ ] **Step 1: Write the failing tests**

Create `webapp/backend/tests/test_auth_oauth.py`:

```python
import asyncio
from urllib.parse import parse_qs, urlparse

import pytest
import respx
from sqlalchemy import select

from app.auth.crypto import TokenCipher
from app.auth.sessions import SESSION_COOKIE_NAME
from app.settings import get_settings
from app.storage.models import User, UserSession


def test_login_redirects_to_github_with_correct_scope(client):
    r = client.get("/api/auth/github/login", follow_redirects=False)
    assert r.status_code == 302
    loc = r.headers["location"]
    parsed = urlparse(loc)
    assert parsed.netloc == "github.com"
    qs = parse_qs(parsed.query)
    assert qs["client_id"] == ["Iv1.test"]
    assert qs["scope"] == ["read:user user:email"]
    assert "state" in qs


def test_login_rejects_open_redirect_next(client):
    """An off-host `next` must be ignored — only same-origin paths are honored."""
    for bad in ("https://evil.com/x", "//evil.com/x", "javascript:alert(1)"):
        r = client.get(
            f"/api/auth/github/login?next={bad}", follow_redirects=False
        )
        # We still redirect to GitHub; the bad `next` is just silently dropped
        # and replaced with "/" in the Starlette session.
        assert r.status_code == 302
        assert urlparse(r.headers["location"]).netloc == "github.com"


def test_callback_user_denied_redirects_with_error(client):
    # No code, with ?error param — GitHub user clicked "Cancel".
    r = client.get(
        "/api/auth/github/callback?error=access_denied",
        follow_redirects=False,
    )
    assert r.status_code == 303
    assert r.headers["location"] == "/?auth_error=denied"


def test_callback_state_mismatch_redirects_with_error(client):
    # No prior /login → there's no state in the session — Authlib will reject.
    r = client.get(
        "/api/auth/github/callback?code=somecode&state=forged_state",
        follow_redirects=False,
    )
    assert r.status_code == 303
    assert r.headers["location"] == "/?auth_error=state_mismatch"


@pytest.mark.asyncio
async def test_callback_success_creates_user_and_session(
    client, respx_mock: respx.MockRouter
):
    # Drive a full happy path. Steps:
    # 1) Hit /login to seed the Starlette state cookie.
    # 2) Mock GitHub's token-exchange + /user + /user/emails endpoints.
    # 3) Hit /callback with the seeded state + a code.
    # 4) Verify DB rows + 303 to "/".

    # 1) Seed state
    r = client.get("/api/auth/github/login", follow_redirects=False)
    state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]

    # 2) Mock GitHub
    respx_mock.post("https://github.com/login/oauth/access_token").respond(
        200,
        json={
            "access_token": "gho_real",
            "scope": "read:user,user:email",
            "token_type": "bearer",
        },
    )
    respx_mock.get("https://api.github.com/user").respond(
        200,
        json={
            "id": 4242,
            "login": "octocat",
            "name": "The Octocat",
            "avatar_url": "https://avatars.githubusercontent.com/u/4242?v=4",
        },
    )
    respx_mock.get("https://api.github.com/user/emails").respond(
        200,
        json=[
            {"email": "octocat@example.com", "primary": True, "verified": True}
        ],
    )

    # 3) Callback
    r = client.get(
        f"/api/auth/github/callback?code=goodcode&state={state}",
        follow_redirects=False,
    )
    assert r.status_code == 303
    assert r.headers["location"] == "/"
    set_cookie = r.headers["set-cookie"]
    assert SESSION_COOKIE_NAME in set_cookie
    assert "HttpOnly" in set_cookie
    assert "SameSite=lax" in set_cookie or "SameSite=Lax" in set_cookie

    # 4) DB rows
    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        user = (await session.execute(
            select(User).where(User.github_id == 4242)
        )).scalar_one()
        assert user.github_login == "octocat"
        assert user.email == "octocat@example.com"
        assert "read:user" in user.token_scopes
        cipher = TokenCipher(get_settings().token_encryption_key)
        assert cipher.decrypt(user.encrypted_access_token) == "gho_real"

        sessions = (await session.execute(
            select(UserSession).where(UserSession.user_id == user.id)
        )).scalars().all()
        assert len(sessions) == 1


@pytest.mark.asyncio
async def test_callback_github_token_exchange_failure(
    client, respx_mock: respx.MockRouter
):
    r = client.get("/api/auth/github/login", follow_redirects=False)
    state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]

    respx_mock.post("https://github.com/login/oauth/access_token").respond(500)

    r = client.get(
        f"/api/auth/github/callback?code=bad&state={state}",
        follow_redirects=False,
    )
    assert r.status_code == 303
    assert r.headers["location"] == "/?auth_error=github_error"

    # No DB rows written
    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        users = (await session.execute(select(User))).scalars().all()
        assert users == []


@pytest.mark.asyncio
async def test_repeat_login_upserts_same_github_id(
    client, respx_mock: respx.MockRouter
):
    # First login: github_id=42, login=alice
    r = client.get("/api/auth/github/login", follow_redirects=False)
    state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]
    respx_mock.post("https://github.com/login/oauth/access_token").respond(
        200, json={"access_token": "t1", "scope": "read:user,user:email"}
    )
    respx_mock.get("https://api.github.com/user").respond(
        200, json={"id": 42, "login": "alice", "name": "Alice", "avatar_url": ""}
    )
    respx_mock.get("https://api.github.com/user/emails").respond(200, json=[])
    client.get(
        f"/api/auth/github/callback?code=c1&state={state}", follow_redirects=False
    )

    # Second login: same github_id=42 but renamed to "alice_new"
    respx_mock.reset()
    r = client.get("/api/auth/github/login", follow_redirects=False)
    state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]
    respx_mock.post("https://github.com/login/oauth/access_token").respond(
        200, json={"access_token": "t2", "scope": "read:user,user:email"}
    )
    respx_mock.get("https://api.github.com/user").respond(
        200,
        json={
            "id": 42, "login": "alice_new", "name": "Alice New", "avatar_url": ""
        },
    )
    respx_mock.get("https://api.github.com/user/emails").respond(200, json=[])
    client.get(
        f"/api/auth/github/callback?code=c2&state={state}", follow_redirects=False
    )

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        users = (await session.execute(select(User))).scalars().all()
        assert len(users) == 1
        assert users[0].github_login == "alice_new"
        cipher = TokenCipher(get_settings().token_encryption_key)
        assert cipher.decrypt(users[0].encrypted_access_token) == "t2"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webapp/backend && pytest tests/test_auth_oauth.py -v`
Expected: FAIL — 404 on the new routes.

- [ ] **Step 3: Wire OAuth instance into app.state**

Edit `webapp/backend/app/deps.py` — extend `init_state`:

```python
from app.auth.oauth import build_oauth
```

Inside `init_state`, after the existing `app.state.github = GitHubClient(...)` line, add:

```python
    app.state.oauth = build_oauth(settings)
```

- [ ] **Step 4: Implement the routes**

Edit `webapp/backend/app/api/auth.py` — replace the file with:

```python
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.crypto import TokenCipher
from app.auth.sessions import (
    DEFAULT_SESSION_TTL_DAYS,
    SESSION_COOKIE_NAME,
    create_session,
    get_current_user,
)
from app.deps import get_app_settings, get_session
from app.settings import Settings
from app.storage.models import User


log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


# --- helpers ----------------------------------------------------------------


def _validated_next(next_value: str | None) -> str:
    """Accept only same-origin paths. Anything else falls back to '/'."""
    if not next_value:
        return "/"
    if not next_value.startswith("/") or next_value.startswith("//"):
        return "/"
    parsed = urlparse(next_value)
    if parsed.scheme or parsed.netloc:
        return "/"
    return next_value


def _require_oauth_configured(settings: Settings) -> None:
    if not settings.github_oauth_client_id or not settings.session_secret:
        raise HTTPException(status_code=503, detail="oauth_not_configured")


def _set_session_cookie(response: Response, sid: str, *, secure: bool) -> None:
    response.set_cookie(
        SESSION_COOKIE_NAME,
        sid,
        max_age=DEFAULT_SESSION_TTL_DAYS * 24 * 60 * 60,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )


# --- routes -----------------------------------------------------------------


@router.get("/me")
async def me(
    response: Response,
    user: User | None = Depends(get_current_user),
):
    if user is None:
        response.delete_cookie(SESSION_COOKIE_NAME, path="/")
        response.status_code = 204
        return None
    return {
        "id": str(user.id),
        "login": user.github_login,
        "name": user.name,
        "avatar_url": user.avatar_url,
    }


@router.get("/github/login")
async def github_login(
    request: Request,
    next: str | None = None,
    settings: Settings = Depends(get_app_settings),
):
    _require_oauth_configured(settings)
    request.session["next_path"] = _validated_next(next)
    oauth = request.app.state.oauth
    redirect_uri = settings.public_base_url.rstrip("/") + "/api/auth/github/callback"
    log.info("auth.login.start")
    return await oauth.github.authorize_redirect(request, redirect_uri)


@router.get("/github/callback")
async def github_callback(
    request: Request,
    settings: Settings = Depends(get_app_settings),
    session: AsyncSession = Depends(get_session),
):
    _require_oauth_configured(settings)
    next_path = _validated_next(request.session.pop("next_path", "/"))

    # User clicked "Cancel" on GitHub's consent screen.
    if request.query_params.get("error"):
        log.info("auth.login.failure reason=user_denied")
        return RedirectResponse(url="/?auth_error=denied", status_code=303)

    oauth = request.app.state.oauth
    try:
        token = await oauth.github.authorize_access_token(request)
    except Exception as exc:
        # Authlib raises `MismatchingStateError` for state mismatch and
        # `OAuthError` for token-exchange / network failures.
        reason = type(exc).__name__
        if "state" in reason.lower():
            log.info("auth.login.failure reason=state_mismatch")
            return RedirectResponse(
                url="/?auth_error=state_mismatch", status_code=303
            )
        log.warning("auth.login.failure reason=github_error err=%s", reason)
        return RedirectResponse(url="/?auth_error=github_error", status_code=303)

    access_token = token.get("access_token")
    scopes_str = token.get("scope") or ""

    # Fetch profile + (optionally) emails.
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    api_base = settings.github_api_base.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
            user_resp = await http.get(f"{api_base}/user", headers=headers)
            user_resp.raise_for_status()
            profile = user_resp.json()
            emails: list[dict[str, Any]] = []
            try:
                emails_resp = await http.get(
                    f"{api_base}/user/emails", headers=headers
                )
                if emails_resp.status_code == 200:
                    emails = emails_resp.json()
            except httpx.HTTPError:
                emails = []
    except httpx.HTTPError as exc:
        log.warning("auth.login.failure reason=profile_fetch err=%s", exc)
        return RedirectResponse(url="/?auth_error=github_error", status_code=303)

    primary_email = next(
        (e["email"] for e in emails if e.get("primary") and e.get("verified")),
        None,
    )

    # Upsert user.
    cipher = TokenCipher(settings.token_encryption_key)
    existing = (await session.execute(
        select(User).where(User.github_id == profile["id"])
    )).scalar_one_or_none()
    if existing is None:
        existing = User(
            github_id=profile["id"],
            github_login=profile["login"],
            name=profile.get("name"),
            avatar_url=profile.get("avatar_url"),
            email=primary_email,
            encrypted_access_token=cipher.encrypt(access_token),
            token_scopes=scopes_str,
        )
        session.add(existing)
    else:
        existing.github_login = profile["login"]
        existing.name = profile.get("name")
        existing.avatar_url = profile.get("avatar_url")
        existing.email = primary_email
        existing.encrypted_access_token = cipher.encrypt(access_token)
        existing.token_scopes = scopes_str

    await session.flush()

    sid = await create_session(session, existing.id)
    await session.commit()

    response = RedirectResponse(url=next_path, status_code=303)
    _set_session_cookie(response, sid, secure=settings.cookie_secure)
    log.info(
        "auth.login.success github_id=%s login=%s",
        profile["id"], profile["login"],
    )
    return response
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd webapp/backend && pytest tests/test_auth_oauth.py -v`
Expected: PASS, all seven tests.

- [ ] **Step 6: Commit**

```bash
git add webapp/backend/app/api/auth.py webapp/backend/app/deps.py \
        webapp/backend/tests/test_auth_oauth.py
git commit -m "feat(backend): GitHub OAuth login + callback"
```

---

## Task C3: `/api/auth/logout`

**Files:**
- Modify: `webapp/backend/app/api/auth.py`
- Create: `webapp/backend/tests/test_auth_logout.py`

- [ ] **Step 1: Write the failing tests**

Create `webapp/backend/tests/test_auth_logout.py`:

```python
import asyncio

import pytest
from sqlalchemy import select

from app.auth.sessions import SESSION_COOKIE_NAME
from app.storage.models import UserSession
from tests._auth_helpers import authed_cookies


def test_logout_get_returns_405(client):
    r = client.get("/api/auth/logout")
    assert r.status_code == 405


def test_logout_anonymous_returns_204(client):
    r = client.post("/api/auth/logout")
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_logout_deletes_session_and_clears_cookie(client):
    cookies, user = await authed_cookies(client, login="alice", github_id=11)
    sid = cookies[SESSION_COOKIE_NAME]

    r = client.post("/api/auth/logout", cookies=cookies)
    assert r.status_code == 204

    set_cookie = r.headers.get("set-cookie", "")
    assert SESSION_COOKIE_NAME in set_cookie
    assert "Max-Age=0" in set_cookie or "max-age=0" in set_cookie.lower()

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        rows = (await session.execute(
            select(UserSession).where(UserSession.id == sid)
        )).scalars().all()
        assert rows == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webapp/backend && pytest tests/test_auth_logout.py -v`
Expected: FAIL — 405 actually expected on GET (will pass that one), but 404 on POST.

- [ ] **Step 3: Implement logout**

Add to `webapp/backend/app/api/auth.py` (append before the file's end):

```python
from app.auth.sessions import delete_session


@router.post("/logout", status_code=204)
async def logout(
    response: Response,
    sid: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    session: AsyncSession = Depends(get_session),
):
    if sid:
        await delete_session(session, sid)
        await session.commit()
        log.info("auth.logout")
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webapp/backend && pytest tests/test_auth_logout.py -v`
Expected: PASS, all three tests.

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/api/auth.py webapp/backend/tests/test_auth_logout.py
git commit -m "feat(backend): POST /api/auth/logout"
```

---

## Task D1: `PublicGitHubClient` with ETag + TTL + single-flight + LRU

**Files:**
- Create: `webapp/backend/app/github/__init__.py`
- Create: `webapp/backend/app/github/public_client.py`
- Create: `webapp/backend/tests/test_public_github_client.py`

- [ ] **Step 1: Write the failing tests**

Create `webapp/backend/tests/test_public_github_client.py`:

```python
import asyncio

import httpx
import pytest
import respx

from app.github.public_client import (
    GitHubAuthError,
    GitHubNotFound,
    GitHubRateLimited,
    GitHubUpstreamError,
    PublicGitHubClient,
)


API = "https://api.github.test"


@pytest.mark.asyncio
async def test_uses_viewer_token_when_present(respx_mock: respx.MockRouter):
    route = respx_mock.get(f"{API}/users/octo").respond(
        200, json={"login": "octo"},
        headers={"ETag": '"e1"'},
    )
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=60)
    await c.get_json("/users/octo", viewer_token="gho_user")
    assert route.calls[0].request.headers["authorization"] == "Bearer gho_user"


@pytest.mark.asyncio
async def test_falls_back_to_pat_when_viewer_token_none(
    respx_mock: respx.MockRouter,
):
    route = respx_mock.get(f"{API}/users/octo").respond(
        200, json={"login": "octo"}
    )
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=60)
    await c.get_json("/users/octo", viewer_token=None)
    assert route.calls[0].request.headers["authorization"] == "Bearer fb"


@pytest.mark.asyncio
async def test_raises_when_no_tokens_configured():
    c = PublicGitHubClient(API, fallback_token="", ttl_seconds=60)
    with pytest.raises(GitHubAuthError):
        await c.get_json("/users/octo", viewer_token=None)


@pytest.mark.asyncio
async def test_cache_hit_within_ttl_skips_network(respx_mock: respx.MockRouter):
    route = respx_mock.get(f"{API}/users/octo").respond(
        200, json={"login": "octo"}, headers={"ETag": '"e1"'}
    )
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=60)
    for _ in range(5):
        body = await c.get_json("/users/octo", viewer_token=None)
        assert body == {"login": "octo"}
    assert route.call_count == 1


@pytest.mark.asyncio
async def test_stale_revalidates_with_etag_returns_304(
    respx_mock: respx.MockRouter,
):
    respx_mock.get(f"{API}/users/octo").mock(side_effect=[
        httpx.Response(200, json={"login": "octo"}, headers={"ETag": '"e1"'}),
        httpx.Response(304),
    ])
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=0)
    body1 = await c.get_json("/users/octo", viewer_token=None)
    body2 = await c.get_json("/users/octo", viewer_token=None)
    assert body1 == body2 == {"login": "octo"}
    # The second call sent If-None-Match
    second = respx_mock.calls[1].request
    assert second.headers["if-none-match"] == '"e1"'


@pytest.mark.asyncio
async def test_stale_revalidates_with_etag_returns_200(
    respx_mock: respx.MockRouter,
):
    respx_mock.get(f"{API}/users/octo").mock(side_effect=[
        httpx.Response(200, json={"login": "v1"}, headers={"ETag": '"e1"'}),
        httpx.Response(200, json={"login": "v2"}, headers={"ETag": '"e2"'}),
    ])
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=0)
    await c.get_json("/users/octo", viewer_token=None)
    body2 = await c.get_json("/users/octo", viewer_token=None)
    assert body2 == {"login": "v2"}


@pytest.mark.asyncio
async def test_single_flight_under_concurrency(respx_mock: respx.MockRouter):
    started = asyncio.Event()
    proceed = asyncio.Event()

    async def slow_handler(request):
        started.set()
        await proceed.wait()
        return httpx.Response(200, json={"login": "octo"}, headers={"ETag": '"e"'})

    respx_mock.get(f"{API}/users/octo").mock(side_effect=slow_handler)

    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=60)
    tasks = [
        asyncio.create_task(c.get_json("/users/octo", viewer_token=None))
        for _ in range(10)
    ]
    await started.wait()
    proceed.set()
    results = await asyncio.gather(*tasks)
    assert all(r == {"login": "octo"} for r in results)
    assert respx_mock.calls.call_count == 1


@pytest.mark.asyncio
async def test_404_raises_not_found_and_is_not_cached(
    respx_mock: respx.MockRouter,
):
    route = respx_mock.get(f"{API}/users/missing").respond(404)
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=60)
    with pytest.raises(GitHubNotFound):
        await c.get_json("/users/missing", viewer_token=None)
    with pytest.raises(GitHubNotFound):
        await c.get_json("/users/missing", viewer_token=None)
    assert route.call_count == 2


@pytest.mark.asyncio
async def test_401_raises_auth_error_and_is_not_cached(
    respx_mock: respx.MockRouter,
):
    route = respx_mock.get(f"{API}/users/missing").respond(401)
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=60)
    with pytest.raises(GitHubAuthError):
        await c.get_json("/users/missing", viewer_token=None)
    assert route.call_count == 1


@pytest.mark.asyncio
async def test_403_rate_limited_raises_typed_error(respx_mock: respx.MockRouter):
    respx_mock.get(f"{API}/users/x").respond(
        403,
        headers={
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": "1735689600",
        },
        json={"message": "rate limit"},
    )
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=60)
    with pytest.raises(GitHubRateLimited) as ei:
        await c.get_json("/users/x", viewer_token=None)
    assert ei.value.reset_at_epoch == 1735689600


@pytest.mark.asyncio
async def test_403_without_rate_limit_header_is_upstream_error(
    respx_mock: respx.MockRouter,
):
    respx_mock.get(f"{API}/users/x").respond(403, json={"message": "abuse"})
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=60)
    with pytest.raises(GitHubUpstreamError):
        await c.get_json("/users/x", viewer_token=None)


@pytest.mark.asyncio
async def test_5xx_raises_upstream_error_and_is_not_cached(
    respx_mock: respx.MockRouter,
):
    route = respx_mock.get(f"{API}/users/x").respond(503)
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=60)
    with pytest.raises(GitHubUpstreamError):
        await c.get_json("/users/x", viewer_token=None)
    with pytest.raises(GitHubUpstreamError):
        await c.get_json("/users/x", viewer_token=None)
    assert route.call_count == 2


@pytest.mark.asyncio
async def test_lru_eviction_at_cap(respx_mock: respx.MockRouter):
    respx_mock.get(url__regex=rf"{API}/users/.*").respond(
        200, json={"ok": True}, headers={"ETag": '"e"'}
    )
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=60, max_entries=3)
    await c.get_json("/users/a", viewer_token=None)
    await c.get_json("/users/b", viewer_token=None)
    await c.get_json("/users/c", viewer_token=None)
    await c.get_json("/users/d", viewer_token=None)  # evicts /users/a
    assert c.cache_size() == 3
    # Touching `a` again should be a fresh network call (its cache entry was evicted).
    n_before = respx_mock.calls.call_count
    await c.get_json("/users/a", viewer_token=None)
    assert respx_mock.calls.call_count == n_before + 1


@pytest.mark.asyncio
async def test_returns_link_header_when_requested(respx_mock: respx.MockRouter):
    respx_mock.get(f"{API}/users/x/repos").respond(
        200,
        json=[{"name": "r1"}],
        headers={
            "Link": '<https://api.github.test/users/x/repos?page=2>; rel="next"'
        },
    )
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=60)
    body, link = await c.get_json_with_link(
        "/users/x/repos", viewer_token=None
    )
    assert body == [{"name": "r1"}]
    assert link is not None and "rel=\"next\"" in link
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webapp/backend && pytest tests/test_public_github_client.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.github'`.

- [ ] **Step 3: Create package and implement client**

Create `webapp/backend/app/github/__init__.py`:

```python
```

(Empty file; namespace marker.)

Create `webapp/backend/app/github/public_client.py`:

```python
from __future__ import annotations

import asyncio
import logging
from collections import OrderedDict
from dataclasses import dataclass
from time import monotonic
from typing import Any, FrozenSet, Optional, Tuple

import httpx


log = logging.getLogger(__name__)


class GitHubAuthError(Exception):
    """No token configured, or upstream returned 401."""


class GitHubNotFound(Exception):
    pass


class GitHubRateLimited(Exception):
    def __init__(self, *, reset_at_epoch: int):
        super().__init__("rate limited")
        self.reset_at_epoch = reset_at_epoch


class GitHubUpstreamError(Exception):
    def __init__(self, status: int, body: str = ""):
        super().__init__(f"upstream {status}")
        self.status = status
        self.body = body


CacheKey = Tuple[str, FrozenSet[Tuple[str, str]]]


@dataclass
class _Entry:
    etag: Optional[str]
    payload: Any
    expires_at: float  # monotonic seconds
    link: Optional[str]


class PublicGitHubClient:
    def __init__(
        self,
        api_base: str,
        *,
        fallback_token: str,
        ttl_seconds: int = 60,
        max_entries: int = 512,
        timeout: float = 10.0,
    ) -> None:
        self._api_base = api_base.rstrip("/")
        self._fallback_token = fallback_token
        self._ttl = ttl_seconds
        self._max_entries = max_entries
        self._timeout = timeout
        self._cache: OrderedDict[CacheKey, _Entry] = OrderedDict()
        self._locks: dict[CacheKey, asyncio.Lock] = {}

    def cache_size(self) -> int:
        return len(self._cache)

    async def get_json(
        self,
        path: str,
        *,
        viewer_token: str | None,
        params: dict | None = None,
    ) -> Any:
        body, _ = await self._get(path, viewer_token=viewer_token, params=params)
        return body

    async def get_json_with_link(
        self,
        path: str,
        *,
        viewer_token: str | None,
        params: dict | None = None,
    ) -> tuple[Any, Optional[str]]:
        return await self._get(path, viewer_token=viewer_token, params=params)

    # --- internals --------------------------------------------------------

    def _key(self, path: str, params: dict | None) -> CacheKey:
        items = frozenset((k, str(v)) for k, v in (params or {}).items())
        return (path, items)

    def _select_token(self, viewer_token: str | None) -> str:
        token = viewer_token or self._fallback_token
        if not token:
            raise GitHubAuthError("no token configured")
        return token

    async def _get(
        self,
        path: str,
        *,
        viewer_token: str | None,
        params: dict | None,
    ) -> tuple[Any, Optional[str]]:
        token = self._select_token(viewer_token)
        key = self._key(path, params)
        now = monotonic()

        cached = self._cache.get(key)
        if cached is not None and cached.expires_at > now:
            self._cache.move_to_end(key)
            log.info(
                "github.public_client path=%s cache_state=hit source=cache", path
            )
            return cached.payload, cached.link

        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            # Recheck after acquiring (someone else may have refreshed).
            cached = self._cache.get(key)
            now = monotonic()
            if cached is not None and cached.expires_at > now:
                self._cache.move_to_end(key)
                log.info(
                    "github.public_client path=%s cache_state=hit source=cache",
                    path,
                )
                return cached.payload, cached.link

            cache_state = "stale" if cached else "miss"
            log.info(
                "github.public_client path=%s cache_state=%s source=network",
                path, cache_state,
            )

            headers = {
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }
            if cached and cached.etag:
                headers["If-None-Match"] = cached.etag

            try:
                async with httpx.AsyncClient(timeout=self._timeout) as http:
                    resp = await http.get(
                        f"{self._api_base}{path}",
                        params=params,
                        headers=headers,
                    )
            except httpx.HTTPError as exc:
                raise GitHubUpstreamError(0, str(exc)) from exc

            if resp.status_code == 304 and cached is not None:
                cached.expires_at = monotonic() + self._ttl
                self._cache.move_to_end(key)
                return cached.payload, cached.link

            if resp.status_code == 200:
                payload = resp.json()
                entry = _Entry(
                    etag=resp.headers.get("ETag"),
                    payload=payload,
                    expires_at=monotonic() + self._ttl,
                    link=resp.headers.get("Link"),
                )
                self._cache[key] = entry
                self._cache.move_to_end(key)
                while len(self._cache) > self._max_entries:
                    self._cache.popitem(last=False)
                return payload, entry.link

            if resp.status_code == 401:
                raise GitHubAuthError("upstream 401")
            if resp.status_code == 404:
                raise GitHubNotFound(path)
            if resp.status_code == 403 and resp.headers.get(
                "X-RateLimit-Remaining"
            ) == "0":
                reset = int(resp.headers.get("X-RateLimit-Reset", "0"))
                raise GitHubRateLimited(reset_at_epoch=reset)
            raise GitHubUpstreamError(resp.status_code, resp.text)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webapp/backend && pytest tests/test_public_github_client.py -v`
Expected: PASS, all thirteen tests.

- [ ] **Step 5: Wire client into app.state**

Edit `webapp/backend/app/deps.py` — after the `app.state.oauth = build_oauth(settings)` line, add:

```python
from app.github.public_client import PublicGitHubClient
```

and inside `init_state`:

```python
    app.state.public_github = PublicGitHubClient(
        settings.github_api_base,
        fallback_token=settings.github_fallback_token,
        ttl_seconds=60,
    )
```

Also add a dependency helper at the end of the file:

```python
def get_public_github(request: Request) -> PublicGitHubClient:
    return request.app.state.public_github
```

- [ ] **Step 6: Run the full backend suite**

Run: `cd webapp/backend && pytest -q`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add webapp/backend/app/github/__init__.py \
        webapp/backend/app/github/public_client.py \
        webapp/backend/app/deps.py \
        webapp/backend/tests/test_public_github_client.py
git commit -m "feat(backend): PublicGitHubClient with ETag+TTL+single-flight cache"
```

---

## Task E1: Stats endpoint — repo profile

**Files:**
- Create: `webapp/backend/app/api/github_stats.py`
- Create: `webapp/backend/tests/test_github_stats_endpoints.py`
- Modify: `webapp/backend/app/main.py`

We start with the smallest of the three endpoints (one upstream call) to lock in the response shape, error mapping, and token-selection wiring. The other two follow the same pattern.

- [ ] **Step 1: Write the failing tests**

Create `webapp/backend/tests/test_github_stats_endpoints.py`:

```python
import asyncio

import pytest
import respx
from tests._auth_helpers import authed_cookies


API = "https://api.github.test"


def _repo_payload(**overrides):
    base = {
        "full_name": "octo/hello",
        "name": "hello",
        "description": "an example",
        "html_url": "https://github.com/octo/hello",
        "default_branch": "main",
        "stargazers_count": 80,
        "forks_count": 9,
        "watchers_count": 80,
        "open_issues_count": 3,
        "language": "Ruby",
        "license": {"spdx_id": "MIT", "name": "MIT License"},
        "topics": ["ruby", "example"],
        "created_at": "2008-01-14T04:33:35Z",
        "updated_at": "2022-01-14T04:33:35Z",
    }
    base.update(overrides)
    return base


def test_repo_endpoint_happy_path(client, respx_mock: respx.MockRouter):
    respx_mock.get(f"{API}/repos/octo/hello").respond(
        200, json=_repo_payload(), headers={"ETag": '"e"'}
    )
    r = client.get("/api/github/repos/octo/hello")
    assert r.status_code == 200
    body = r.json()
    assert body["full_name"] == "octo/hello"
    assert body["primary_language"] == "Ruby"
    assert body["license_spdx"] == "MIT"
    assert body["topics"] == ["ruby", "example"]
    # No raw GitHub fields leak through
    assert "language" not in body
    assert "license" not in body


def test_repo_endpoint_404_maps_to_404(client, respx_mock: respx.MockRouter):
    respx_mock.get(f"{API}/repos/octo/missing").respond(404)
    r = client.get("/api/github/repos/octo/missing")
    assert r.status_code == 404
    assert r.json()["detail"] == "repo_not_found"


def test_repo_endpoint_rate_limited(client, respx_mock: respx.MockRouter):
    respx_mock.get(f"{API}/repos/octo/hello").respond(
        403,
        headers={
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": "9999999999",
        },
        json={"message": "rate limit"},
    )
    r = client.get("/api/github/repos/octo/hello")
    assert r.status_code == 503
    assert r.headers.get("Retry-After") is not None


def test_repo_endpoint_uses_fallback_pat_when_anon(
    client, respx_mock: respx.MockRouter,
):
    route = respx_mock.get(f"{API}/repos/octo/hello").respond(
        200, json=_repo_payload()
    )
    client.get("/api/github/repos/octo/hello")
    assert route.calls[0].request.headers["authorization"] == "Bearer ghp_fallback"


@pytest.mark.asyncio
async def test_repo_endpoint_uses_viewer_token_when_logged_in(
    client, respx_mock: respx.MockRouter,
):
    cookies, user = await authed_cookies(
        client, login="alice", github_id=99, access_token="gho_alice"
    )
    route = respx_mock.get(f"{API}/repos/octo/hello").respond(
        200, json=_repo_payload()
    )
    client.get("/api/github/repos/octo/hello", cookies=cookies)
    assert route.calls[0].request.headers["authorization"] == "Bearer gho_alice"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webapp/backend && pytest tests/test_github_stats_endpoints.py -v`
Expected: FAIL — 404 on `/api/github/repos/octo/hello`.

- [ ] **Step 3: Implement the endpoint**

Create `webapp/backend/app/api/github_stats.py`:

```python
from __future__ import annotations

import logging
from time import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response

from app.auth.crypto import TokenCipher
from app.auth.sessions import get_current_user
from app.deps import get_app_settings, get_public_github
from app.github.public_client import (
    GitHubAuthError,
    GitHubNotFound,
    GitHubRateLimited,
    GitHubUpstreamError,
    PublicGitHubClient,
)
from app.settings import Settings
from app.storage.models import User


log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/github", tags=["github-stats"])


def _viewer_token(user: User | None, settings: Settings) -> str | None:
    if user is None:
        return None
    cipher = TokenCipher(settings.token_encryption_key)
    try:
        return cipher.decrypt(user.encrypted_access_token)
    except Exception:
        log.warning("github_stats viewer_token decrypt failed")
        return None


def _handle_errors(exc: Exception, *, not_found_detail: str) -> HTTPException:
    if isinstance(exc, GitHubNotFound):
        return HTTPException(status_code=404, detail=not_found_detail)
    if isinstance(exc, GitHubRateLimited):
        retry = max(0, exc.reset_at_epoch - int(time()))
        return HTTPException(
            status_code=503,
            detail="github_rate_limited",
            headers={"Retry-After": str(retry)},
        )
    if isinstance(exc, GitHubAuthError):
        return HTTPException(status_code=502, detail="github_upstream_error")
    if isinstance(exc, GitHubUpstreamError):
        return HTTPException(status_code=502, detail="github_upstream_error")
    raise exc


@router.get("/repos/{owner}/{name}")
async def get_repo(
    owner: str,
    name: str,
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
    gh: PublicGitHubClient = Depends(get_public_github),
):
    if not settings.github_fallback_token and user is None:
        raise HTTPException(status_code=503, detail="github_not_configured")
    try:
        payload: Any = await gh.get_json(
            f"/repos/{owner}/{name}",
            viewer_token=_viewer_token(user, settings),
        )
    except Exception as exc:
        raise _handle_errors(exc, not_found_detail="repo_not_found") from exc
    return _project_repo(payload)


def _project_repo(p: dict) -> dict:
    license_obj = p.get("license") or {}
    return {
        "full_name": p["full_name"],
        "name": p["name"],
        "description": p.get("description"),
        "html_url": p["html_url"],
        "default_branch": p.get("default_branch"),
        "stargazers_count": p.get("stargazers_count", 0),
        "forks_count": p.get("forks_count", 0),
        "watchers_count": p.get("watchers_count", 0),
        "open_issues_count": p.get("open_issues_count", 0),
        "primary_language": p.get("language"),
        "license_spdx": license_obj.get("spdx_id"),
        "topics": p.get("topics", []),
        "created_at": p.get("created_at"),
        "updated_at": p.get("updated_at"),
    }
```

- [ ] **Step 4: Mount the router**

Edit `webapp/backend/app/main.py` — in `create_app()`, after the other `include_router` calls, add:

```python
    from app.api import github_stats as github_stats_api
    app.include_router(github_stats_api.router)
```

(Or add `github_stats as github_stats_api` to the top-of-file import group and call `app.include_router(github_stats_api.router)` next to the others.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd webapp/backend && pytest tests/test_github_stats_endpoints.py -v`
Expected: PASS, all five tests.

- [ ] **Step 6: Commit**

```bash
git add webapp/backend/app/api/github_stats.py webapp/backend/app/main.py \
        webapp/backend/tests/test_github_stats_endpoints.py
git commit -m "feat(backend): GET /api/github/repos/{owner}/{name}"
```

---

## Task E2: Stats endpoint — paginated user repos

**Files:**
- Modify: `webapp/backend/app/api/github_stats.py`
- Modify: `webapp/backend/tests/test_github_stats_endpoints.py`

- [ ] **Step 1: Write the failing tests**

Append to `webapp/backend/tests/test_github_stats_endpoints.py`:

```python
def _repo_list_payload(names):
    return [
        {
            "name": n,
            "description": f"{n} repo",
            "html_url": f"https://github.com/octo/{n}",
            "stargazers_count": 1,
            "forks_count": 0,
            "language": "Python",
            "pushed_at": "2024-01-01T00:00:00Z",
        }
        for n in names
    ]


def test_user_repos_first_page(client, respx_mock: respx.MockRouter):
    respx_mock.get(
        f"{API}/users/octo/repos",
        params={"sort": "pushed", "per_page": "30", "page": "1"},
    ).respond(
        200,
        json=_repo_list_payload(["a", "b", "c"]),
        headers={
            "Link": '<https://api.github.test/users/octo/repos?page=2>; rel="next"',
        },
    )
    r = client.get("/api/github/users/octo/repos")
    assert r.status_code == 200
    body = r.json()
    assert [x["name"] for x in body["repos"]] == ["a", "b", "c"]
    assert body["has_next"] is True


def test_user_repos_last_page_has_next_false(
    client, respx_mock: respx.MockRouter,
):
    respx_mock.get(
        f"{API}/users/octo/repos",
        params={"sort": "pushed", "per_page": "30", "page": "5"},
    ).respond(200, json=_repo_list_payload(["z"]))
    r = client.get("/api/github/users/octo/repos?page=5")
    assert r.status_code == 200
    assert r.json()["has_next"] is False


def test_user_repos_404(client, respx_mock: respx.MockRouter):
    respx_mock.get(f"{API}/users/missing/repos").respond(404)
    r = client.get("/api/github/users/missing/repos")
    assert r.status_code == 404
    assert r.json()["detail"] == "user_not_found"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webapp/backend && pytest tests/test_github_stats_endpoints.py -v`
Expected: FAIL — 404 on `/api/github/users/octo/repos`.

- [ ] **Step 3: Implement the endpoint**

Append to `webapp/backend/app/api/github_stats.py`:

```python
def _has_next_from_link(link_header: str | None) -> bool:
    if not link_header:
        return False
    return 'rel="next"' in link_header


def _project_repo_list_item(p: dict) -> dict:
    return {
        "name": p["name"],
        "description": p.get("description"),
        "html_url": p["html_url"],
        "stargazers_count": p.get("stargazers_count", 0),
        "forks_count": p.get("forks_count", 0),
        "language": p.get("language"),
        "pushed_at": p.get("pushed_at"),
    }


@router.get("/users/{login}/repos")
async def list_user_repos(
    login: str,
    page: int = 1,
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
    gh: PublicGitHubClient = Depends(get_public_github),
):
    if not settings.github_fallback_token and user is None:
        raise HTTPException(status_code=503, detail="github_not_configured")
    page = max(1, min(page, 100))
    try:
        payload, link = await gh.get_json_with_link(
            f"/users/{login}/repos",
            viewer_token=_viewer_token(user, settings),
            params={"sort": "pushed", "per_page": 30, "page": page},
        )
    except Exception as exc:
        raise _handle_errors(exc, not_found_detail="user_not_found") from exc
    return {
        "repos": [_project_repo_list_item(p) for p in payload],
        "has_next": _has_next_from_link(link),
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webapp/backend && pytest tests/test_github_stats_endpoints.py -v`
Expected: PASS, all eight tests (including the three new ones).

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/api/github_stats.py \
        webapp/backend/tests/test_github_stats_endpoints.py
git commit -m "feat(backend): GET /api/github/users/{login}/repos"
```

---

## Task E3: Stats endpoint — user profile with star/language aggregation

**Files:**
- Modify: `webapp/backend/app/api/github_stats.py`
- Modify: `webapp/backend/tests/test_github_stats_endpoints.py`

- [ ] **Step 1: Write the failing tests**

Append to `webapp/backend/tests/test_github_stats_endpoints.py`:

```python
def _user_payload(**overrides):
    base = {
        "id": 4242,
        "login": "octo",
        "name": "The Octocat",
        "bio": "GitHub mascot",
        "avatar_url": "https://avatars.githubusercontent.com/u/4242?v=4",
        "html_url": "https://github.com/octo",
        "followers": 1234,
        "following": 9,
        "public_repos": 2,
        "created_at": "2008-01-14T04:33:35Z",
    }
    base.update(overrides)
    return base


def test_user_endpoint_happy_path(client, respx_mock: respx.MockRouter):
    respx_mock.get(f"{API}/users/octo").respond(200, json=_user_payload())
    respx_mock.get(
        f"{API}/users/octo/repos",
        params={"sort": "pushed", "per_page": "100", "page": "1"},
    ).respond(200, json=[
        {"name": "a", "stargazers_count": 100, "language": "Go"},
        {"name": "b", "stargazers_count": 50, "language": "Python"},
    ])

    r = client.get("/api/github/users/octo")
    assert r.status_code == 200
    body = r.json()
    assert body["login"] == "octo"
    assert body["total_public_stars"] == 150
    assert body["top_languages"] == ["Go", "Python"]
    assert body["stars_truncated"] is False
    assert body["public_repos"] == 2


def test_user_endpoint_truncates_at_300_repos(
    client, respx_mock: respx.MockRouter,
):
    full_page = [
        {"name": f"r{i}", "stargazers_count": 1, "language": "Go"}
        for i in range(100)
    ]
    respx_mock.get(f"{API}/users/octo").respond(
        200, json=_user_payload(public_repos=500),
    )
    for page in (1, 2, 3):
        respx_mock.get(
            f"{API}/users/octo/repos",
            params={"sort": "pushed", "per_page": "100", "page": str(page)},
        ).respond(200, json=full_page)

    r = client.get("/api/github/users/octo")
    body = r.json()
    assert body["total_public_stars"] == 300  # 3 * 100
    assert body["stars_truncated"] is True


def test_user_endpoint_no_repos_skips_aggregation(
    client, respx_mock: respx.MockRouter,
):
    respx_mock.get(f"{API}/users/empty").respond(
        200, json=_user_payload(login="empty", public_repos=0)
    )
    # If the code tries to call /repos, this will 404 and break the test.
    r = client.get("/api/github/users/empty")
    assert r.status_code == 200
    assert r.json()["total_public_stars"] == 0
    assert r.json()["top_languages"] == []


def test_user_endpoint_404(client, respx_mock: respx.MockRouter):
    respx_mock.get(f"{API}/users/missing").respond(404)
    r = client.get("/api/github/users/missing")
    assert r.status_code == 404
    assert r.json()["detail"] == "user_not_found"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webapp/backend && pytest tests/test_github_stats_endpoints.py -v`
Expected: FAIL — 404 on `/api/github/users/octo`.

- [ ] **Step 3: Implement the endpoint**

Append to `webapp/backend/app/api/github_stats.py`:

```python
MAX_STAR_AGG_PAGES = 3
STAR_AGG_PER_PAGE = 100


@router.get("/users/{login}")
async def get_user(
    login: str,
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
    gh: PublicGitHubClient = Depends(get_public_github),
):
    if not settings.github_fallback_token and user is None:
        raise HTTPException(status_code=503, detail="github_not_configured")
    token = _viewer_token(user, settings)
    try:
        profile = await gh.get_json(f"/users/{login}", viewer_token=token)
    except Exception as exc:
        raise _handle_errors(exc, not_found_detail="user_not_found") from exc

    total_stars = 0
    lang_counts: dict[str, int] = {}
    stars_truncated = False

    public_repos = int(profile.get("public_repos", 0) or 0)
    if public_repos > 0:
        try:
            for page in range(1, MAX_STAR_AGG_PAGES + 1):
                items = await gh.get_json(
                    f"/users/{login}/repos",
                    viewer_token=token,
                    params={
                        "sort": "pushed",
                        "per_page": STAR_AGG_PER_PAGE,
                        "page": page,
                    },
                )
                if not items:
                    break
                for repo in items:
                    total_stars += int(repo.get("stargazers_count", 0) or 0)
                    lang = repo.get("language")
                    if lang:
                        lang_counts[lang] = lang_counts.get(lang, 0) + 1
                if len(items) < STAR_AGG_PER_PAGE:
                    break
            else:
                # Hit the cap. If GitHub reports more than we walked, mark truncated.
                if public_repos > MAX_STAR_AGG_PAGES * STAR_AGG_PER_PAGE:
                    stars_truncated = True
        except Exception as exc:
            raise _handle_errors(exc, not_found_detail="user_not_found") from exc

    top_languages = [
        lang for lang, _count in sorted(
            lang_counts.items(), key=lambda kv: (-kv[1], kv[0])
        )
    ][:3]

    return {
        "login": profile["login"],
        "name": profile.get("name"),
        "bio": profile.get("bio"),
        "avatar_url": profile.get("avatar_url"),
        "html_url": profile["html_url"],
        "followers": profile.get("followers", 0),
        "following": profile.get("following", 0),
        "public_repos": public_repos,
        "total_public_stars": total_stars,
        "top_languages": top_languages,
        "created_at": profile.get("created_at"),
        "stars_truncated": stars_truncated,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webapp/backend && pytest tests/test_github_stats_endpoints.py -v`
Expected: PASS, all twelve tests.

- [ ] **Step 5: Run the full backend suite to confirm no regressions**

Run: `cd webapp/backend && pytest -q`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add webapp/backend/app/api/github_stats.py \
        webapp/backend/tests/test_github_stats_endpoints.py
git commit -m "feat(backend): GET /api/github/users/{login} with star aggregation"
```

---

## Task F1: Frontend types and API client functions

**Files:**
- Modify: `webapp/frontend/src/types.ts`
- Modify: `webapp/frontend/src/api.ts`
- Modify: `webapp/frontend/src/tests/api.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `webapp/frontend/src/tests/api.test.ts`:

```typescript
import {
  fetchMe,
  logout,
  fetchGithubUser,
  fetchGithubUserRepos,
  fetchGithubRepo,
} from "../api";

describe("api / auth + github", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchMe returns null on 204", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    const me = await fetchMe();
    expect(me).toBeNull();
  });

  it("fetchMe returns the user on 200", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "u-1",
          login: "alice",
          name: "Alice",
          avatar_url: "https://avatars/alice.png",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const me = await fetchMe();
    expect(me).not.toBeNull();
    expect(me!.login).toBe("alice");
  });

  it("logout POSTs and resolves on 204", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    await logout();
    const call = spy.mock.calls[0];
    expect(call[0]).toBe("/api/auth/logout");
    expect((call[1] as RequestInit).method).toBe("POST");
  });

  it("fetchGithubUser returns the parsed profile", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          login: "octo", name: "Octo", bio: null, avatar_url: "",
          html_url: "", followers: 1, following: 0, public_repos: 1,
          total_public_stars: 5, top_languages: ["Go"],
          created_at: "2008-01-14T04:33:35Z", stars_truncated: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const u = await fetchGithubUser("octo");
    expect(u.login).toBe("octo");
    expect(u.top_languages).toEqual(["Go"]);
  });

  it("fetchGithubUserRepos paginates", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ repos: [], has_next: false }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await fetchGithubUserRepos("octo", 2);
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("page=2");
  });

  it("fetchGithubRepo returns the parsed repo", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          full_name: "octo/hello", name: "hello", description: "", html_url: "",
          default_branch: "main", stargazers_count: 1, forks_count: 0,
          watchers_count: 1, open_issues_count: 0, primary_language: "Ruby",
          license_spdx: "MIT", topics: [], created_at: "", updated_at: "",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const r = await fetchGithubRepo("octo", "hello");
    expect(r.primary_language).toBe("Ruby");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webapp/frontend && npm test -- --run`
Expected: FAIL — `fetchMe`, `logout`, etc. not exported from `../api`.

- [ ] **Step 3: Add the types**

Append to `webapp/frontend/src/types.ts`:

```typescript
export interface MeResponse {
  id: string;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

export interface GithubUser {
  login: string;
  name: string | null;
  bio: string | null;
  avatar_url: string | null;
  html_url: string;
  followers: number;
  following: number;
  public_repos: number;
  total_public_stars: number;
  top_languages: string[];
  created_at: string;
  stars_truncated: boolean;
}

export interface GithubRepo {
  full_name: string;
  name: string;
  description: string | null;
  html_url: string;
  default_branch: string | null;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  open_issues_count: number;
  primary_language: string | null;
  license_spdx: string | null;
  topics: string[];
  created_at: string | null;
  updated_at: string | null;
}

export interface GithubRepoListItem {
  name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  pushed_at: string | null;
}

export interface GithubRepoListPage {
  repos: GithubRepoListItem[];
  has_next: boolean;
}
```

- [ ] **Step 4: Add the API functions**

Append to `webapp/frontend/src/api.ts`:

```typescript
import type {
  GithubRepo,
  GithubRepoListPage,
  GithubUser,
  MeResponse,
} from "./types";

export async function fetchMe(): Promise<MeResponse | null> {
  const r = await fetch("/api/auth/me");
  if (r.status === 204) return null;
  if (!r.ok) throw new ApiError(r.status, await r.text());
  return (await r.json()) as MeResponse;
}

export async function logout(): Promise<void> {
  const r = await fetch("/api/auth/logout", { method: "POST" });
  if (r.status !== 204) {
    throw new ApiError(r.status, await r.text());
  }
}

export async function fetchGithubUser(login: string): Promise<GithubUser> {
  const r = await fetch(`/api/github/users/${encodeURIComponent(login)}`);
  return jsonOrThrow<GithubUser>(r);
}

export async function fetchGithubUserRepos(
  login: string,
  page = 1,
): Promise<GithubRepoListPage> {
  const r = await fetch(
    `/api/github/users/${encodeURIComponent(login)}/repos?page=${page}`,
  );
  return jsonOrThrow<GithubRepoListPage>(r);
}

export async function fetchGithubRepo(
  owner: string,
  name: string,
): Promise<GithubRepo> {
  const r = await fetch(
    `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
  );
  return jsonOrThrow<GithubRepo>(r);
}
```

(Note: the `import type {...}` at the top of `api.ts` already exists — extend it rather than duplicating. If the existing import is one line, edit it to include the new types instead of adding a second import block.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd webapp/frontend && npm test -- --run`
Expected: PASS — existing tests still green; new ones green.

- [ ] **Step 6: Commit**

```bash
git add webapp/frontend/src/api.ts webapp/frontend/src/types.ts \
        webapp/frontend/src/tests/api.test.ts
git commit -m "feat(frontend): API client functions for auth + github stats"
```

---

## Task F2: `AuthContext` provider

**Files:**
- Create: `webapp/frontend/src/auth/AuthContext.tsx`
- Modify: `webapp/frontend/src/App.tsx`

- [ ] **Step 1: Implement `AuthContext`**

(No standalone test for the context — it's exercised by the AuthWidget tests in F3 and the Playwright smoke test in G1.)

Create `webapp/frontend/src/auth/AuthContext.tsx`:

```typescript
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { fetchMe, logout as apiLogout } from "../api";
import type { MeResponse } from "../types";

interface AuthState {
  loading: boolean;
  user: MeResponse | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<MeResponse | null>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await fetchMe();
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await apiLogout();
    setUser(null);
    // Reload to clear any data fetched with the now-cleared session.
    window.location.reload();
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ loading, user, refresh, signOut }),
    [loading, user, refresh, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (v === undefined) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return v;
}
```

- [ ] **Step 2: Wrap routes in the provider**

Edit `webapp/frontend/src/App.tsx`:

```typescript
import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { Landing } from "./routes/Landing";
import { NotFound } from "./routes/NotFound";
import { PrTracesList } from "./routes/PrTracesList";
import { RepoPage } from "./routes/RepoPage";
import { TraceView } from "./routes/TraceView";
import { UserPage } from "./routes/UserPage";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route
          path=":owner/:repo/pull/:number"
          element={<PrTracesList />}
        />
        <Route
          path=":owner/:repo/pull/:number/:shortId"
          element={<TraceView />}
        />
        <Route path=":owner/:repo" element={<RepoPage />} />
        <Route path=":owner" element={<UserPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  );
}
```

- [ ] **Step 3: Verify build compiles**

Run: `cd webapp/frontend && npm run build`
Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add webapp/frontend/src/auth/AuthContext.tsx webapp/frontend/src/App.tsx
git commit -m "feat(frontend): AuthContext provider"
```

---

## Task F3: `AuthWidget` rendered inside `PageTopbar`

**Files:**
- Create: `webapp/frontend/src/components/AuthWidget.tsx`
- Modify: `webapp/frontend/src/components/PageTopbar.tsx`
- Create: `webapp/frontend/src/tests/AuthWidget.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `webapp/frontend/src/tests/AuthWidget.test.tsx`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { AuthWidget } from "../components/AuthWidget";

const mockUser = {
  id: "u-1",
  login: "alice",
  name: "Alice",
  avatar_url: "https://avatars/alice.png",
};

vi.mock("../auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../auth/AuthContext";

describe("AuthWidget", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders Sign in link when anonymous", () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      loading: false, user: null, refresh: vi.fn(), signOut: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={["/alice"]}>
        <AuthWidget />
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: /sign in with github/i });
    expect(link).toHaveAttribute(
      "href",
      "/api/auth/github/login?next=%2Falice",
    );
  });

  it("renders @login and a Sign out button when authenticated", () => {
    const signOut = vi.fn();
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      loading: false, user: mockUser, refresh: vi.fn(), signOut,
    });

    render(
      <MemoryRouter>
        <AuthWidget />
      </MemoryRouter>,
    );

    expect(screen.getByText("@alice")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(signOut).toHaveBeenCalled();
  });

  it("renders nothing while loading", () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      loading: true, user: null, refresh: vi.fn(), signOut: vi.fn(),
    });

    const { container } = render(
      <MemoryRouter>
        <AuthWidget />
      </MemoryRouter>,
    );
    expect(container.textContent).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webapp/frontend && npm test -- --run`
Expected: FAIL — `Cannot find module '../components/AuthWidget'`.

- [ ] **Step 3: Implement `AuthWidget`**

Create `webapp/frontend/src/components/AuthWidget.tsx`:

```typescript
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function AuthWidget() {
  const { loading, user, signOut } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  if (loading) return null;

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return (
      <a
        className="iconbtn primary"
        href={`/api/auth/github/login?next=${next}`}
      >
        Sign in with GitHub
      </a>
    );
  }

  return (
    <div className="auth-widget" style={{ position: "relative" }}>
      <button
        type="button"
        className="iconbtn"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        {user.avatar_url ? (
          <img
            src={user.avatar_url}
            alt=""
            width={20}
            height={20}
            style={{ borderRadius: "50%", marginRight: 6 }}
          />
        ) : null}
        @{user.login} ▾
      </button>
      {menuOpen ? (
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
          <button
            type="button"
            className="iconbtn"
            onClick={() => signOut()}
            style={{ width: "100%", textAlign: "left" }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Render the widget inside `PageTopbar`**

Edit `webapp/frontend/src/components/PageTopbar.tsx` — replace contents with:

```typescript
import { Link } from "react-router-dom";
import { AuthWidget } from "./AuthWidget";
import { IconMoon, IconSun } from "./trace/icons";
import { useTheme } from "./trace/theme";

export interface Crumb {
  label: string;
  to?: string;
  current?: boolean;
}

interface Props {
  crumbs: Crumb[];
}

export function PageTopbar({ crumbs }: Props) {
  const { resolved, toggle } = useTheme();

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="brand" to="/">
          <span className="brand-mark">v</span>
          <span>vibeshub</span>
        </Link>
        {crumbs.map((c, i) => (
          <span key={`${i}-${c.label}`} style={{ display: "contents" }}>
            <span className="brand-sep">/</span>
            {c.to && !c.current ? (
              <Link className="topbar-link" to={c.to}>
                {c.label}
              </Link>
            ) : (
              <span
                className={`topbar-link${c.current ? " is-current" : ""}`}
              >
                {c.label}
              </span>
            )}
          </span>
        ))}
        <div className="topbar-spacer" />
        <div className="topbar-actions">
          <AuthWidget />
          <button
            className="iconbtn"
            onClick={toggle}
            type="button"
            aria-label={
              resolved === "dark"
                ? "Switch to light theme"
                : "Switch to dark theme"
            }
            title={resolved === "dark" ? "Light" : "Dark"}
          >
            {resolved === "dark" ? <IconSun /> : <IconMoon />}
          </button>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd webapp/frontend && npm test -- --run`
Expected: PASS — AuthWidget tests + existing tests green.

- [ ] **Step 6: Commit**

```bash
git add webapp/frontend/src/components/AuthWidget.tsx \
        webapp/frontend/src/components/PageTopbar.tsx \
        webapp/frontend/src/tests/AuthWidget.test.tsx
git commit -m "feat(frontend): AuthWidget in PageTopbar"
```

---

## Task F4: `UserPage` shows GitHub stats

**Files:**
- Modify: `webapp/frontend/src/routes/UserPage.tsx`

We replace the existing stat-strip cells with GitHub data. The tab labels (which already show trace count and repo count) keep the vibeshub-specific signal visible.

- [ ] **Step 1: Update `UserPage`**

Edit `webapp/frontend/src/routes/UserPage.tsx`. Apply these three changes:

(a) Imports — at the top, replace:

```typescript
import { fetchUserOverview } from "../api";
import type { UserOverview, UserRepoEntry } from "../types";
```

with:

```typescript
import { fetchGithubUser, fetchUserOverview } from "../api";
import type { GithubUser, UserOverview, UserRepoEntry } from "../types";
```

(b) Component body — replace the `useState` block + `useEffect` with:

```typescript
  const [data, setData] = useState<UserOverview | null>(null);
  const [ghUser, setGhUser] = useState<GithubUser | null>(null);
  const [ghError, setGhError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<UserTab>("traces");

  useEffect(() => {
    if (!owner) return;
    setError(null);
    setData(null);
    fetchUserOverview(owner)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [owner]);

  useEffect(() => {
    if (!owner) return;
    setGhError(null);
    setGhUser(null);
    fetchGithubUser(owner)
      .then(setGhUser)
      .catch((e) => setGhError(String(e)));
  }, [owner]);
```

(c) Replace the entire `<div className="stat-strip">…</div>` block (currently with Traces / Messages / Size / Last upload) with:

```tsx
        <div className="stat-strip">
          {ghError || !ghUser ? (
            <div className="stat-cell">
              <div className="stat-label">GitHub</div>
              <div className="stat-value">—</div>
              <div className="stat-sub">
                {ghError ? "Stats unavailable" : "Loading…"}
              </div>
            </div>
          ) : (
            <>
              <div className="stat-cell">
                <div className="stat-label">Public repos</div>
                <div className="stat-value">
                  {compactCount(ghUser.public_repos)}
                </div>
                <div className="stat-sub">on github.com/{owner}</div>
              </div>
              <div className="stat-cell">
                <div className="stat-label">Stars</div>
                <div className="stat-value">
                  {compactCount(ghUser.total_public_stars)}
                </div>
                <div className="stat-sub">
                  {ghUser.stars_truncated
                    ? "from top 300 repos"
                    : "across public repos"}
                </div>
              </div>
              <div className="stat-cell">
                <div className="stat-label">Followers</div>
                <div className="stat-value">
                  {compactCount(ghUser.followers)}
                </div>
                <div className="stat-sub">
                  following {compactCount(ghUser.following)}
                </div>
              </div>
              <div className="stat-cell">
                <div className="stat-label">Top languages</div>
                <div className="stat-value" style={{ fontSize: 16 }}>
                  {ghUser.top_languages.length > 0
                    ? ghUser.top_languages.join(" · ")
                    : "—"}
                </div>
                <div className="stat-sub">
                  joined {ghUser.created_at?.slice(0, 4) ?? "—"}
                </div>
              </div>
            </>
          )}
        </div>
```

(The bio + name from `ghUser` are optional UX you can also fold into `entity-head`; not required by the spec — leave the existing header alone.)

- [ ] **Step 2: Run frontend tests + build**

```bash
cd webapp/frontend && npm test -- --run && npm run build
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add webapp/frontend/src/routes/UserPage.tsx
git commit -m "feat(frontend): UserPage shows GitHub-derived stats"
```

---

## Task F5: `RepoPage` shows GitHub stats

**Files:**
- Modify: `webapp/frontend/src/routes/RepoPage.tsx`

- [ ] **Step 1: Update `RepoPage`**

Edit `webapp/frontend/src/routes/RepoPage.tsx`. Apply these three changes:

(a) Imports — replace:

```typescript
import { fetchRepoOverview } from "../api";
import type {
  RepoContributorEntry,
  RepoOverview,
  TraceSummary,
} from "../types";
```

with:

```typescript
import { fetchGithubRepo, fetchRepoOverview } from "../api";
import type {
  GithubRepo,
  RepoContributorEntry,
  RepoOverview,
  TraceSummary,
} from "../types";
```

(b) Component body — replace the state block + `useEffect` with:

```typescript
  const [data, setData] = useState<RepoOverview | null>(null);
  const [ghRepo, setGhRepo] = useState<GithubRepo | null>(null);
  const [ghError, setGhError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<RepoTab>("traces");

  useEffect(() => {
    if (!owner || !repo) return;
    setError(null);
    setData(null);
    fetchRepoOverview(owner, repo)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [owner, repo]);

  useEffect(() => {
    if (!owner || !repo) return;
    setGhError(null);
    setGhRepo(null);
    fetchGithubRepo(owner, repo)
      .then(setGhRepo)
      .catch((e) => setGhError(String(e)));
  }, [owner, repo]);
```

(c) Replace the `<div className="stat-strip">…</div>` block (Traces / Messages / Size / Contributors) with:

```tsx
        <div className="stat-strip">
          {ghError || !ghRepo ? (
            <div className="stat-cell">
              <div className="stat-label">GitHub</div>
              <div className="stat-value">—</div>
              <div className="stat-sub">
                {ghError ? "Stats unavailable" : "Loading…"}
              </div>
            </div>
          ) : (
            <>
              <div className="stat-cell">
                <div className="stat-label">Stars</div>
                <div className="stat-value">
                  {compactCount(ghRepo.stargazers_count)}
                </div>
                <div className="stat-sub">
                  {compactCount(ghRepo.watchers_count)} watching
                </div>
              </div>
              <div className="stat-cell">
                <div className="stat-label">Forks</div>
                <div className="stat-value">
                  {compactCount(ghRepo.forks_count)}
                </div>
                <div className="stat-sub">
                  {compactCount(ghRepo.open_issues_count)} open issues
                </div>
              </div>
              <div className="stat-cell">
                <div className="stat-label">Language</div>
                <div className="stat-value" style={{ fontSize: 16 }}>
                  {ghRepo.primary_language ?? "—"}
                </div>
                <div className="stat-sub">
                  {ghRepo.license_spdx ?? "no license"}
                </div>
              </div>
              <div className="stat-cell">
                <div className="stat-label">Updated</div>
                <div className="stat-value" style={{ fontSize: 16 }}>
                  {ghRepo.updated_at
                    ? relativeFrom(ghRepo.updated_at)
                    : "—"}
                </div>
                <div className="stat-sub">
                  default branch{" "}
                  {ghRepo.default_branch ?? "—"}
                </div>
              </div>
            </>
          )}
        </div>
```

- [ ] **Step 2: Run frontend tests + build**

```bash
cd webapp/frontend && npm test -- --run && npm run build
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add webapp/frontend/src/routes/RepoPage.tsx
git commit -m "feat(frontend): RepoPage shows GitHub-derived stats"
```

---

## Task G1: Playwright header-flip smoke test

**Files:**
- Create: `webapp/frontend/e2e/auth.spec.ts`

- [ ] **Step 1: Write the test**

Create `webapp/frontend/e2e/auth.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

const mockedUser = {
  id: "u-1",
  login: "octocat",
  name: "The Octocat",
  avatar_url: "https://avatars.githubusercontent.com/u/4242?v=4",
};

const mockedGhUser = {
  login: "octocat",
  name: "The Octocat",
  bio: null,
  avatar_url: mockedUser.avatar_url,
  html_url: "https://github.com/octocat",
  followers: 1,
  following: 0,
  public_repos: 0,
  total_public_stars: 0,
  top_languages: [],
  created_at: "2008-01-14T04:33:35Z",
  stars_truncated: false,
};

const overviewStub = {
  stats: {
    trace_count: 0, repo_count: 0, message_count: 0, byte_size: 0,
    last_trace_at: null,
  },
  traces: [],
  repos: [],
};

test("header flips between Sign in and @login + sign out", async ({ page }) => {
  // Anonymous: /api/auth/me returns 204.
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route("**/api/users/octocat", (route) =>
    route.fulfill({ json: overviewStub }),
  );
  await page.route("**/api/github/users/octocat", (route) =>
    route.fulfill({ json: mockedGhUser }),
  );

  await page.goto("/octocat");
  await expect(
    page.getByRole("link", { name: /sign in with github/i }),
  ).toBeVisible();

  // Authenticated: /api/auth/me returns the user.
  await page.unroute("**/api/auth/me");
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: mockedUser }),
  );

  await page.reload();
  await expect(page.getByRole("button", { name: /@octocat/ })).toBeVisible();

  // Sign out.
  await page.route("**/api/auth/logout", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.getByRole("button", { name: /@octocat/ }).click();
  await page.getByRole("button", { name: /sign out/i }).click();

  // After reload, /api/auth/me reverts to 204.
  await page.unroute("**/api/auth/me");
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 204 }),
  );
  await expect(
    page.getByRole("link", { name: /sign in with github/i }),
  ).toBeVisible();
});
```

- [ ] **Step 2: Run the Playwright suite**

```bash
cd webapp/frontend && npm run test:e2e
```

Expected: the new spec passes; existing `viewer.spec.ts` still passes.

- [ ] **Step 3: Commit**

```bash
git add webapp/frontend/e2e/auth.spec.ts
git commit -m "test(frontend): Playwright smoke for auth header flip"
```

---

## Task G2: Document new env vars in `.env.example`

**Files:**
- Modify: `deploy/azure/.env.example`

- [ ] **Step 1: Edit the file**

Edit `deploy/azure/.env.example` — append the following under a new `# --- OAuth & sessions ------------------------------------------------------` heading, placed below the `Optional` block:

```
# --- OAuth & sessions ------------------------------------------------------

# GitHub OAuth app credentials. Register an OAuth app at
# https://github.com/settings/developers with the authorized callback URL set to
#   <VIBESHUB_PUBLIC_BASE_URL>/api/auth/github/callback
# Scopes requested are minimal: read:user, user:email. Broader scopes (repo)
# will be added in a follow-up when private-repo fidelity is needed.
VIBESHUB_GITHUB_OAUTH_CLIENT_ID=<oauth-app-client-id>
VIBESHUB_GITHUB_OAUTH_CLIENT_SECRET=<oauth-app-client-secret>

# A server-side personal access token used to read public GitHub data when the
# viewer is not signed in. No special scopes are needed (a token with no scopes
# can still read public profile/repo data and gets the full 5000/hr bucket).
VIBESHUB_GITHUB_FALLBACK_TOKEN=<server-pat>

# Random secret used to sign the short-lived OAuth state cookie.
# Generate with: `python -c 'import secrets; print(secrets.token_urlsafe(48))'`.
# Rotate by changing the value; in-flight OAuth flows will need to retry.
VIBESHUB_SESSION_SECRET=<32+ random chars>

# Symmetric key used to encrypt OAuth access tokens at rest.
# Generate with:
#   python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
# For rotation, set "<new-key>,<old-key>" — reads try both, writes use the first.
VIBESHUB_TOKEN_ENCRYPTION_KEY=<fernet-key>

# Whether to set the `Secure` flag on the session cookie. MUST stay `true` for
# the Azure deploy. Override to `false` only for local HTTP dev.
# VIBESHUB_COOKIE_SECURE=true
```

- [ ] **Step 2: Commit**

```bash
git add deploy/azure/.env.example
git commit -m "docs: document new OAuth/session env vars"
```

---

## Verification checklist (before opening the PR)

- [ ] `cd webapp/backend && pytest -q` — all green.
- [ ] `cd webapp/frontend && npm test -- --run` — all green.
- [ ] `cd webapp/frontend && npm run build` — succeeds with zero TS errors.
- [ ] `cd webapp/frontend && npm run test:e2e` — both `viewer.spec.ts` and `auth.spec.ts` green.
- [ ] Manual: visit `/<some-public-login>` and `/<some-public-owner>/<repo>` without signing in — stat strips show real GitHub data, traces/PRs/contributors panels unchanged.
- [ ] Manual: sign in via `/api/auth/github/login`, see header flip, then sign out — header reverts.
- [ ] Manual: run the new Alembic migration on a clean DB and roll it back: `alembic upgrade head && alembic downgrade base`.
- [ ] `.env.example` is up to date.

---

## Plan self-review notes

- **Spec coverage:** every numbered section of the spec maps to at least one task. §3 constraints → A2 (scope comment in oauth.py), A3 (token-at-rest + indexes), C2 (callback flow); §4 brainstorm decisions → A1/A2/B1/C1/D1; §5 architecture → mirrored in the file map; §6 schema → A3; §7 OAuth flow → C1/C2/C3 + tests; §8 PublicGitHubClient → D1; §9 stats endpoints → E1/E2/E3; §10 frontend → F1/F2/F3/F4/F5; §11 errors → covered piecewise across tasks; §12 settings → A1 + G2; §13 tests → spread across each task; §14 verification → final checklist.
- **Placeholders:** none (the only `<rev>` is the Alembic-generated revision id, which the engineer fills in from the autogenerate output in Task A3 Step 5).
- **Type consistency:** `MeResponse`, `GithubUser`, `GithubRepo`, `GithubRepoListPage`, `GithubRepoListItem` declared in F1 are the only frontend types used in F2/F3/F4/F5. `PublicGitHubClient.get_json` / `get_json_with_link` shapes referenced in D1 match the signatures called from E1/E2/E3. `SESSION_COOKIE_NAME` is declared once in `sessions.py` and reused by routes + tests. The Fernet test key string appears once in conftest and is consumed transitively.
- **Frequent commits:** every task ends with a focused commit; nine tasks → nine commits on the feature branch.
