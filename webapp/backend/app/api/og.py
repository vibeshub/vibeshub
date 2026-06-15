"""Dynamic Open Graph / Twitter card image for a public trace.

`spa_seo` points each public trace's og:image at `/api/og/<short_id>.png`.
This route renders that card from the trace's digest and caches the PNG in
blob storage, keyed by a content hash so it regenerates when the trace's
displayed content changes. Private, missing, or deleted traces redirect to
the shared default card and never leak content.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import RedirectResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.spa_seo import _lookup_trace
from app.deps import get_blob_store, get_session
from app.og.cache import blob_key, card_tag
from app.og.card import build_card_data
from app.og.render import render_card_png
from app.storage.blob import BlobStore

router = APIRouter()

_DEFAULT_CARD = "/og-default.png"
# URL is content-addressed (tag changes when content changes), so the bytes
# at a given URL never change — safe to cache hard.
_CACHE_CONTROL = "public, max-age=86400, immutable"


@router.get("/api/og/{short_id}.png")
async def og_card_image(
    short_id: str,
    session: AsyncSession = Depends(get_session),
    blob: BlobStore = Depends(get_blob_store),
) -> Response:
    trace = await _lookup_trace(session, short_id)
    if trace is None or trace.is_private:
        return RedirectResponse(_DEFAULT_CARD, status_code=302)

    card = build_card_data(trace)
    tag = card_tag(card)
    key = blob_key(short_id, tag)
    try:
        png = await blob.get(key)
    except FileNotFoundError:
        png = render_card_png(card)
        await blob.put(key, png)

    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": _CACHE_CONTROL, "ETag": f'"{tag}"'},
    )
