from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth.crypto import TokenCipher
from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.settings import get_settings
from app.storage.models import User


async def _seed_user(SessionLocal, *, github_id: int, login: str,
                    access_token: str = "gho_test") -> User:
    cipher = TokenCipher(get_settings().token_encryption_key)
    async with SessionLocal() as session:
        user = User(
            github_id=github_id,
            github_login=login,
            name=login.title(),
            avatar_url=f"https://avatars/{login}.png",
            email=None,
            encrypted_access_token=cipher.encrypt(access_token),
            token_scopes="read:user,user:email",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


async def _create_session(SessionLocal, user_id) -> str:
    async with SessionLocal() as session:
        sid = await create_session(session, user_id)
        await session.commit()
        return sid


async def authed_cookies(client: TestClient, *, github_id: int = 100,
                         login: str = "alice", access_token: str = "gho_user"):
    """Seed a User + UserSession and return a cookies dict for TestClient."""
    SessionLocal = client.app.state.session_maker
    user = await _seed_user(
        SessionLocal, github_id=github_id, login=login,
        access_token=access_token,
    )
    sid = await _create_session(SessionLocal, user.id)
    return {SESSION_COOKIE_NAME: sid}, user
