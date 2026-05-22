from __future__ import annotations

import re
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import AgentSummary, TraceSummary
from app.api.trace_service import resolve_association
from app.auth.crypto import TokenCipher
from app.auth.scopes import has_repo_scope
from app.auth.github import GitHubAuthError, GitHubClient
from app.auth.sessions import get_current_user
from app.deps import (
    get_app_settings,
    get_blob_store,
    get_github,
    get_repo_access,
    get_session,
)
from app.github.repo_access import RepoAccessChecker, RepoAccessError
from app.settings import Settings
from app.short_id import looks_like_short_id
from app.storage.blob import BlobStore
from app.storage.models import Trace, User, utcnow


router = APIRouter()


_AGENT_ID_RE = re.compile(r"^a[0-9a-f]{16}$")


class TracePatch(BaseModel):
    """All fields optional; pydantic's model_fields_set distinguishes an
    absent field from one explicitly set to null."""
    is_private: bool | None = None
    pr_url: str | None = None
    repo_full_name: str | None = None


def _viewer_token(user: User, settings: Settings) -> str | None:
    try:
        return TokenCipher(settings.token_encryption_key).decrypt(
            user.encrypted_access_token
        )
    except Exception:
        return None


async def _can_view_repo(
    repo_full_name: str,
    user: User | None,
    settings: Settings,
    access: RepoAccessChecker,
) -> bool:
    """True if `user` may read `repo_full_name` per GitHub. Never raises."""
    if user is None or not has_repo_scope(user):
        return False
    token = _viewer_token(user, settings)
    if token is None:
        return False
    try:
        return await access.can_read(user.id, token, repo_full_name)
    except RepoAccessError:
        return False


async def _require_trace_access(
    trace: Trace,
    user: User | None,
    settings: Settings,
    access: RepoAccessChecker,
) -> None:
    """Raise the appropriate HTTPException if a viewer may not see `trace`.

    Public traces pass unconditionally. For a private trace:

    - **Standalone** (`repo_full_name` is None): owner-only. Anonymous →
      401 `auth_required`; signed-in non-owner → 404 `not_found`; owner →
      allowed.
    - **Repo-associated**: anonymous → 401; logged in without `repo` scope
      → 403; GitHub says no repo read access → 404; GitHub upstream error
      while checking → 502 (RepoAccessError).

    Every gated error response carries `Cache-Control: no-store` so a shared
    proxy cannot cache a stale 401/403/404/502 for a viewer whose access
    later changes.
    """
    if not trace.is_private:
        return
    no_store = {"Cache-Control": "no-store"}
    if user is None:
        raise HTTPException(
            status_code=401, detail="auth_required", headers=no_store
        )
    # Standalone trace (no repo association): owner-only. A signed-in
    # non-owner gets 404 (the trace's existence is not disclosed).
    if trace.repo_full_name is None:
        if trace.owner_login != user.github_login:
            raise HTTPException(
                status_code=404, detail="not_found", headers=no_store
            )
        return
    # Repo-associated: live GitHub repo-read-access check (unchanged).
    if not has_repo_scope(user):
        raise HTTPException(
            status_code=403, detail="private_scope_required", headers=no_store
        )
    token = _viewer_token(user, settings)
    if token is None:
        raise HTTPException(
            status_code=403, detail="private_scope_required", headers=no_store
        )
    try:
        allowed = await access.can_read(
            user.id, token, trace.repo_full_name
        )
    except RepoAccessError:
        raise HTTPException(
            status_code=502, detail="github_upstream_error", headers=no_store
        )
    if not allowed:
        raise HTTPException(
            status_code=404, detail="not_found", headers=no_store
        )


async def _filter_visible(
    rows: list[Trace],
    user: User | None,
    settings: Settings,
    access: RepoAccessChecker,
) -> list[Trace]:
    """Drop private traces the viewer may not see; public rows always pass.

    A repo-associated private row is gated on the viewer's GitHub read
    access to its repo — checked once per distinct private repo. A
    standalone-private row (no repo) is visible only to its `owner_login`.
    """
    def _row_visible(t: Trace, repo_visible: set[str]) -> bool:
        if not t.is_private:
            return True
        if t.repo_full_name is None:
            # Standalone-private: visible only to its owner.
            return user is not None and t.owner_login == user.github_login
        return t.repo_full_name in repo_visible

    # Repo-associated private rows share one access decision per repo.
    private_repos = {
        t.repo_full_name
        for t in rows
        if t.is_private and t.repo_full_name is not None
    }
    repo_visible: set[str] = set()
    for repo in private_repos:
        if await _can_view_repo(repo, user, settings, access):
            repo_visible.add(repo)
    return [t for t in rows if _row_visible(t, repo_visible)]


