# Startup Credential Smoke-Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify Postgres + Azure Blob credentials at FastAPI lifespan startup so misconfigured deploys fail fast and roll back instead of accepting traffic that 500s on first use.

**Architecture:** New `app/smoke_check.py` module exports one coroutine called from `init_state` after clients are constructed. Backend-specific verification (Azure `get_container_properties`) lives on the backend class via a `BlobStore.smoke_check()` method — the orchestrator is provider-agnostic via polymorphism. Skip logic is a property of the backend type (in-memory SQLite → skip; `LocalDirBlobStore` → ABC default no-op). Failure raises `SmokeCheckError`, uvicorn exits non-zero, Container Apps rolls back.

**Tech Stack:** FastAPI lifespan, SQLAlchemy async engine, azure-storage-blob/azure-identity, pytest + pytest-asyncio.

**Spec:** `docs/superpowers/specs/2026-05-15-startup-credential-smoke-check-design.md`

**Branch:** Already on `startup-credential-smoke-check`. All commits land there.

**Working directory for commands:** `webapp/backend/` (run `cd webapp/backend` first or prefix `pytest` invocations with that path).

---

## File Map

| File | Action | Responsibility |
| ---- | ------ | -------------- |
| `webapp/backend/app/storage/blob.py` | Modify | Add `BlobStore.smoke_check()` ABC default (no-op) and `AzureBlobStore.smoke_check()` override |
| `webapp/backend/app/smoke_check.py` | Create | `SmokeCheckError`, `smoke_check()` orchestrator, internal `_check_db` / `_check_blob` helpers |
| `webapp/backend/app/deps.py` | Modify | Append `await smoke_check(...)` to the end of `init_state` |
| `webapp/backend/tests/test_storage_blob.py` | Modify | Test `LocalDirBlobStore.smoke_check()` is a no-op |
| `webapp/backend/tests/test_azure_blob_store.py` | Modify | Test `AzureBlobStore.smoke_check()` calls `get_container_properties` and propagates errors |
| `webapp/backend/tests/test_smoke_check.py` | Create | Orchestrator tests: skip in-memory SQLite, db failure (redaction + fail-fast), blob failure |

---

## Task 1: BlobStore.smoke_check polymorphism

**Files:**
- Modify: `webapp/backend/app/storage/blob.py:21-29` (ABC), `:62-80` (AzureBlobStore class body)
- Test: `webapp/backend/tests/test_storage_blob.py` (add 1 test)
- Test: `webapp/backend/tests/test_azure_blob_store.py` (add 2 tests)

- [ ] **Step 1: Write the failing test for `LocalDirBlobStore.smoke_check`**

Append to `webapp/backend/tests/test_storage_blob.py`:

```python
@pytest.mark.asyncio
async def test_smoke_check_is_noop(blob_store: LocalDirBlobStore):
    # LocalDirBlobStore inherits the ABC default no-op smoke_check.
    # Should return None without raising.
    assert await blob_store.smoke_check() is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && pytest tests/test_storage_blob.py::test_smoke_check_is_noop -v`
Expected: FAIL with `AttributeError: 'LocalDirBlobStore' object has no attribute 'smoke_check'`.

- [ ] **Step 3: Write the failing tests for `AzureBlobStore.smoke_check`**

Append to `webapp/backend/tests/test_azure_blob_store.py`:

```python
@pytest.mark.asyncio
async def test_smoke_check_calls_get_container_properties(store, container_client):
    container_client.get_container_properties = AsyncMock(return_value={"name": "traces"})
    await store.smoke_check()
    container_client.get_container_properties.assert_awaited_once_with()


@pytest.mark.asyncio
async def test_smoke_check_propagates_errors(store, container_client):
    container_client.get_container_properties = AsyncMock(
        side_effect=RuntimeError("auth boom")
    )
    with pytest.raises(RuntimeError, match="auth boom"):
        await store.smoke_check()
```

- [ ] **Step 4: Run the Azure tests to verify they fail**

Run: `cd webapp/backend && pytest tests/test_azure_blob_store.py -v -k smoke_check`
Expected: FAIL with `AttributeError: 'AzureBlobStore' object has no attribute 'smoke_check'`.

