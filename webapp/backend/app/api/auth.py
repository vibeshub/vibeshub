from __future__ import annotations

import logging
from urllib.parse import urlparse

import httpx
from authlib.integrations.base_client.errors import MismatchingStateError
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.crypto import TokenCipher
from app.auth.scopes import has_repo_scope
from app.auth.sessions import (
    DEFAULT_SESSION_TTL_DAYS,
    SESSION_COOKIE_NAME,
    create_session,
    delete_session,
    get_current_user,
)
from app.deps import get_app_settings, get_session
from app.settings import Settings
from app.storage.models import Trace, User


log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


# The minimal scope is fixed in app/auth/oauth.py's client registration.
# A `?scope=private` login additionally requests classic `repo` — the only
# scope a classic OAuth App can use to read private repos (it also grants
# write; vibeshub never calls a write endpoint).
PRIVATE_SCOPE = "read:user user:email repo"


# --- helpers ----------------------------------------------------------------


def _validated_next(next_value: str | None) -> str:
    """Accept only same-origin paths. Anything else falls back to '/'."""
    if not next_value:
        return "/"
    if "\\" in next_value:
        return "/"
    if not next_value.startswith("/") or next_value.startswith("//"):
        return "/"
    parsed = urlparse(next_value)
    if parsed.scheme or parsed.netloc:
        return "/"
    return next_value


def _require_oauth_configured(settings: Settings) -> None:
    if not settings.github_oauth_client_id or not settings.session_secret:
        raise HTTPException(status_code=503, detail="oauth_not_configured")


def _set_session_cookie(response: Response, sid: str, *, secure: bool) -> None:
    response.set_cookie(
        SESSION_COOKIE_NAME,
        sid,
        max_age=DEFAULT_SESSION_TTL_DAYS * 24 * 60 * 60,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )


# --- routes -----------------------------------------------------------------


def _displaced_login(github_id: int) -> str:
    """Placeholder login for a user whose GitHub login was taken by someone
    else. A leading hyphen is invalid on GitHub, so it can never collide with
    a real login; it is replaced on that user's next sign-in."""
    return f"-displaced-{github_id}"


async def _repoint_trace_owner(
    session: AsyncSession, old_login: str, new_login: str
) -> None:
    """Trace ownership is keyed on the mutable github_login. Whenever a
    user's login changes, carry their traces along so they neither lose
    them nor hand them to whoever takes the old login next."""
    await session.execute(
        update(Trace)
        .where(Trace.owner_login == old_login)
        .values(owner_login=new_login)
    )


async def _upsert_user(
    session: AsyncSession,
    profile: dict,
    primary_email: str | None,
    encrypted_access_token: str,
    scopes_str: str,
) -> User:
    github_id = profile["id"]
    login = profile["login"]

    # GitHub logins are reusable: if another row still holds this login
    # (its owner renamed and hasn't signed in since), evict it first, or
    # the unique index fails and this user can never log in. Their traces
    # follow the placeholder so the new holder of the login doesn't
    # inherit them.
    holder = (await session.execute(
        select(User).where(
            User.github_login == login, User.github_id != github_id
        )
    )).scalar_one_or_none()
    if holder is not None:
        placeholder = _displaced_login(holder.github_id)
        log.warning(
            "auth.login.displaced login=%s from_github_id=%s to_github_id=%s",
            login, holder.github_id, github_id,
        )
        holder.github_login = placeholder
        await session.flush()
        await _repoint_trace_owner(session, login, placeholder)

    existing = (await session.execute(
        select(User).where(User.github_id == github_id)
    )).scalar_one_or_none()
    if existing is None:
        existing = User(
            github_id=github_id,
            github_login=login,
            name=profile.get("name"),
            avatar_url=profile.get("avatar_url"),
            email=primary_email,
            encrypted_access_token=encrypted_access_token,
            token_scopes=scopes_str,
        )
        session.add(existing)
        await session.flush()
        return existing

    old_login = existing.github_login
    existing.github_login = login
    existing.name = profile.get("name")
    existing.avatar_url = profile.get("avatar_url")
    existing.email = primary_email
    existing.encrypted_access_token = encrypted_access_token
    existing.token_scopes = scopes_str
    await session.flush()
    if old_login != login:
        await _repoint_trace_owner(session, old_login, login)
    return existing