def _to_summary(t: Trace) -> TraceSummary:
    return TraceSummary(
        trace_id=str(t.id),
        short_id=t.short_id,
        owner_login=t.owner_login,
        repo_full_name=t.repo_full_name,
        pr_number=t.pr_number,
        pr_url=t.pr_url,
        pr_title=t.pr_title,
        platform=t.platform,
        byte_size=t.byte_size,
        message_count=t.message_count,
        created_at=t.created_at.isoformat(),
        is_private=t.is_private,
        agent_count=t.agent_count or 0,
        agents=[AgentSummary(**a) for a in (t.agents or [])],
    )


@router.get("/api/traces/{owner}/{repo}/pull/{number}")
async def list_pr_traces(
    owner: str,
    repo: str,
    number: int,
    session: AsyncSession = Depends(get_session),
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
    access: RepoAccessChecker = Depends(get_repo_access),
):
    full_name = f"{owner}/{repo}"
    stmt = select(Trace).where(
        Trace.repo_full_name == full_name,
        Trace.pr_number == number,
        Trace.deleted_at.is_(None),
    ).order_by(Trace.created_at.desc())
    rows = (await session.execute(stmt)).scalars().all()
    rows = await _filter_visible(list(rows), user, settings, access)
    return {"traces": [_to_summary(t).model_dump() for t in rows]}


@router.get("/api/users/{login}")
async def get_user_overview(
    login: str,
    session: AsyncSession = Depends(get_session),
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
    access: RepoAccessChecker = Depends(get_repo_access),
):
    # Traces uploaded by this user (owner_login) plus any traces hosted
    # under repos in this user's namespace (repo_full_name "{login}/...").
    # The union keeps org-repo uploads on the uploader's own profile while
    # still serving an org's page (an org has no owner_login matches, so it
    # falls back to the namespace prefix). Private rows are gated below by
    # _filter_visible against the *viewer's* GitHub repo access.
    prefix = f"{login}/"
    list_stmt = (
        select(Trace)
        .where(
            or_(
                Trace.owner_login == login,
                Trace.repo_full_name.startswith(prefix),
            ),
            Trace.deleted_at.is_(None),
        )
        .order_by(Trace.created_at.desc())
    )
    rows = (await session.execute(list_stmt)).scalars().all()
    rows = await _filter_visible(list(rows), user, settings, access)

    # Aggregate repos from the visible rows so private repos the viewer
    # cannot see never appear in the repo breakdown. Standalone traces
    # (repo_full_name is None) carry no repo and are skipped here.
    repo_counts: dict[str, int] = {}
    for t in rows:
        if t.repo_full_name is None:
            continue
        repo_counts[t.repo_full_name] = repo_counts.get(t.repo_full_name, 0) + 1
    repos = [
        {
            "repo_full_name": rn,
            "repo_name": rn.split("/", 1)[1] if "/" in rn else rn,
            "trace_count": count,
        }
        for rn, count in sorted(
            repo_counts.items(), key=lambda kv: (-kv[1], kv[0])
        )
    ]

    total_messages = sum(t.message_count for t in rows)
    total_bytes = sum(t.byte_size for t in rows)
    last_at = rows[0].created_at.isoformat() if rows else None

    return {
        "login": login,
        "stats": {
            "trace_count": len(rows),
            "repo_count": len(repos),
            "message_count": total_messages,
            "byte_size": total_bytes,
            "last_trace_at": last_at,
        },
        "repos": repos,
        "traces": [_to_summary(t).model_dump() for t in rows],
    }