- [ ] **Step 5: Add `smoke_check` to the ABC and the Azure override**

Edit `webapp/backend/app/storage/blob.py`. In the `BlobStore` ABC (around line 21), replace the class body:

```python
class BlobStore(ABC):
    @abstractmethod
    async def put(self, key: str, data: bytes) -> None: ...

    @abstractmethod
    async def get(self, key: str) -> bytes: ...

    @abstractmethod
    async def delete(self, key: str) -> None: ...

    async def smoke_check(self) -> None:
        """Verify the backend is reachable. Default is a no-op; backends
        backed by external services (e.g. Azure Blob) override this to issue
        a cheap reachability call so misconfigurations surface at startup."""
        return
```

Then in `AzureBlobStore` (around line 62), add a method **next to** `put`/`get`/`delete`:

```python
    async def smoke_check(self) -> None:
        await self._container.get_container_properties()
```

Do NOT add `smoke_check` to `LocalDirBlobStore` — it inherits the no-op default. That's the whole point of putting the method on the ABC.

- [ ] **Step 6: Run all blob tests to verify they pass**

Run: `cd webapp/backend && pytest tests/test_storage_blob.py tests/test_azure_blob_store.py -v`
Expected: all tests PASS (existing tests still green, three new tests green).

- [ ] **Step 7: Commit**

```bash
git add webapp/backend/app/storage/blob.py \
        webapp/backend/tests/test_storage_blob.py \
        webapp/backend/tests/test_azure_blob_store.py
git commit -m "Add BlobStore.smoke_check (no-op default; Azure pings container)"
```

---

## Task 2: smoke_check orchestrator module

**Files:**
- Create: `webapp/backend/app/smoke_check.py`
- Create: `webapp/backend/tests/test_smoke_check.py`

- [ ] **Step 1: Write the test file with the four failing tests**

Create `webapp/backend/tests/test_smoke_check.py`:

```python
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import create_async_engine

from app.settings import Settings
from app.smoke_check import SmokeCheckError, smoke_check
from app.storage.blob import BlobStore, LocalDirBlobStore


class _RaisingBlobStore(BlobStore):
    """Fake backend whose smoke_check raises. Concrete put/get/delete
    are unused by the test but required to satisfy the ABC."""

    def __init__(self, exc: Exception):
        self._exc = exc

    async def put(self, key, data): raise NotImplementedError
    async def get(self, key): raise NotImplementedError
    async def delete(self, key): raise NotImplementedError

    async def smoke_check(self) -> None:
        raise self._exc


@pytest.fixture
def in_memory_settings() -> Settings:
    return Settings(database_url="sqlite+aiosqlite:///:memory:")


@pytest.mark.asyncio
async def test_smoke_check_skips_in_memory_sqlite_and_local_blob(
    in_memory_settings, tmp_path
):
    # The engine must NOT be connected to. Wrap a real engine in a MagicMock
    # whose .connect attribute would raise if touched.
    engine = MagicMock()
    engine.connect = MagicMock(side_effect=AssertionError("DB connect should be skipped"))
    blob = LocalDirBlobStore(root=tmp_path)

    # Should return without raising or touching engine.connect.
    await smoke_check(in_memory_settings, engine, blob)


@pytest.mark.asyncio
async def test_smoke_check_db_failure_raises_and_redacts_password(tmp_path):
    settings = Settings(
        database_url="postgresql+psycopg://user:supersecret@127.0.0.1:1/x"
    )
    engine = create_async_engine(settings.database_url)
    blob = LocalDirBlobStore(root=tmp_path)
    try:
        with pytest.raises(SmokeCheckError) as exc_info:
            await smoke_check(settings, engine, blob)
    finally:
        await engine.dispose()

    msg = str(exc_info.value)
    assert msg.startswith("db:"), f"expected db-prefixed error, got: {msg}"
    assert "supersecret" not in msg, f"password leaked in error: {msg}"


@pytest.mark.asyncio
async def test_smoke_check_db_failure_does_not_run_blob_check(tmp_path):
    settings = Settings(
        database_url="postgresql+psycopg://user:pw@127.0.0.1:1/x"
    )
    engine = create_async_engine(settings.database_url)
    blob = _RaisingBlobStore(AssertionError("blob check should not run after db fails"))
    try:
        with pytest.raises(SmokeCheckError) as exc_info:
            await smoke_check(settings, engine, blob)
    finally:
        await engine.dispose()

    assert str(exc_info.value).startswith("db:")


@pytest.mark.asyncio
async def test_smoke_check_blob_failure_raises(in_memory_settings):
    blob = _RaisingBlobStore(RuntimeError("container missing"))
    engine = MagicMock()  # not used; in-memory URL skips db
    with pytest.raises(SmokeCheckError) as exc_info:
        await smoke_check(in_memory_settings, engine, blob)
    msg = str(exc_info.value)
    assert msg.startswith("blob:"), f"expected blob-prefixed error, got: {msg}"
    assert "container missing" in msg
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webapp/backend && pytest tests/test_smoke_check.py -v`
Expected: all four FAIL with `ImportError: cannot import name 'SmokeCheckError' from 'app.smoke_check'` (module does not exist yet).

