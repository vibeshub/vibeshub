from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from app.auth.sessions import (
    SESSION_COOKIE_NAME,
    get_current_user,
)
from app.deps import get_app_settings
from app.settings import Settings
from app.storage.models import User


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/me")
async def me(
    response: Response,
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
):
    response.headers["Cache-Control"] = "no-store"
    if user is None:
        # Clear any stale cookie a misbehaving client may still be sending.
        # Mirror the attributes used when setting the cookie so browsers
        # correctly overwrite a Secure/SameSite=Lax cookie.
        response.delete_cookie(
            SESSION_COOKIE_NAME,
            path="/",
            httponly=True,
            samesite="lax",
            secure=settings.cookie_secure,
        )
        response.status_code = 204
        return None
    return {
        "id": str(user.id),
        "login": user.github_login,
        "name": user.name,
        "avatar_url": user.avatar_url,
    }