@router.get("/api/repos/{owner}/{repo}")
async def get_repo_overview(
    owner: str,
    repo: str,
    session: AsyncSession = Depends(get_session),
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
    access: RepoAccessChecker = Depends(get_repo_access),
):
    full_name = f"{owner}/{repo}"
    list_stmt = (
        select(Trace)
        .where(
            Trace.repo_full_name == full_name,
            Trace.deleted_at.is_(None),
        )
        .order_by(Trace.created_at.desc())
    )
    rows = (await session.execute(list_stmt)).scalars().all()
    rows = await _filter_visible(list(rows), user, settings, access)

    # Aggregate contributors from the visible rows.
    contrib_counts: dict[str, int] = {}
    for t in rows:
        contrib_counts[t.owner_login] = contrib_counts.get(t.owner_login, 0) + 1
    contributors = [
        {"login": loginname, "trace_count": count}
        for loginname, count in sorted(
            contrib_counts.items(), key=lambda kv: (-kv[1], kv[0])
        )
    ]

    pr_count = len({t.pr_number for t in rows if t.pr_number is not None})
    total_messages = sum(t.message_count for t in rows)
    total_bytes = sum(t.byte_size for t in rows)
    last_at = rows[0].created_at.isoformat() if rows else None

    return {
        "owner": owner,
        "repo": repo,
        "repo_full_name": full_name,
        "stats": {
            "trace_count": len(rows),
            "pr_count": pr_count,
            "contributor_count": len(contributors),
            "message_count": total_messages,
            "byte_size": total_bytes,
            "last_trace_at": last_at,
        },
        "contributors": contributors,
        "traces": [_to_summary(t).model_dump() for t in rows],
    }


@router.get("/api/traces/{short_id}", response_model=TraceSummary)
async def get_trace(
    short_id: str,
    response: Response,
    session: AsyncSession = Depends(get_session),
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
    access: RepoAccessChecker = Depends(get_repo_access),
):
    if not looks_like_short_id(short_id):
        raise HTTPException(status_code=404, detail="not found")
    stmt = select(Trace).where(
        Trace.short_id == short_id,
        Trace.deleted_at.is_(None),
    )
    trace = (await session.execute(stmt)).scalar_one_or_none()
    if trace is None:
        raise HTTPException(status_code=404, detail="not found")
    await _require_trace_access(trace, user, settings, access)
    if trace.is_private:
        response.headers["Cache-Control"] = "private, no-store"
    return _to_summary(trace)


@router.get("/api/traces/{short_id}/raw")
async def get_trace_raw(
    short_id: str,
    session: AsyncSession = Depends(get_session),
    blob_store: BlobStore = Depends(get_blob_store),
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
    access: RepoAccessChecker = Depends(get_repo_access),
):
    if not looks_like_short_id(short_id):
        raise HTTPException(status_code=404, detail="not found")
    stmt = select(Trace).where(
        Trace.short_id == short_id,
        Trace.deleted_at.is_(None),
    )
    trace = (await session.execute(stmt)).scalar_one_or_none()
    if trace is None:
        raise HTTPException(status_code=404, detail="not found")
    await _require_trace_access(trace, user, settings, access)
    if trace.blob_prefix is None:
        # Should not happen post-migration. 500 so we notice.
        raise HTTPException(status_code=500, detail="trace not migrated to v2 layout")
    data = await blob_store.get(f"{trace.blob_prefix}main.jsonl")
    headers = (
        {"Cache-Control": "private, no-store"} if trace.is_private else None
    )
    return Response(
        content=data, media_type="application/x-ndjson", headers=headers
    )


@router.get("/api/traces/{short_id}/agents/{agent_id}")
async def get_agent_raw(
    short_id: str,
    agent_id: str,
    session: AsyncSession = Depends(get_session),
    blob_store: BlobStore = Depends(get_blob_store),
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
    access: RepoAccessChecker = Depends(get_repo_access),
):
    if not looks_like_short_id(short_id):
        raise HTTPException(status_code=404, detail="not found")
    if not _AGENT_ID_RE.match(agent_id):
        raise HTTPException(status_code=404, detail="not found")

    stmt = select(Trace).where(
        Trace.short_id == short_id,
        Trace.deleted_at.is_(None),
    )
    trace = (await session.execute(stmt)).scalar_one_or_none()
    if trace is None:
        raise HTTPException(status_code=404, detail="not found")
    await _require_trace_access(trace, user, settings, access)
    if trace.blob_prefix is None:
        raise HTTPException(status_code=500, detail="trace not migrated to v2 layout")

    known_ids = {a["agent_id"] for a in (trace.agents or [])}
    if agent_id not in known_ids:
        raise HTTPException(status_code=404, detail="agent not found")

    data = await blob_store.get(f"{trace.blob_prefix}agents/{agent_id}.jsonl")
    headers = (
        {"Cache-Control": "private, no-store"} if trace.is_private else None
    )
    return Response(
        content=data, media_type="application/x-ndjson", headers=headers
    )


