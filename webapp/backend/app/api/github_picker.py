from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from app.api.github_stats import _handle_errors, _viewer_token
from app.auth.sessions import get_current_user
from app.deps import get_app_settings, get_public_github
from app.github.public_client import PublicGitHubClient
from app.settings import Settings
from app.storage.models import User


log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/github", tags=["github-picker"])


@router.get("/my-repos")
async def my_repos(
    q: str | None = None,
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
    gh: PublicGitHubClient = Depends(get_public_github),
):
    if user is None:
        raise HTTPException(status_code=403, detail="auth_required")
    token = _viewer_token(user, settings)
    if token is None:
        raise HTTPException(
            status_code=403, detail="github_token_unavailable"
        )
    try:
        payload = await gh.get_json(
            "/user/repos",
            viewer_token=token,
            params={"per_page": 100, "sort": "pushed", "affiliation":
                    "owner,collaborator"},
        )
    except Exception as exc:
        raise _handle_errors(exc, not_found_detail="repo_not_found") from exc

    needle = (q or "").strip().lower()
    repos = [
        {
            "full_name": r["full_name"],
            "name": r["name"],
            "private": bool(r.get("private", False)),
        }
        for r in payload
        if not needle or needle in r["full_name"].lower()
    ]
    return {"repos": repos}


@router.get("/repo-prs")
async def repo_prs(
    repo: str,
    q: str | None = None,
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
    gh: PublicGitHubClient = Depends(get_public_github),
):
    if user is None:
        raise HTTPException(status_code=403, detail="auth_required")
    token = _viewer_token(user, settings)
    if token is None:
        raise HTTPException(
            status_code=403, detail="github_token_unavailable"
        )
    parts = repo.strip().split("/")
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise HTTPException(status_code=400, detail=f"invalid repo: {repo}")
    owner, name = parts
    try:
        payload = await gh.get_json(
            f"/repos/{owner}/{name}/pulls",
            viewer_token=token,
            params={"state": "all", "per_page": 100, "sort": "updated",
                    "direction": "desc"},
        )
    except Exception as exc:
        raise _handle_errors(exc, not_found_detail="repo_not_found") from exc

    needle = (q or "").strip().lower()
    prs = [
        {
            "number": p["number"],
            "title": p.get("title") or "",
            "html_url": p["html_url"],
        }
        for p in payload
        if (p.get("user") or {}).get("login") == user.github_login
        and (not needle or needle in (p.get("title") or "").lower())
    ]
    return {"prs": prs}
