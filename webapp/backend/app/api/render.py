from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_app_settings, get_blob_store, get_session
from app.render import RenderError, render_jsonl_to_html
from app.short_id import looks_like_short_id
from app.settings import Settings
from app.storage.blob import BlobStore
from app.storage.models import Render, Trace


router = APIRouter()


@router.get("/api/traces/{short_id}/rendered")
async def get_rendered(
    short_id: str,
    session: AsyncSession = Depends(get_session),
    blob_store: BlobStore = Depends(get_blob_store),
    settings: Settings = Depends(get_app_settings),
) -> Response:
    if not looks_like_short_id(short_id):
        raise HTTPException(status_code=404)

    trace = (await session.execute(
        select(Trace).where(
            Trace.short_id == short_id, Trace.deleted_at.is_(None)
        )
    )).scalar_one_or_none()
    if trace is None:
        raise HTTPException(status_code=404)

    cached = (await session.execute(
        select(Render).where(
            Render.trace_id == trace.id,
            Render.renderer_version == settings.renderer_version,
        )
    )).scalar_one_or_none()
    if cached:
        return Response(content=cached.html, media_type="text/html")

    data = await blob_store.get(trace.blob_path)
    try:
        html = render_jsonl_to_html(data)
    except RenderError as e:
        raise HTTPException(
            status_code=502,
            detail={"error": "render_failed", "message": str(e), "fallback": "raw"},
        )

    session.add(Render(
        trace_id=trace.id,
        html=html,
        renderer_version=settings.renderer_version,
    ))
    await session.commit()
    return Response(content=html, media_type="text/html")