@router.delete("/api/traces/{short_id}", status_code=204)
async def delete_trace(
    short_id: str,
    authorization: Annotated[str | None, Header()] = None,
    session: AsyncSession = Depends(get_session),
    blob_store: BlobStore = Depends(get_blob_store),
    github: GitHubClient = Depends(get_github),
    user: User | None = Depends(get_current_user),
):
    if not looks_like_short_id(short_id):
        raise HTTPException(status_code=404)

    # Resolve the owner login from either a bearer GitHub token (CLI) or
    # a session cookie (web). Bearer wins when both are present so the
    # existing CLI behavior is unchanged.
    owner_login: str | None = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(None, 1)[1].strip()
        try:
            gh_user = await github.verify_token(token)
        except GitHubAuthError as e:
            raise HTTPException(status_code=401, detail=str(e))
        owner_login = gh_user.login
    elif user is not None:
        owner_login = user.github_login

    if owner_login is None:
        raise HTTPException(
            status_code=401, detail="missing bearer token or session"
        )

    stmt = select(Trace).where(
        Trace.short_id == short_id, Trace.deleted_at.is_(None)
    )
    trace = (await session.execute(stmt)).scalar_one_or_none()
    if trace is None:
        raise HTTPException(status_code=404)
    if trace.owner_login != owner_login:
        raise HTTPException(status_code=403, detail="not the trace owner")

    # Build the full key list before deleting (so a mid-flight crash
    # doesn't leave the DB row pointing at a half-deleted layout).
    keys_to_delete = []
    if trace.blob_prefix:
        keys_to_delete.append(f"{trace.blob_prefix}main.jsonl")
        for a in (trace.agents or []):
            keys_to_delete.append(f"{trace.blob_prefix}agents/{a['agent_id']}.jsonl")
            keys_to_delete.append(f"{trace.blob_prefix}agents/{a['agent_id']}.meta.json")
    elif trace.blob_path:
        keys_to_delete.append(trace.blob_path)

    # Soft-delete the row, then best-effort blob cleanup.
    trace.deleted_at = utcnow()
    await session.commit()

    for key in keys_to_delete:
        try:
            await blob_store.delete(key)
        except FileNotFoundError:
            pass
    return Response(status_code=204)


@router.patch("/api/traces/{short_id}", response_model=TraceSummary)
async def patch_trace(
    short_id: str,
    patch: TracePatch,
    session: AsyncSession = Depends(get_session),
    github: GitHubClient = Depends(get_github),
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
):
    if not looks_like_short_id(short_id):
        raise HTTPException(status_code=404, detail="not found")
    if user is None:
        raise HTTPException(status_code=401, detail="auth_required")

    trace = (await session.execute(
        select(Trace).where(
            Trace.short_id == short_id, Trace.deleted_at.is_(None)
        )
    )).scalar_one_or_none()
    if trace is None:
        raise HTTPException(status_code=404, detail="not found")
    if trace.owner_login != user.github_login:
        raise HTTPException(status_code=403, detail="not the trace owner")

    fields = patch.model_fields_set
    touches_assoc = "pr_url" in fields or "repo_full_name" in fields

    if touches_assoc:
        # The post-edit association: a field present in the patch
        # overrides; an absent field keeps the trace's current value.
        new_pr_url = patch.pr_url if "pr_url" in fields else trace.pr_url
        new_repo = (
            patch.repo_full_name
            if "repo_full_name" in fields
            else trace.repo_full_name
        )
        if new_pr_url or new_repo:
            cipher = TokenCipher(settings.token_encryption_key)
            try:
                token = cipher.decrypt(user.encrypted_access_token)
            except Exception:
                raise HTTPException(
                    status_code=403, detail="github_token_unavailable"
                )
            assoc = await resolve_association(
                github=github,
                token=token,
                uploader_login=user.github_login,
                pr_url=new_pr_url,
                repo_full_name=new_repo,
            )
            trace.repo_full_name = assoc.repo_full_name
            trace.pr_number = assoc.pr_number
            trace.pr_url = assoc.pr_url
            trace.pr_title = assoc.pr_title
            # Repo-associated: privacy mirrors GitHub.
            trace.is_private = assoc.is_private
        else:
            # Cleared all association — revert to standalone.
            trace.repo_full_name = None
            trace.pr_number = None
            trace.pr_url = None
            trace.pr_title = None

    # is_private is honored only when the trace is (or just became)
    # standalone. For a repo-associated trace, privacy mirrors GitHub.
    if "is_private" in fields and patch.is_private is not None:
        if trace.repo_full_name is None:
            trace.is_private = patch.is_private

    await session.commit()
    await session.refresh(trace)
    return _to_summary(trace)
