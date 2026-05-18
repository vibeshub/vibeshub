from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy import delete, event, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_session
from app.storage.models import User, UserSession


SESSION_COOKIE_NAME = "vibeshub_session"
DEFAULT_SESSION_TTL_DAYS = 30
LAST_SEEN_THROTTLE = timedelta(minutes=5)


# SQLite (used in tests and local dev) silently strips tzinfo even when the
# column is declared DateTime(timezone=True); Postgres preserves it. Coerce
# the timestamps to aware UTC on load so comparisons against
# datetime.now(timezone.utc) always work.
@event.listens_for(UserSession, "load")
def _ensure_utc(target: UserSession, _context: object) -> None:
    if target.expires_at is not None and target.expires_at.tzinfo is None:
        target.expires_at = target.expires_at.replace(tzinfo=timezone.utc)
    if target.last_seen_at is not None and target.last_seen_at.tzinfo is None:
        target.last_seen_at = target.last_seen_at.replace(tzinfo=timezone.utc)
    if target.created_at is not None and target.created_at.tzinfo is None:
        target.created_at = target.created_at.replace(tzinfo=timezone.utc)


def new_session_id() -> str:
    return secrets.token_urlsafe(32)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def create_session(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    ttl_days: int = DEFAULT_SESSION_TTL_DAYS,
) -> str:
    sid = new_session_id()
    row = UserSession(
        id=sid,
        user_id=user_id,
        expires_at=_utcnow() + timedelta(days=ttl_days),
    )
    session.add(row)
    return sid


async def delete_session(session: AsyncSession, sid: str) -> None:
    await session.execute(delete(UserSession).where(UserSession.id == sid))


async def load_user_by_session(
    session: AsyncSession, sid: str
) -> Optional[User]:
    """Return the User for `sid` if the session exists and is unexpired.

    Side effect: if `last_seen_at` is older than LAST_SEEN_THROTTLE, refresh
    it AND bump `expires_at = now + 30d` (sliding session). The caller is
    responsible for committing.
    """
    row = (await session.execute(
        select(UserSession).where(UserSession.id == sid)
    )).scalar_one_or_none()
    if row is None:
        return None

    now = _utcnow()
    if row.expires_at <= now:
        return None

    if now - row.last_seen_at >= LAST_SEEN_THROTTLE:
        row.last_seen_at = now
        row.expires_at = now + timedelta(days=DEFAULT_SESSION_TTL_DAYS)

    return (await session.execute(
        select(User).where(User.id == row.user_id)
    )).scalar_one_or_none()


async def get_current_user(
    session: AsyncSession = Depends(get_session),
    sid: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> User | None:
    if not sid:
        return None
    user = await load_user_by_session(session, sid)
    # Commit any sliding-window writes from load_user_by_session.
    await session.commit()
    return user


async def require_current_user(
    user: User | None = Depends(get_current_user),
) -> User:
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return user
