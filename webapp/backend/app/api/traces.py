from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import TraceSummary
from app.auth.github import GitHubAuthError, GitHubClient
from app.deps import get_blob_store, get_github, get_session
from app.short_id import looks_like_short_id
from app.storage.blob import BlobStore
from app.storage.models import Trace


router = APIRouter()


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
    data = await blob_store.get(trace.blob_path)
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

    from app.storage.models import utcnow
    blob_path = trace.blob_path
    trace.deleted_at = utcnow()
    await session.commit()
    # Best-effort blob delete after the soft-delete is durable. If this
    # fails the trace is already invisible to readers (deleted_at filter);
    # the orphan blob can be reaped later.
    try:
        await blob_store.delete(blob_path)
    except Exception:
        pass
    return Response(status_code=204)
