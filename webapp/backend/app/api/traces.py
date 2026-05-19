from __future__ import annotations

import re
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import AgentSummary, TraceSummary
from app.auth.github import GitHubAuthError, GitHubClient
from app.deps import get_blob_store, get_github, get_session
from app.short_id import looks_like_short_id
from app.storage.blob import BlobStore
from app.storage.models import Trace, utcnow


router = APIRouter()


_AGENT_ID_RE = re.compile(r"^a[0-9a-f]{16}$")


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
        agent_count=t.agent_count or 0,
        agents=[AgentSummary(**a) for a in (t.agents or [])],
    )


@router.get("/api/traces/{owner}/{repo}/pull/{number}")
async def list_pr_traces(
    owner: str,
    repo: str,
    number: int,
    session: AsyncSession = Depends(get_session),
):
    full_name = f"{owner}/{repo}"
    stmt = select(Trace).where(
        Trace.repo_full_name == full_name,
        Trace.pr_number == number,
        Trace.deleted_at.is_(None),
    ).order_by(Trace.created_at.desc())
    rows = (await session.execute(stmt)).scalars().all()
    return {"traces": [_to_summary(t).model_dump() for t in rows]}


@router.get("/api/users/{login}")
async def get_user_overview(
    login: str,
    session: AsyncSession = Depends(get_session),
):
    # All traces hosted under repos owned by this user (repo_full_name like "{login}/...")
    prefix = f"{login}/"
    list_stmt = (
        select(Trace)
        .where(
            Trace.repo_full_name.startswith(prefix),
            Trace.deleted_at.is_(None),
        )
        .order_by(Trace.created_at.desc())
    )
    rows = (await session.execute(list_stmt)).scalars().all()

    repo_stmt = (
        select(
            Trace.repo_full_name,
            func.count(Trace.id).label("trace_count"),
        )
        .where(
            Trace.repo_full_name.startswith(prefix),
            Trace.deleted_at.is_(None),
        )
        .group_by(Trace.repo_full_name)
        .order_by(func.count(Trace.id).desc())
    )
    repo_rows = (await session.execute(repo_stmt)).all()
    repos = [
        {
            "repo_full_name": r.repo_full_name,
            "repo_name": r.repo_full_name.split("/", 1)[1]
            if "/" in r.repo_full_name
            else r.repo_full_name,
            "trace_count": int(r.trace_count),
        }
        for r in repo_rows
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

    contrib_stmt = (
        select(Trace.owner_login, func.count(Trace.id).label("trace_count"))
        .where(
            Trace.repo_full_name == full_name,
            Trace.deleted_at.is_(None),
        )
        .group_by(Trace.owner_login)
        .order_by(func.count(Trace.id).desc())
    )
    contrib_rows = (await session.execute(contrib_stmt)).all()
    contributors = [
        {"login": c.owner_login, "trace_count": int(c.trace_count)}
        for c in contrib_rows
    ]

    pr_count = len({t.pr_number for t in rows})
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
    session: AsyncSession = Depends(get_session),
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
    return _to_summary(trace)


@router.get("/api/traces/{short_id}/raw")
async def get_trace_raw(
    short_id: str,
    session: AsyncSession = Depends(get_session),
    blob_store: BlobStore = Depends(get_blob_store),
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
    if trace.blob_prefix is None:
        # Should not happen post-migration. 500 so we notice.
        raise HTTPException(status_code=500, detail="trace not migrated to v2 layout")
    data = await blob_store.get(f"{trace.blob_prefix}main.jsonl")
    return Response(content=data, media_type="application/x-ndjson")


@router.get("/api/traces/{short_id}/agents/{agent_id}")
async def get_agent_raw(
    short_id: str,
    agent_id: str,
    session: AsyncSession = Depends(get_session),
    blob_store: BlobStore = Depends(get_blob_store),
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
    if trace.blob_prefix is None:
        raise HTTPException(status_code=500, detail="trace not migrated to v2 layout")

    known_ids = {a["agent_id"] for a in (trace.agents or [])}
    if agent_id not in known_ids:
        raise HTTPException(status_code=404, detail="agent not found")

    data = await blob_store.get(f"{trace.blob_prefix}agents/{agent_id}.jsonl")
    return Response(content=data, media_type="application/x-ndjson")


@router.delete("/api/traces/{short_id}", status_code=204)
async def delete_trace(
    short_id: str,
    authorization: Annotated[str | None, Header()] = None,
    session: AsyncSession = Depends(get_session),
    blob_store: BlobStore = Depends(get_blob_store),
    github: GitHubClient = Depends(get_github),
):
    if not looks_like_short_id(short_id):
        raise HTTPException(status_code=404)

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization.split(None, 1)[1].strip()

    try:
        user = await github.verify_token(token)
    except GitHubAuthError as e:
        raise HTTPException(status_code=401, detail=str(e))

    stmt = select(Trace).where(
        Trace.short_id == short_id, Trace.deleted_at.is_(None)
    )
    trace = (await session.execute(stmt)).scalar_one_or_none()
    if trace is None:
        raise HTTPException(status_code=404)
    if trace.owner_login != user.login:
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
