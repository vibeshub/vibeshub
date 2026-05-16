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
