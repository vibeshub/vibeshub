"""Server-side meta tag injection for the SPA catch-all.

When a request matches a public trace URL, we swap the default <head>
metadata block in index.html for trace-specific tags. This is the only
way to get link previews on Slack/X/LinkedIn/Discord and similar tools,
since those scrapers don't execute JavaScript and would otherwise see
only the generic landing-page meta.

The contract with the frontend is the SEO_HEAD_START/END comment pair
in webapp/frontend/index.html — keep both in sync.
"""

from __future__ import annotations

import re
from html import escape as html_escape

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.short_id import looks_like_short_id
from app.storage.models import Trace


# `full_path` from the FastAPI catch-all has no leading slash.
_TRACE_STANDALONE_RE = re.compile(r"^t/([A-Za-z0-9_-]+)$")
_TRACE_REPO_RE = re.compile(
    r"^(?P<owner>[^/]+)/(?P<repo>[^/]+)/pull/\d+/(?P<short>[A-Za-z0-9_-]+)$"
)

SEO_START = "<!--SEO_HEAD_START-->"
SEO_END = "<!--SEO_HEAD_END-->"


def extract_trace_short_id(path: str) -> str | None:
    """Return the trace short_id encoded in `path`, or None if not a trace URL.

    Accepts both standalone (/t/<id>) and repo-attached
    (/<owner>/<repo>/pull/<n>/<id>) shapes. Validation of the short_id
    format is deferred to looks_like_short_id at lookup time.
    """
    m = _TRACE_STANDALONE_RE.match(path)
    if m:
        return m.group(1)
    m = _TRACE_REPO_RE.match(path)
    if m:
        return m.group("short")
    return None


async def _lookup_trace(session: AsyncSession, short_id: str) -> Trace | None:
    if not looks_like_short_id(short_id):
        return None
    result = await session.execute(
        select(Trace)
        .where(Trace.short_id == short_id)
        .where(Trace.deleted_at.is_(None))
    )
    return result.scalar_one_or_none()


def _render_trace_head(trace: Trace, base_url: str) -> str:
    base = base_url.rstrip("/")
    short_id = trace.short_id

    # Private traces: emit nothing beyond noindex. The PR title, repo
    # name, and even the canonical URL could leak sensitive context to a
    # scraper or relay, and since the page is unindexable a canonical
    # serves no SEO purpose.
    if trace.is_private:
        return (
            "<title>vibeshub</title>\n"
            '    <meta name="robots" content="noindex,nofollow" />'
        )

    if trace.repo_full_name and trace.pr_number is not None:
        canonical_path = (
            f"/{trace.repo_full_name}/pull/{trace.pr_number}/{short_id}"
        )
    else:
        canonical_path = f"/t/{short_id}"
    canonical = f"{base}{canonical_path}"

    subject = trace.pr_title or (
        f"{trace.repo_full_name} #{trace.pr_number}"
        if trace.repo_full_name and trace.pr_number is not None
        else f"Trace {short_id}"
    )
    title = f"{subject} · vibeshub"

    desc_parts = [
        f"Claude Code session by @{trace.owner_login}",
        f"{trace.message_count} messages",
    ]
    if trace.repo_full_name:
        desc_parts.append(trace.repo_full_name)
    description = " · ".join(desc_parts)

    image = f"{base}/og-default.png"

    t = html_escape(title)
    d = html_escape(description, quote=True)
    c = html_escape(canonical, quote=True)
    i = html_escape(image, quote=True)

    return (
        f"<title>{t}</title>\n"
        f'    <meta name="description" content="{d}" />\n'
        f'    <link rel="canonical" href="{c}" />\n'
        '    <meta property="og:site_name" content="vibeshub" />\n'
        '    <meta property="og:type" content="article" />\n'
        f'    <meta property="og:title" content="{t}" />\n'
        f'    <meta property="og:description" content="{d}" />\n'
        f'    <meta property="og:url" content="{c}" />\n'
        f'    <meta property="og:image" content="{i}" />\n'
        '    <meta name="twitter:card" content="summary_large_image" />\n'
        f'    <meta name="twitter:title" content="{t}" />\n'
        f'    <meta name="twitter:description" content="{d}" />\n'
        f'    <meta name="twitter:image" content="{i}" />'
    )


async def render_spa_html(
    template: str,
    request_path: str,
    session: AsyncSession,
    base_url: str,
) -> str:
    """Return index.html, optionally with trace-specific meta tags injected.

    Falls through to the unmodified template for:
      - non-trace URLs
      - templates without the SEO markers (older builds)
      - missing or malformed short_ids
      - DB lookup errors (we never want SEO to take the page down)
    """
    if SEO_START not in template or SEO_END not in template:
        return template

    short_id = extract_trace_short_id(request_path)
    if short_id is None:
        return template

    try:
        trace = await _lookup_trace(session, short_id)
    except Exception:
        return template

    if trace is None:
        return template

    replacement = _render_trace_head(trace, base_url)
    start = template.index(SEO_START)
    end = template.index(SEO_END) + len(SEO_END)
    return (
        template[:start]
        + SEO_START
        + "\n    "
        + replacement
        + "\n    "
        + SEO_END
        + template[end:]
    )
