from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.auth.sessions import (
    SESSION_COOKIE_NAME,
    create_session,
    delete_session,
    load_user_by_session,
    new_session_id,
)
from app.storage.models import User, UserSession


@pytest.mark.asyncio
async def test_new_session_id_is_urlsafe_and_long_enough():
    sid = new_session_id()
    assert isinstance(sid, str)
    # token_urlsafe(32) -> 43 chars; never exceeds 64.
    assert 40 <= len(sid) <= 64


@pytest.mark.asyncio
async def test_create_load_delete_session(client):
    # Reach into the app's session maker to set up data directly.
    app = client.app
    SessionLocal = app.state.session_maker

    async with SessionLocal() as session:
        user = User(
            github_id=1,
            github_login="alice",
            encrypted_access_token="ct",
            token_scopes="read:user",
        )
        session.add(user)
        await session.flush()

        sid = await create_session(session, user.id, ttl_days=30)
        await session.commit()

    # Load it back
    async with SessionLocal() as session:
        loaded = await load_user_by_session(session, sid)
        assert loaded is not None
        assert loaded.github_login == "alice"

    # Delete and confirm gone
    async with SessionLocal() as session:
        await delete_session(session, sid)
        await session.commit()
        loaded = await load_user_by_session(session, sid)
        assert loaded is None


@pytest.mark.asyncio
async def test_load_user_by_session_expired_returns_none(client):
    app = client.app
    SessionLocal = app.state.session_maker

    async with SessionLocal() as session:
        user = User(
            github_id=2,
            github_login="bob",
            encrypted_access_token="ct",
        )
        session.add(user)
        await session.flush()

        expired = UserSession(
            id="sess_expired",
            user_id=user.id,
            expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
        )
        session.add(expired)
        await session.commit()

    async with SessionLocal() as session:
        assert await load_user_by_session(session, "sess_expired") is None


@pytest.mark.asyncio
async def test_load_user_slides_expiry_after_throttle_window(client):
    app = client.app
    SessionLocal = app.state.session_maker

    async with SessionLocal() as session:
        user = User(
            github_id=3,
            github_login="carol",
            encrypted_access_token="ct",
        )
        session.add(user)
        await session.flush()

        old_seen = datetime.now(timezone.utc) - timedelta(minutes=10)
        s = UserSession(
            id="sess_slide",
            user_id=user.id,
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            last_seen_at=old_seen,
        )
        session.add(s)
        await session.commit()

    async with SessionLocal() as session:
        await load_user_by_session(session, "sess_slide")
        await session.commit()

    async with SessionLocal() as session:
        s = (await session.execute(
            select(UserSession).where(UserSession.id == "sess_slide")
        )).scalar_one()
        # expires_at extended to ~30d out
        assert s.expires_at > datetime.now(timezone.utc) + timedelta(days=29)
