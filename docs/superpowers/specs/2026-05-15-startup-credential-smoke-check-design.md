# Startup credential smoke-check

## Problem

`webapp/backend/app/deps.py::init_state` constructs a SQLAlchemy engine, a `BlobStore`, and a `GitHubClient` at FastAPI lifespan startup, but never exercises any of them. A misconfigured deployment — wrong `VIBESHUB_DATABASE_URL`, detached managed identity, missing blob container — only surfaces on the **first user request** to a code path that touches the broken dependency. The container reports healthy and accepts traffic until then.

A separate `app/check_db.py` script exists for diagnosing DB problems, but it has to be invoked manually (override the Container App's command), only covers DB, and ends with `time.sleep(600)`. It is a one-off shell-into-the-container tool, not part of normal startup.

## Goal

Verify the Postgres and Azure Blob credentials at FastAPI lifespan startup using the same client objects the app will serve requests with. On failure, raise so uvicorn exits non-zero, Container Apps marks the revision unhealthy, and rolls back to the previous good revision. On success, log one line per check and proceed.

## Non-goals

- GitHub API ping — the server holds no GitHub credential; an unauthenticated `api.github.com` ping would only catch DNS/egress, which the DB and Blob checks already cover by virtue of issuing real outbound calls.
- Replacing or extending `check_db.py`. It remains a separate manual diagnostic.
- Runtime health checks (liveness probes touching the DB on every request). Out of scope.

## Architecture

A new module `webapp/backend/app/smoke_check.py` exporting one coroutine called from `init_state` after all `app.state` clients are constructed:

```python
async def smoke_check(
    settings: Settings,
    engine: AsyncEngine,
    blob_store: BlobStore,
) -> None
```

Backend-specific verification logic does **not** live in this module. It lives on the backend class itself — e.g. `AzureBlobStore.smoke_check()`. The orchestrator is provider-agnostic and depends only on the `BlobStore` ABC and the SQLAlchemy engine interface.

Failure raises `SmokeCheckError(RuntimeError)`. FastAPI's lifespan propagates it, uvicorn exits non-zero, and the Container Apps revision is marked unhealthy.

## Components

### `app/smoke_check.py` (new)

```python
class SmokeCheckError(RuntimeError): ...

_DB_TIMEOUT_S = 10.0
_BLOB_TIMEOUT_S = 10.0

async def smoke_check(settings, engine, blob_store) -> None:
    # DB
    if ":memory:" in settings.database_url:
        log.info("smoke-check: db SKIPPED (in-memory sqlite)")
    else:
        await _check_db(engine)

    # Blob — dispatch is polymorphic; orchestrator doesn't know about Azure.
    await _check_blob(blob_store)

async def _check_db(engine: AsyncEngine) -> None:
    t0 = time.monotonic()
    try:
        async def _ping():
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

def _safe_repr(e: BaseException) -> str:
    # Trim and avoid surfacing credentials embedded in exception messages.
    return repr(e)[:500]
```

Fail-fast across checks: DB is checked first; if it raises, the blob check is skipped (no point pinging downstream when the primary store is dead, and the first error is more diagnostic).

### `app/storage/blob.py` (modify)

Add a default-no-op `smoke_check()` to the ABC, and an Azure-specific override:

```python
class BlobStore(ABC):
    async def smoke_check(self) -> None:
        """Verify the backend is reachable. Default = no-op."""
        return

class AzureBlobStore(BlobStore):
    async def smoke_check(self) -> None:
        await self._container.get_container_properties()
```

`LocalDirBlobStore` inherits the default no-op. Adding a future backend (S3, GCS) means implementing `smoke_check()` on that class — no edit to `app/smoke_check.py`.

### `app/deps.py` (modify)

Append one call at the end of `init_state`, after all `app.state` assignments:

```python
from app.smoke_check import smoke_check
await smoke_check(settings, engine, app.state.blob_store)
```

## Skip behavior

| Condition                              | DB check | Blob check |
| -------------------------------------- | -------- | ---------- |
| `:memory:` in `database_url` (tests)   | skip     | —          |
| `LocalDirBlobStore` (tests, local dev) | —        | no-op via ABC default |
| Real Postgres + `AzureBlobStore`       | run      | run        |

No env-var toggle. Skipping is a property of the backend in use, not configuration. Existing tests use in-memory SQLite + `LocalDirBlobStore` and therefore hit the skip path with zero fixture changes.

## Error surface

`SmokeCheckError` propagates out of the `lifespan` context manager. uvicorn exits non-zero. Container Apps marks the revision unhealthy and rolls back. The container log stream shows:

```
INFO  smoke-check: db OK (47ms)
ERROR smoke-check: blob FAILED after 10.0s: ClientAuthenticationError("ManagedIdentityCredential authentication unavailable...")
```

Credentials are not logged. `_safe_repr` truncates to 500 chars. A unit test asserts the DB password is not present in the raised message when a connection to a URL-with-password fails.

## Testing

Three new tests in `webapp/backend/tests/test_smoke_check.py`:

1. **`test_smoke_check_skips_local_backends`** — pass an in-memory SQLite engine + a `LocalDirBlobStore`; assert `smoke_check` returns without issuing `SELECT 1`. Verify the skip path by passing an engine whose `.connect()` would raise if called (`unittest.mock.Mock` wrapping it).
2. **`test_smoke_check_db_failure_raises`** — engine pointed at an unreachable Postgres URL (`postgresql+psycopg://user:secret@127.0.0.1:1/x`); assert `SmokeCheckError` raised, message starts with `"db:"`, and `"secret"` not in the message.
3. **`test_smoke_check_blob_failure_raises`** — a fake `BlobStore` subclass whose `smoke_check()` raises `RuntimeError("boom")`; assert `SmokeCheckError` raised with message starting `"blob:"`.

Existing tests (`test_health.py`, `test_e2e.py`, etc.) all use in-memory SQLite + `LocalDirBlobStore` and stay green via the skip path.

**Not covered by automated tests:** the live wiring of `init_state` against real Postgres + Azure Blob. That is the deployment scenario the smoke-check itself exists to validate.

## Branch & PR

Implementation lands on a new branch `startup-credential-smoke-check` cut from `main`.
