import pytest
from sqlalchemy import select

from app.storage.db import create_all, engine_for, session_maker_for
from app.storage.models import Trace


@pytest.mark.asyncio
async def test_trace_has_new_subagent_columns():
    # All four fields default cleanly (one of blob_path / blob_prefix is set
    # in real traces; here we exercise the schema only).
    engine = engine_for("sqlite+aiosqlite:///:memory:")
    await create_all(engine)
    SessionLocal = session_maker_for(engine)

    async with SessionLocal() as db_session:
        trace = Trace(
            short_id="abcdefghij",
            owner_login="alice",
            repo_full_name="alice/repo",
            pr_number=1,
            pr_url="https://github.com/alice/repo/pull/1",
            pr_title="t",
            platform="claude-code",
            byte_size=0,
            message_count=0,
            blob_path="traces/abcdefghij.jsonl",
        )
        db_session.add(trace)
        await db_session.commit()

        row = (
            await db_session.execute(
                select(Trace).where(Trace.short_id == "abcdefghij")
            )
        ).scalar_one()
        assert row.agents is None
        assert row.agent_count == 0
        assert row.blob_prefix is None


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


@pytest.mark.asyncio
async def test_trace_allows_null_repo_and_pr():
    """A standalone trace carries no repo_full_name / pr_number / pr_url."""
    engine = engine_for("sqlite+aiosqlite:///:memory:")
    await create_all(engine)
    SessionLocal = session_maker_for(engine)

    async with SessionLocal() as db_session:
        trace = Trace(
            short_id="standalone1",
            owner_login="alice",
            repo_full_name=None,
            pr_number=None,
            pr_url=None,
            pr_title=None,
            platform="claude-code",
            byte_size=10,
            message_count=1,
            blob_prefix="traces/standalone1/",
            agents=[],
            agent_count=0,
        )
        db_session.add(trace)
        await db_session.commit()

        row = (
            await db_session.execute(
                select(Trace).where(Trace.short_id == "standalone1")
            )
        ).scalar_one()
        assert row.repo_full_name is None
        assert row.pr_number is None
        assert row.pr_url is None
