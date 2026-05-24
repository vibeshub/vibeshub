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

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.short_id import looks_like_short_id
from app.storage.models import Trace


# `full_path` from the FastAPI catch-all has no leading slash.
_TRACE_STANDALONE_RE = re.compile(r"^t/([A-Za-z0-9_-]+)$")
_TRACE_REPO_RE = re.compile(
    r"^(?P<owner>[^/]+)/(?P<repo>[^/]+)/pull/\d+/(?P<short>[A-Za-z0-9_-]+)$"
)
_USER_RE = re.compile(r"^(?P<owner>[^/]+)$")

SEO_START = "<!--SEO_HEAD_START-->"
SEO_END = "<!--SEO_HEAD_END-->"

# Top-level route slugs that look like `/<owner>` but aren't user pages.
# Kept here so adding a new top-level frontend route is one-line update.
_RESERVED_OWNERS = frozenset({
    "upload",
    "privacy",
    "home",
    "t",
    "api",
    "sitemap.xml",
    "robots.txt",
})


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


async def _lookup_user_stats(
    session: AsyncSession, owner: str
) -> int | None:
    """Return the public trace count for `owner`, or None if zero."""
    result = await session.execute(
        select(func.count(Trace.id))
        .where(Trace.owner_login == owner)
        .where(Trace.is_private.is_(False))
        .where(Trace.deleted_at.is_(None))
    )
    count = result.scalar_one()
    if count == 0:
        return None
    return count


def _render_card_head(
    title: str,
    description: str,
    canonical: str,
    og_type: str,
    base_url: str,
) -> str:
    """Render the full <title>/<meta>/<link> block for an SSR card.

    All four card renderers (trace public branch, user, repo, PR-list)
    emit the same shape: title, description, canonical link, full OG set
    (site_name, type, title, description, url, image), and full Twitter
    card (card, title, description, image). Only the title, description,
    canonical, and og:type vary by route.
    """
    base = base_url.rstrip("/")
    image = f"{base}/og-default.png"

    t = html_escape(title)
    d = html_escape(description, quote=True)
    c = html_escape(canonical, quote=True)
    i = html_escape(image, quote=True)
    ot = html_escape(og_type, quote=True)

    return (
        f"<title>{t}</title>\n"
        f'    <meta name="description" content="{d}" />\n'
        f'    <link rel="canonical" href="{c}" />\n'
        '    <meta property="og:site_name" content="vibeshub" />\n'
        f'    <meta property="og:type" content="{ot}" />\n'
        f'    <meta property="og:title" content="{t}" />\n'
        f'    <meta property="og:description" content="{d}" />\n'
        f'    <meta property="og:url" content="{c}" />\n'
        f'    <meta property="og:image" content="{i}" />\n'
        '    <meta name="twitter:card" content="summary_large_image" />\n'
        f'    <meta name="twitter:title" content="{t}" />\n'
        f'    <meta name="twitter:description" content="{d}" />\n'
        f'    <meta name="twitter:image" content="{i}" />'
    )


def _render_trace_head(trace: Trace, base_url: str) -> str:
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

    base = base_url.rstrip("/")
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

    return _render_card_head(title, description, canonical, "article", base_url)


def _render_user_head(owner: str, count: int, base_url: str) -> str:
    title = f"@{owner} · vibeshub"
    description = (
        f"{count} public Claude Code session"
        f"{'' if count == 1 else 's'} from @{owner}."
    )
    canonical = f"{base_url.rstrip('/')}/{owner}"
    return _render_card_head(title, description, canonical, "profile", base_url)


async def _try_trace(
    path: str, session: AsyncSession, base_url: str
) -> str | None:
    """Render trace-specific <head> if `path` matches a trace URL.

    Returns None when the path isn't a trace URL, the trace isn't found,
    or the DB raises. Callers fall through to the unmodified template.
    """
    short_id = extract_trace_short_id(path)
    if short_id is None:
        return None
    try:
        trace = await _lookup_trace(session, short_id)
    except Exception:
        return None
    if trace is None:
        return None
    return _render_trace_head(trace, base_url)


async def _try_user(
    path: str, session: AsyncSession, base_url: str
) -> str | None:
    m = _USER_RE.match(path)
    if m is None:
        return None
    owner = m.group("owner")
    if not owner or owner in _RESERVED_OWNERS:
        return None
    try:
        count = await _lookup_user_stats(session, owner)
    except Exception:
        return None
    if count is None:
        return None
    return _render_user_head(owner, count, base_url)


def _splice(template: str, replacement: str) -> str:
    """Replace the contents between SEO_HEAD_START/END with `replacement`."""
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


# Ordered handlers: each returns a rendered <head> block or None. The
# first non-None wins. Order matters — longer/more-specific URL shapes
# must come before greedier ones. Today only _try_trace is registered;
# user/repo/PR-list handlers land in later tasks.
_HANDLERS = (_try_trace, _try_user)


async def render_spa_html(
    template: str,
    request_path: str,
    session: AsyncSession,
    base_url: str,
) -> str:
    """Return index.html, optionally with route-specific meta tags injected.

    Falls through to the unmodified template for:
      - templates without the SEO markers (older builds)
      - URLs no handler claims
      - missing/invalid IDs and DB errors (handlers swallow internally)
    """
    if SEO_START not in template or SEO_END not in template:
        return template
    for handler in _HANDLERS:
        replacement = await handler(request_path, session, base_url)
        if replacement is not None:
            return _splice(template, replacement)
    return template
