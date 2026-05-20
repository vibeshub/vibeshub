from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import select

from app.storage.blob import LocalDirBlobStore
from app.storage.db import create_all, engine_for, session_maker_for
from app.storage.models import Trace
from scripts.recount_messages import load_env_file, recount_one, run_recount

# A 3-line transcript that renders 2 messages: a streamed assistant message
# (text block, then text + tool_use) plus a tool_result user line.
TRANSCRIPT_2 = (
    b'{"type":"assistant","message":{"id":"m1","content":'
    b'[{"type":"text","text":"hi"}]}}\n'
    b'{"type":"assistant","message":{"id":"m1","content":'
    b'[{"type":"text","text":"hi"},'
    b'{"type":"tool_use","id":"t1","name":"Bash","input":{}}]}}\n'
    b'{"type":"user","message":{"content":'
    b'[{"type":"tool_result","tool_use_id":"t1"}]}}\n'
)


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
def make_v2_trace(db_session, blob_store):
    """Insert a v2-layout Trace (blob_prefix set) with stale message counts."""
    async def _make(
        short_id: str,
        *,
        stored_main: int,
        agents: list[tuple[str, int]] | None = None,
    ) -> Trace:
        prefix = f"traces/{short_id}/"
        await blob_store.put(f"{prefix}main.jsonl", TRANSCRIPT_2)
        agent_dicts: list[dict] = []
        for agent_id, stored_count in agents or []:
            await blob_store.put(f"{prefix}agents/{agent_id}.jsonl", TRANSCRIPT_2)
            agent_dicts.append({
                "agent_id": agent_id,
                "tool_use_id": "toolu_01x",
                "agent_type": "Explore",
                "description": "d",
                "message_count": stored_count,
            })
        trace = Trace(
            short_id=short_id,
            owner_login="alice",
            repo_full_name="alice/repo",
            pr_number=1,
            pr_url="https://github.com/alice/repo/pull/1",
            pr_title="t",
            platform="claude-code",
            byte_size=len(TRANSCRIPT_2),
            message_count=stored_main,
            blob_prefix=prefix,
            agents=agent_dicts,
            agent_count=len(agent_dicts),
        )
        db_session.add(trace)
        await db_session.commit()
        return trace
    return _make


@pytest.mark.asyncio
async def test_recount_one_fixes_stale_main_count(db_session, blob_store, make_v2_trace):
    trace = await make_v2_trace("abcdefghij", stored_main=99)

    changed = await recount_one(blob_store, trace)
    await db_session.commit()

    assert changed is True
    refreshed = (
        await db_session.execute(select(Trace).where(Trace.short_id == "abcdefghij"))
    ).scalar_one()
    assert refreshed.message_count == 2


@pytest.mark.asyncio
async def test_recount_one_fixes_stale_agent_count(db_session, blob_store, make_v2_trace):
    aid = "a0123456789abcdef"
    trace = await make_v2_trace("abcdefghij", stored_main=2, agents=[(aid, 17)])

    changed = await recount_one(blob_store, trace)
    await db_session.commit()

    assert changed is True
    refreshed = (
        await db_session.execute(select(Trace).where(Trace.short_id == "abcdefghij"))
    ).scalar_one()
    assert refreshed.message_count == 2
    assert refreshed.agents == [{
        "agent_id": aid,
        "tool_use_id": "toolu_01x",
        "agent_type": "Explore",
        "description": "d",
        "message_count": 2,
    }]


@pytest.mark.asyncio
async def test_recount_one_noop_when_already_correct(db_session, blob_store, make_v2_trace):
    aid = "a0123456789abcdef"
    trace = await make_v2_trace("abcdefghij", stored_main=2, agents=[(aid, 2)])

    changed = await recount_one(blob_store, trace)

    assert changed is False


@pytest.mark.asyncio
async def test_recount_one_handles_legacy_blob_path(db_session, blob_store):
    """Legacy v1 rows store the transcript at blob_path with blob_prefix null."""
    await blob_store.put("traces/legacyrowr.jsonl", TRANSCRIPT_2)
    trace = Trace(
        short_id="legacyrowr",
        owner_login="alice",
        repo_full_name="alice/repo",
        pr_number=1,
        pr_url="https://github.com/alice/repo/pull/1",
        pr_title="t",
        platform="claude-code",
        byte_size=len(TRANSCRIPT_2),
        message_count=88,
        blob_path="traces/legacyrowr.jsonl",
    )
    db_session.add(trace)
    await db_session.commit()

    changed = await recount_one(blob_store, trace)
    await db_session.commit()

    assert changed is True
    assert trace.message_count == 2


@pytest.mark.asyncio
async def test_run_recount_dry_run_writes_nothing(db_session, blob_store, make_v2_trace):
    await make_v2_trace("abcdefghij", stored_main=99)

    summary = await run_recount(db_session, blob_store, dry_run=True)

    assert summary.would_update == 1
    assert summary.updated == 0
    refreshed = (
        await db_session.execute(select(Trace).where(Trace.short_id == "abcdefghij"))
    ).scalar_one()
    assert refreshed.message_count == 99


@pytest.mark.asyncio
async def test_run_recount_updates_stale_and_skips_correct(db_session, blob_store, make_v2_trace):
    await make_v2_trace("staaaaaaaa", stored_main=99)
    await make_v2_trace("okokokokok", stored_main=2)

    summary = await run_recount(db_session, blob_store, dry_run=False)

    assert summary.updated == 1
    assert summary.unchanged == 1
    refreshed = (
        await db_session.execute(select(Trace).where(Trace.short_id == "staaaaaaaa"))
    ).scalar_one()
    assert refreshed.message_count == 2


@pytest.mark.asyncio
async def test_run_recount_counts_failure_on_missing_blob(db_session, blob_store, make_v2_trace):
    trace = await make_v2_trace("abcdefghij", stored_main=99)
    await blob_store.delete(f"{trace.blob_prefix}main.jsonl")

    summary = await run_recount(db_session, blob_store, dry_run=False)

    assert summary.failed == 1
    assert summary.updated == 0


def test_load_env_file_parses_and_respects_real_env(tmp_path: Path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text(
        "# a comment\n"
        "\n"
        'VIBESHUB_DATABASE_URL="postgresql://from-file"\n'
        "VIBESHUB_PUBLIC_BASE_URL=https://from-file\n",
        encoding="utf-8",
    )
    # A var already in the real environment must win over the file.
    monkeypatch.setenv("VIBESHUB_PUBLIC_BASE_URL", "https://from-env")
    monkeypatch.delenv("VIBESHUB_DATABASE_URL", raising=False)

    applied = load_env_file(env)

    assert applied == 1
    import os
    assert os.environ["VIBESHUB_DATABASE_URL"] == "postgresql://from-file"
    assert os.environ["VIBESHUB_PUBLIC_BASE_URL"] == "https://from-env"


def test_load_env_file_missing_raises(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        load_env_file(tmp_path / "nonexistent.env")
