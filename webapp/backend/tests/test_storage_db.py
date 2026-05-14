import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.storage.db import engine_for, session_maker_for, create_all
from app.storage.models import Trace


@pytest.mark.asyncio
async def test_session_can_persist_trace():
    engine = engine_for("sqlite+aiosqlite:///:memory:")
    await create_all(engine)
    SessionLocal = session_maker_for(engine)

    async with SessionLocal() as session:
        trace = Trace(
            short_id="abc1234567",
            owner_login="alice",
            repo_full_name="alice/repo",
            pr_number=1,
            pr_url="https://github.com/alice/repo/pull/1",
            platform="claude-code",
            byte_size=100,
            message_count=5,
            blob_path="traces/abc1234567.jsonl",
        )
        session.add(trace)
        await session.commit()

        result = await session.get(Trace, trace.id)
        assert result is not None
        assert result.owner_login == "alice"
