from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import TraceSummary
from app.deps import get_blob_store, get_session
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