- [ ] **Step 3: Create the smoke_check module**

Create `webapp/backend/app/smoke_check.py`:

```python
from __future__ import annotations

import asyncio
import logging
import time

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.settings import Settings
from app.storage.blob import BlobStore

log = logging.getLogger(__name__)

_DB_TIMEOUT_S = 10.0
_BLOB_TIMEOUT_S = 10.0


class SmokeCheckError(RuntimeError):
    """Raised when a startup credential check fails. Propagating this out of
    the FastAPI lifespan causes uvicorn to exit non-zero so Container Apps
    marks the revision unhealthy and rolls back."""


def _safe_repr(e: BaseException, limit: int = 500) -> str:
    return repr(e)[:limit]


async def smoke_check(
    settings: Settings,
    engine: AsyncEngine,
    blob_store: BlobStore,
) -> None:
    """Verify external dependencies are reachable. Skips local-only backends.

    DB is checked first; if it fails, blob is not checked (the first failure
    is the most diagnostic, and there is no point pinging downstream when the
    primary store is dead)."""
    await _check_db(engine, settings.database_url)
    await _check_blob(blob_store)


async def _check_db(engine: AsyncEngine, database_url: str) -> None:
    if ":memory:" in database_url:
        log.info("smoke-check: db SKIPPED (in-memory sqlite)")
        return
    t0 = time.monotonic()
    try:
        async def _ping() -> None:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        await asyncio.wait_for(_ping(), timeout=_DB_TIMEOUT_S)
    except Exception as e:
        raise SmokeCheckError(f"db: {_safe_repr(e)}") from e
    log.info("smoke-check: db OK (%.0fms)", (time.monotonic() - t0) * 1000)


async def _check_blob(blob_store: BlobStore) -> None:
    t0 = time.monotonic()
    try:
        await asyncio.wait_for(blob_store.smoke_check(), timeout=_BLOB_TIMEOUT_S)
    except Exception as e:
        raise SmokeCheckError(f"blob: {_safe_repr(e)}") from e
    log.info("smoke-check: blob OK (%.0fms)", (time.monotonic() - t0) * 1000)
```

Notes for the implementer:
- `_safe_repr` exists so a future Postgres exception that embeds the DSN (which includes the password) gets truncated AND the test asserts the password substring isn't present. We are not aggressively scrubbing; we are bounding length and asserting the common-case leak doesn't happen.
- `asyncio.wait_for` on the blob path wraps even synchronous errors raised inside the coroutine; that's fine — `wait_for` only intercepts cancellation/timeout, regular exceptions propagate through unchanged.
- `Exception as e` (not `BaseException`) is intentional — we don't want to swallow `KeyboardInterrupt` or `SystemExit`.

- [ ] **Step 4: Run smoke_check tests to verify they pass**

Run: `cd webapp/backend && pytest tests/test_smoke_check.py -v`
Expected: all four tests PASS.

