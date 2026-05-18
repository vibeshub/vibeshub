from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.storage.db import create_all, engine_for, session_maker_for
from app.storage.models import Trace, User, UserSession


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
async def test_user_session_persistence():
    engine = engine_for("sqlite+aiosqlite:///:memory:")
    await create_all(engine)
    SessionLocal = session_maker_for(engine)

    async with SessionLocal() as session:
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


@pytest.mark.asyncio
async def test_user_github_id_is_unique():
    engine = engine_for("sqlite+aiosqlite:///:memory:")
    await create_all(engine)
    SessionLocal = session_maker_for(engine)

    async with SessionLocal() as session:
        session.add(
            User(
                github_id=99,
                github_login="alice",
                encrypted_access_token="ct1",
            )
        )
        session.add(
            User(
                github_id=99,
                github_login="bob",
                encrypted_access_token="ct2",
            )
        )
        with pytest.raises(IntegrityError):
            await session.commit()
