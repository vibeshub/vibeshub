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
