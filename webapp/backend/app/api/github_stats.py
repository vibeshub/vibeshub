from __future__ import annotations

import logging
from time import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.auth.crypto import TokenCipher
from app.auth.sessions import get_current_user
from app.deps import get_app_settings, get_public_github
from app.github.public_client import (
    GitHubAuthError,
    GitHubNotFound,
    GitHubRateLimited,
    GitHubUpstreamError,
    PublicGitHubClient,
)
from app.settings import Settings
from app.storage.models import User


log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/github", tags=["github-stats"])


def _viewer_token(user: User | None, settings: Settings) -> str | None:
    if user is None:
        return None
    cipher = TokenCipher(settings.token_encryption_key)
    # If decryption fails (most likely cause: encryption-key rotation where
    # this user's ciphertext was encrypted under an old key not in the
    # current MultiFernet), fall back to anonymous so the request still
    # succeeds. Key rotation MUST re-encrypt all tokens before old keys
    # are dropped — this log line is the signal that didn't happen.
    try:
        return cipher.decrypt(user.encrypted_access_token)
    except Exception:
        log.error(
            "github_stats viewer_token decrypt failed user_id=%s",
            user.id,
        )
        return None


def _handle_errors(exc: Exception, *, not_found_detail: str) -> HTTPException:
    if isinstance(exc, GitHubNotFound):
        return HTTPException(status_code=404, detail=not_found_detail)
    if isinstance(exc, GitHubRateLimited):
        retry = max(0, exc.reset_at_epoch - int(time()))
        return HTTPException(
            status_code=503,
            detail="github_rate_limited",
            headers={"Retry-After": str(retry)},
        )
    if isinstance(exc, GitHubAuthError):
        return HTTPException(status_code=502, detail="github_upstream_error")
    if isinstance(exc, GitHubUpstreamError):
        return HTTPException(status_code=502, detail="github_upstream_error")
    log.exception("github_stats unexpected error: %s", type(exc).__name__)
    return HTTPException(status_code=500, detail="internal_error")


@router.get("/repos/{owner}/{name}")
async def get_repo(
    owner: str,
    name: str,
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
    gh: PublicGitHubClient = Depends(get_public_github),
):
    if not settings.github_fallback_token and user is None:
        raise HTTPException(status_code=503, detail="github_not_configured")
    try:
        payload: Any = await gh.get_json(
            f"/repos/{owner}/{name}",
            viewer_token=_viewer_token(user, settings),
        )
    except Exception as exc:
        raise _handle_errors(exc, not_found_detail="repo_not_found") from exc
    return _project_repo(payload)


def _project_repo(p: dict) -> dict:
    license_obj = p.get("license") or {}
    return {
        "full_name": p["full_name"],
        "name": p["name"],
        "description": p.get("description"),
        "html_url": p["html_url"],
        "default_branch": p.get("default_branch"),
        "stargazers_count": p.get("stargazers_count", 0),
        "forks_count": p.get("forks_count", 0),
        "watchers_count": p.get("watchers_count", 0),
        "open_issues_count": p.get("open_issues_count", 0),
        "primary_language": p.get("language"),
        "license_spdx": license_obj.get("spdx_id"),
        "topics": p.get("topics", []),
        "created_at": p.get("created_at"),
        "updated_at": p.get("updated_at"),
    }


def _has_next_from_link(link_header: str | None) -> bool:
    if not link_header:
        return False
    return 'rel="next"' in link_header


def _project_repo_list_item(p: dict) -> dict:
    return {
        "name": p["name"],
        "description": p.get("description"),
        "html_url": p["html_url"],
        "stargazers_count": p.get("stargazers_count", 0),
        "forks_count": p.get("forks_count", 0),
        "language": p.get("language"),
        "pushed_at": p.get("pushed_at"),
    }


@router.get("/users/{login}/repos")
async def list_user_repos(
    login: str,
    page: int = 1,
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
    gh: PublicGitHubClient = Depends(get_public_github),
):
    if not settings.github_fallback_token and user is None:
        raise HTTPException(status_code=503, detail="github_not_configured")
    page = max(1, min(page, 100))
    try:
        payload, link = await gh.get_json_with_link(
            f"/users/{login}/repos",
            viewer_token=_viewer_token(user, settings),
            params={"sort": "pushed", "per_page": 30, "page": page},
        )
    except Exception as exc:
        raise _handle_errors(exc, not_found_detail="user_not_found") from exc
    return {
        "repos": [_project_repo_list_item(p) for p in payload],
        "has_next": _has_next_from_link(link),
    }
