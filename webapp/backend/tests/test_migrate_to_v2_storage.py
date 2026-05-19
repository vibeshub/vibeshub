from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import select

from app.storage.blob import LocalDirBlobStore
from app.storage.db import create_all, engine_for, session_maker_for
from app.storage.models import Trace
from scripts.migrate_to_v2_storage import migrate_one, run_migration


@pytest.fixture
async def db_session():
    engine = engine_for("sqlite+aiosqlite:///:memory:")
    await create_all(engine)
    SessionLocal = session_maker_for(engine)
    async with SessionLocal() as session:
        yield session
    await engine.dispose()


@pytest.fixture
def blob_store(tmp_path: Path) -> LocalDirBlobStore:
    return LocalDirBlobStore(root=tmp_path / "blobs")


@pytest.fixture
def make_legacy_trace(db_session, blob_store):
    """Insert a Trace row in v1 layout (blob_path set, blob_prefix null)."""
    async def _make(short_id: str, body: bytes = b'{"type":"user"}\n') -> Trace:
        await blob_store.put(f"traces/{short_id}.jsonl", body)
        trace = Trace(
            short_id=short_id,
            owner_login="alice",
            repo_full_name="alice/repo",
            pr_number=1,
            pr_url="https://github.com/alice/repo/pull/1",
            pr_title="t",
            platform="claude-code",
            byte_size=len(body),
            message_count=1,
            blob_path=f"traces/{short_id}.jsonl",
        )
        db_session.add(trace)
        await db_session.commit()
        return trace
    return _make


@pytest.mark.asyncio
async def test_migrate_one_moves_blob_and_updates_row(db_session, blob_store, make_legacy_trace):
    body = b'{"type":"user","content":"hi"}\n'
    trace = await make_legacy_trace("abcdefghij", body)

    await migrate_one(db_session, blob_store, trace)
    await db_session.commit()

    # New blob in place
    assert await blob_store.get("traces/abcdefghij/main.jsonl") == body
    # Row updated
    refreshed = (
        await db_session.execute(select(Trace).where(Trace.short_id == "abcdefghij"))
    ).scalar_one()
    assert refreshed.blob_prefix == "traces/abcdefghij/"
    assert refreshed.blob_path is None
    assert refreshed.agents == []
    assert refreshed.agent_count == 0


@pytest.mark.asyncio
async def test_migrate_one_is_idempotent(db_session, blob_store, make_legacy_trace):
    trace = await make_legacy_trace("abcdefghij")
    await migrate_one(db_session, blob_store, trace)
    await db_session.commit()

    # Second call must no-op
    await migrate_one(db_session, blob_store, trace)
    await db_session.commit()

    refreshed = (
        await db_session.execute(select(Trace).where(Trace.short_id == "abcdefghij"))
    ).scalar_one()
    assert refreshed.blob_prefix == "traces/abcdefghij/"


@pytest.mark.asyncio
async def test_run_migration_dry_run_writes_nothing(db_session, blob_store, make_legacy_trace):
    await make_legacy_trace("abcdefghij")

    summary = await run_migration(db_session, blob_store, dry_run=True)

    # Nothing changed in storage or DB
    refreshed = (
        await db_session.execute(select(Trace).where(Trace.short_id == "abcdefghij"))
    ).scalar_one()
    assert refreshed.blob_prefix is None
    assert refreshed.blob_path == "traces/abcdefghij.jsonl"
    # But the summary reports the work that *would* happen
    assert summary.would_migrate == 1
    assert summary.already_migrated == 0


@pytest.mark.asyncio
async def test_run_migration_processes_all_rows(db_session, blob_store, make_legacy_trace):
    await make_legacy_trace("aaaaaaaaaa")
    await make_legacy_trace("bbbbbbbbbb")

    summary = await run_migration(db_session, blob_store, dry_run=False)

    assert summary.migrated == 2
    for sid in ("aaaaaaaaaa", "bbbbbbbbbb"):
        refreshed = (
            await db_session.execute(select(Trace).where(Trace.short_id == sid))
        ).scalar_one()
        assert refreshed.blob_prefix == f"traces/{sid}/"


@pytest.mark.asyncio
async def test_run_migration_continues_when_cleanup_fails(db_session, blob_store, make_legacy_trace, monkeypatch):
    """A flaky cleanup on the first row must not abort the second row."""
    await make_legacy_trace("aaaaaaaaaa")
    await make_legacy_trace("bbbbbbbbbb")

    real_delete = blob_store.delete
    deleted: list[str] = []
    async def flaky_delete(key: str) -> None:
        deleted.append(key)
        if key == "traces/aaaaaaaaaa.jsonl":
            raise RuntimeError("transient backend error")
        await real_delete(key)
    monkeypatch.setattr(blob_store, "delete", flaky_delete)

    summary = await run_migration(db_session, blob_store, dry_run=False)

    assert summary.migrated == 2
    # Both delete attempts ran (cleanup did not abort on first failure)
    assert "traces/aaaaaaaaaa.jsonl" in deleted
    assert "traces/bbbbbbbbbb.jsonl" in deleted
