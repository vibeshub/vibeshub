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
