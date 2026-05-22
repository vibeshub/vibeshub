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


MAX_STAR_AGG_PAGES = 3
STAR_AGG_PER_PAGE = 100


@router.get("/users/{login}")
async def get_user(
    login: str,
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
    gh: PublicGitHubClient = Depends(get_public_github),
):
    if not settings.github_fallback_token and user is None:
        raise HTTPException(status_code=503, detail="github_not_configured")
    token = _viewer_token(user, settings)
    try:
        profile = await gh.get_json(f"/users/{login}", viewer_token=token)
    except Exception as exc:
        raise _handle_errors(exc, not_found_detail="user_not_found") from exc

    total_stars = 0
    lang_counts: dict[str, int] = {}
    stars_truncated = False

    public_repos = int(profile.get("public_repos", 0) or 0)
    if public_repos > 0:
        try:
            for page in range(1, MAX_STAR_AGG_PAGES + 1):
                items = await gh.get_json(
                    f"/users/{login}/repos",
                    viewer_token=token,
                    params={
                        "sort": "pushed",
                        "per_page": STAR_AGG_PER_PAGE,
                        "page": page,
                    },
                )
                if not items:
                    break
                for repo in items:
                    total_stars += int(repo.get("stargazers_count", 0) or 0)
                    lang = repo.get("language")
                    if lang:
                        lang_counts[lang] = lang_counts.get(lang, 0) + 1
                if len(items) < STAR_AGG_PER_PAGE:
                    break
            else:
                # Hit the cap. If GitHub reports more than we walked, mark truncated.
                if public_repos > MAX_STAR_AGG_PAGES * STAR_AGG_PER_PAGE:
                    stars_truncated = True
        except Exception as exc:
            raise _handle_errors(exc, not_found_detail="user_not_found") from exc

    top_languages = [
        lang for lang, _count in sorted(
            lang_counts.items(), key=lambda kv: (-kv[1], kv[0])
        )
    ][:3]

    return {
        "login": profile["login"],
        "name": profile.get("name"),
        "bio": profile.get("bio"),
        "avatar_url": profile.get("avatar_url"),
        "html_url": profile["html_url"],
        "followers": profile.get("followers", 0),
        "following": profile.get("following", 0),
        "public_repos": public_repos,
        "total_public_stars": total_stars,
        "top_languages": top_languages,
        "created_at": profile.get("created_at"),
        "stars_truncated": stars_truncated,
    }


# GitHub's contribution calendar (the green-squares graph) is only exposed via
# the GraphQL API — there is no REST equivalent. The calendar always spans the
# trailing 12 months and GitHub computes the per-user intensity quartiles for
# us, which map cleanly onto a 0-4 heatmap scale.
_CONTRIBUTIONS_QUERY = """
query Contributions($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
            contributionLevel
          }
        }
      }
    }
  }
}
""".strip()

_CONTRIBUTION_LEVELS = {
    "NONE": 0,
    "FIRST_QUARTILE": 1,
    "SECOND_QUARTILE": 2,
    "THIRD_QUARTILE": 3,
    "FOURTH_QUARTILE": 4,
}


def _project_contributions(login: str, calendar: dict) -> dict:
    days: list[dict] = []
    for week in calendar.get("weeks", []):
        for day in week.get("contributionDays", []):
            days.append(
                {
                    "date": day["date"],
                    "count": day.get("contributionCount", 0),
                    "level": _CONTRIBUTION_LEVELS.get(
                        day.get("contributionLevel"), 0
                    ),
                }
            )
    return {
        "login": login,
        "total": calendar.get("totalContributions", 0),
        "days": days,
    }


@router.get("/users/{login}/contributions")
async def get_user_contributions(
    login: str,
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
    gh: PublicGitHubClient = Depends(get_public_github),
):
    if not settings.github_fallback_token and user is None:
        raise HTTPException(status_code=503, detail="github_not_configured")
    try:
        data = await gh.graphql(
            _CONTRIBUTIONS_QUERY,
            {"login": login},
            viewer_token=_viewer_token(user, settings),
            # Contribution counts move at most once a day; cache generously.
            ttl_seconds=600,
        )
    except Exception as exc:
        raise _handle_errors(exc, not_found_detail="user_not_found") from exc

    user_node = (data or {}).get("user")
    if user_node is None:
        raise HTTPException(status_code=404, detail="user_not_found")
    calendar = user_node["contributionsCollection"]["contributionCalendar"]
    return _project_contributions(login, calendar)