@router.get("/me")
async def me(
    response: Response,
    settings: Settings = Depends(get_app_settings),
    user: User | None = Depends(get_current_user),
):
    response.headers["Cache-Control"] = "no-store"
    if user is None:
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
        "has_private_access": has_repo_scope(user),
    }


@router.get("/github/login")
async def github_login(
    request: Request,
    next: str | None = None,
    scope: str | None = None,
    settings: Settings = Depends(get_app_settings),
):
    _require_oauth_configured(settings)
    request.session["next_path"] = _validated_next(next)
    oauth = request.app.state.oauth
    redirect_uri = settings.public_base_url.rstrip("/") + "/api/auth/github/callback"
    log.info("auth.login.start scope=%s", "private" if scope == "private" else "default")
    if scope == "private":
        return await oauth.github.authorize_redirect(
            request, redirect_uri, scope=PRIVATE_SCOPE
        )
    return await oauth.github.authorize_redirect(request, redirect_uri)


@router.get("/github/callback")
async def github_callback(
    request: Request,
    settings: Settings = Depends(get_app_settings),
    session: AsyncSession = Depends(get_session),
):
    _require_oauth_configured(settings)
    next_path = _validated_next(request.session.pop("next_path", "/"))

    # User clicked "Cancel" on GitHub's consent screen.
    if request.query_params.get("error"):
        log.info("auth.login.failure reason=user_denied")
        return RedirectResponse(url="/?auth_error=denied", status_code=303)

    oauth = request.app.state.oauth
    try:
        token = await oauth.github.authorize_access_token(request)
    except MismatchingStateError:
        log.info("auth.login.failure reason=state_mismatch")
        return RedirectResponse(
            url="/?auth_error=state_mismatch", status_code=303
        )
    except Exception as exc:
        log.warning(
            "auth.login.failure reason=github_error err=%s",
            type(exc).__name__,
        )
        return RedirectResponse(url="/?auth_error=github_error", status_code=303)

    access_token = token.get("access_token")
    scopes_str = token.get("scope") or ""

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    api_base = settings.github_api_base.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
            user_resp = await http.get(f"{api_base}/user", headers=headers)
            user_resp.raise_for_status()
            profile = user_resp.json()
            emails: list[dict] = []
            try:
                emails_resp = await http.get(
                    f"{api_base}/user/emails", headers=headers
                )
                if emails_resp.status_code == 200:
                    emails = emails_resp.json()
            except httpx.HTTPError:
                emails = []
    except httpx.HTTPError as exc:
        log.warning("auth.login.failure reason=profile_fetch err=%s", exc)
        return RedirectResponse(url="/?auth_error=github_error", status_code=303)

    primary_email = next(
        (e["email"] for e in emails if e.get("primary") and e.get("verified")),
        None,
    )

    cipher = TokenCipher(settings.token_encryption_key)
    encrypted = cipher.encrypt(access_token)
    try:
        existing = await _upsert_user(
            session, profile, primary_email, encrypted, scopes_str,
        )
    except IntegrityError:
        # A concurrent callback for the same github_id won the insert race.
        # Roll back our pending insert and redo the upsert against the row
        # that now exists.
        await session.rollback()
        existing = await _upsert_user(
            session, profile, primary_email, encrypted, scopes_str,
        )

    sid = await create_session(session, existing.id)
    await session.commit()

    response = RedirectResponse(url=next_path, status_code=303)
    _set_session_cookie(response, sid, secure=settings.cookie_secure)
    log.info(
        "auth.login.success github_id=%s login=%s",
        profile["id"], profile["login"],
    )
    return response


@router.post("/logout", status_code=204)
async def logout(
    response: Response,
    settings: Settings = Depends(get_app_settings),
    sid: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    session: AsyncSession = Depends(get_session),
):
    if sid:
        await delete_session(session, sid)
        await session.commit()
        log.info("auth.logout")
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        path="/",
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
    )
    return None
