from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from app.auth.sessions import (
    SESSION_COOKIE_NAME,
    get_current_user,
)
from app.storage.models import User


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/me")
async def me(
    response: Response,
    user: User | None = Depends(get_current_user),
):
    if user is None:
        # Clear any stale cookie a misbehaving client may still be sending.
        response.delete_cookie(SESSION_COOKIE_NAME, path="/")
        response.status_code = 204
        return None
    return {
        "id": str(user.id),
        "login": user.github_login,
        "name": user.name,
        "avatar_url": user.avatar_url,
    }
