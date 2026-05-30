from __future__ import annotations

from datetime import datetime
from xml.sax.saxutils import escape as xml_escape

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_app_settings, get_session
from app.settings import Settings
from app.storage.models import Trace


router = APIRouter()


# Routes that are static, indexable, and worth including in every sitemap.
# /vibeviewer is the public, no-login entry point and a primary landing
# target, so it belongs here. /upload (now a redirect to /vibeviewer) and
# /home (auth-gated) are intentionally omitted — neither has search value.
_STATIC_PATHS: tuple[str, ...] = ("/", "/vibeviewer", "/privacy")

# Sitemap-protocol cap. If/when the dataset grows past this we should split
# into a sitemap index — for now a single document is fine.
_MAX_URLS = 50_000


@router.get("/robots.txt", include_in_schema=False)
async def robots(settings: Settings = Depends(get_app_settings)) -> Response:
    base = settings.public_base_url.rstrip("/")
    body = (
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /api/\n"
        "Disallow: /upload\n"
        "Disallow: /home\n"
        f"Sitemap: {base}/sitemap.xml\n"
    )
    return Response(content=body, media_type="text/plain")


@router.get("/sitemap.xml", include_in_schema=False)
async def sitemap(
    settings: Settings = Depends(get_app_settings),
    session: AsyncSession = Depends(get_session),
) -> Response:
    base = settings.public_base_url.rstrip("/")

    # Pull public, undeleted traces newest-first. Each trace contributes one
    # canonical trace URL and may also surface a repo, PR, and user URL via
    # the dedup sets below.
    result = await session.execute(
        select(
            Trace.short_id,
            Trace.owner_login,
            Trace.repo_full_name,
            Trace.pr_number,
            Trace.created_at,
        )
        .where(Trace.is_private.is_(False))
        .where(Trace.deleted_at.is_(None))
        .order_by(Trace.created_at.desc())
        .limit(_MAX_URLS)
    )
    rows = result.all()

    entries: list[tuple[str, datetime | None]] = []
    for path in _STATIC_PATHS:
        entries.append((path, None))

    seen_paths: set[str] = {p for p, _ in entries}
    seen_users: set[str] = set()
    seen_repos: set[str] = set()
    seen_prs: set[tuple[str, int]] = set()

    for short_id, owner, repo, pr_num, created_at in rows:
        if repo and pr_num is not None:
            trace_path = f"/{repo}/pull/{pr_num}/{short_id}"
        else:
            trace_path = f"/t/{short_id}"
        if trace_path not in seen_paths:
            entries.append((trace_path, created_at))
            seen_paths.add(trace_path)

        if owner and owner not in seen_users:
            entries.append((f"/{owner}", created_at))
            seen_users.add(owner)

        if repo and repo not in seen_repos:
            entries.append((f"/{repo}", created_at))
            seen_repos.add(repo)

        if repo and pr_num is not None and (repo, pr_num) not in seen_prs:
            entries.append((f"/{repo}/pull/{pr_num}", created_at))
            seen_prs.add((repo, pr_num))

    # Stay under the 50k cap even after derived URLs. Trace URLs were added
    # first so they have priority; truncating tail drops the lowest-value
    # derived entries.
    entries = entries[:_MAX_URLS]

    lines: list[str] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for path, lastmod in entries:
        lines.append("  <url>")
        lines.append(f"    <loc>{xml_escape(base + path)}</loc>")
        if lastmod is not None:
            lines.append(f"    <lastmod>{lastmod.date().isoformat()}</lastmod>")
        lines.append("  </url>")
    lines.append("</urlset>")
    body = "\n".join(lines) + "\n"
    return Response(content=body, media_type="application/xml")
