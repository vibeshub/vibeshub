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