The DB failure test relies on TCP connect to `127.0.0.1:1` returning ECONNREFUSED promptly. If the run host has a firewall that swallows the SYN, the test will hit the 10s `wait_for` timeout — still passes (raises `SmokeCheckError`), just slow. Acceptable.

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/smoke_check.py webapp/backend/tests/test_smoke_check.py
git commit -m "Add smoke_check orchestrator (DB SELECT 1 + polymorphic blob ping)"
```

---

## Task 3: Wire smoke_check into init_state

**Files:**
- Modify: `webapp/backend/app/deps.py:14-29` (end of `init_state`)

- [ ] **Step 1: Run the full backend test suite first to record the baseline**

Run: `cd webapp/backend && pytest -q`
Expected: all tests PASS. Note the count; it must match after Task 3.

- [ ] **Step 2: Modify `init_state` to call `smoke_check`**

Edit `webapp/backend/app/deps.py`. Add the import at the top with the other `app.*` imports:

```python
from app.smoke_check import smoke_check
```

Then append one line to the end of `init_state` (after the `app.state.github = ...` assignment):

```python
async def init_state(app: FastAPI, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    engine = engine_for(settings.database_url)
    # Only auto-bootstrap the schema for in-memory SQLite (tests). Any other
    # backend — including a misconfigured file-based SQLite or Postgres —
    # must be migrated via Alembic.
    if ":memory:" in settings.database_url:
        await create_all(engine)
    app.state.settings = settings
    app.state.db_engine = engine
    app.state.session_maker = session_maker_for(engine)
    if settings.azure_blob_container:
        app.state.blob_store = make_azure_blob_store(settings)
    else:
        app.state.blob_store = LocalDirBlobStore(settings.blob_dir)
    app.state.github = GitHubClient(api_base=settings.github_api_base)
    await smoke_check(settings, engine, app.state.blob_store)
```

The smoke_check call is the LAST statement of `init_state` — every `app.state.*` assignment must be complete before the check runs so a failure leaves the app state inspectable (e.g. for debugging in tests).

- [ ] **Step 3: Run the full backend test suite to verify nothing regressed**

Run: `cd webapp/backend && pytest -q`
Expected: same test count as Step 1, all PASS.

Because every existing test fixture uses `sqlite+aiosqlite:///:memory:` (DB check skipped) and `LocalDirBlobStore` (blob check inherits ABC no-op), the smoke_check runs but does nothing. No fixture changes required.

If a test fails: the most likely cause is a test that constructs a real (non-memory) SQLAlchemy URL or a real Azure-credentialed store. Read the failure — do NOT add an env var to disable smoke_check. The skip path is correct; if a test trips the check, the test was misconfigured.

- [ ] **Step 4: Manually verify the DB-failure path raises during startup**

This is a one-shot sanity check, not an automated test. From `webapp/backend/`:

```bash
VIBESHUB_DATABASE_URL="postgresql+psycopg://user:pw@127.0.0.1:1/x" \
VIBESHUB_BLOB_DIR=/tmp/vh-blobs \
VIBESHUB_GITHUB_API_BASE=https://api.github.test \
VIBESHUB_PUBLIC_BASE_URL=https://x.test \
python -c "
import asyncio
from fastapi import FastAPI
from app.deps import init_state

async def main():
    try:
        await init_state(FastAPI())
    except Exception as e:
        print('STARTUP FAILED:', type(e).__name__, str(e)[:200])
        return 1
    print('STARTUP OK (unexpected)')
    return 0

raise SystemExit(asyncio.run(main()))
"
```

Expected output starts with `STARTUP FAILED: SmokeCheckError db: ...` and exits non-zero. The `db:` prefix and non-zero exit are the contract Container Apps relies on.

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/deps.py
git commit -m "Run smoke_check at FastAPI lifespan startup"
```

---

## Self-review notes

- **Spec coverage:** Architecture (Task 2), `BlobStore.smoke_check` polymorphism (Task 1), `init_state` wiring (Task 3), skip behavior for in-memory SQLite and `LocalDirBlobStore` (Task 2 test 1 + Task 1 default no-op), `SmokeCheckError` + fail-fast across checks (Task 2 tests 2–3), credential redaction (Task 2 test 2), three named test cases from spec (Task 2 tests 1, 2/3, 4). All spec requirements have a corresponding task.
- **Placeholders:** None. Every code snippet and command is final.
- **Type consistency:** `smoke_check(settings, engine, blob_store)` signature used in spec, plan task 2, and plan task 3. `SmokeCheckError` is the same name throughout. `BlobStore.smoke_check()` returns `None` consistently.
