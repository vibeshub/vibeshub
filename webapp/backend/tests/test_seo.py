from __future__ import annotations

import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

import pytest

from app.storage.models import Trace


SM_NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}


def _sitemap_locs(body: str) -> list[str]:
    root = ET.fromstring(body)
    return [loc.text for loc in root.findall("sm:url/sm:loc", SM_NS)]


def _make_trace(**overrides) -> Trace:
    base_args = dict(
        id=uuid.uuid4(),
        short_id=overrides.pop("short_id"),
        owner_login=overrides.pop("owner_login", "alice"),
        repo_full_name=overrides.pop("repo_full_name", None),
        pr_number=overrides.pop("pr_number", None),
        platform="claude-code",
        byte_size=1,
        message_count=1,
        is_private=overrides.pop("is_private", False),
        deleted_at=overrides.pop("deleted_at", None),
        created_at=overrides.pop("created_at", datetime(2026, 5, 1, tzinfo=timezone.utc)),
    )
    base_args.update(overrides)
    return Trace(**base_args)


def test_robots_txt_served(client):
    resp = client.get("/robots.txt")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/plain")
    body = resp.text
    assert "User-agent: *" in body
    assert "Disallow: /api/" in body
    assert "Disallow: /upload" in body
    assert "Sitemap: https://vibeshub.test/sitemap.xml" in body


def test_sitemap_serves_static_routes_when_no_traces(client):
    resp = client.get("/sitemap.xml")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/xml")
    locs = _sitemap_locs(resp.text)
    assert "https://vibeshub.test/" in locs
    assert "https://vibeshub.test/vibeviewer" in locs
    assert "https://vibeshub.test/privacy" in locs
    # /upload and /home are intentionally not indexed.
    assert "https://vibeshub.test/upload" not in locs
    assert "https://vibeshub.test/home" not in locs


@pytest.mark.asyncio
async def test_sitemap_includes_public_traces_and_derived_urls(client):
    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        # Public, attached to a PR — surfaces trace, repo, PR, and user URLs.
        session.add(_make_trace(
            short_id="abc12345",
            owner_login="alice",
            repo_full_name="alice/widget",
            pr_number=7,
            created_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
        ))
        # Public, standalone — surfaces /t/<id> and the user URL only.
        session.add(_make_trace(
            short_id="def67890",
            owner_login="bob",
            created_at=datetime(2026, 5, 2, tzinfo=timezone.utc),
        ))
        # Private — excluded entirely, including its derived URLs.
        session.add(_make_trace(
            short_id="prv00000",
            owner_login="carol",
            repo_full_name="carol/secret",
            pr_number=1,
            is_private=True,
        ))
        # Deleted — excluded.
        session.add(_make_trace(
            short_id="del00000",
            owner_login="dave",
            repo_full_name="dave/old",
            pr_number=2,
            deleted_at=datetime.now(timezone.utc),
        ))
        await session.commit()

    resp = client.get("/sitemap.xml")
    assert resp.status_code == 200
    locs = _sitemap_locs(resp.text)

    # Public PR-attached trace and its derived URLs are present.
    assert "https://vibeshub.test/alice/widget/pull/7/abc12345" in locs
    assert "https://vibeshub.test/alice/widget/pull/7" in locs
    assert "https://vibeshub.test/alice/widget" in locs
    assert "https://vibeshub.test/alice" in locs

    # Standalone public trace uses /t/<id>; its uploader is included.
    assert "https://vibeshub.test/t/def67890" in locs
    assert "https://vibeshub.test/bob" in locs

    # Private and deleted contribute nothing — not even their owner/repo URLs.
    assert "https://vibeshub.test/carol/secret/pull/1/prv00000" not in locs
    assert "https://vibeshub.test/carol" not in locs
    assert "https://vibeshub.test/dave/old/pull/2/del00000" not in locs
    assert "https://vibeshub.test/dave" not in locs


@pytest.mark.asyncio
async def test_sitemap_dedupes_repeated_repo_and_user(client):
    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        for i, sid in enumerate(["aaa00001", "aaa00002", "aaa00003"]):
            session.add(_make_trace(
                short_id=sid,
                owner_login="alice",
                repo_full_name="alice/widget",
                pr_number=7,
                created_at=datetime(2026, 5, 1 + i, tzinfo=timezone.utc),
            ))
        await session.commit()

    resp = client.get("/sitemap.xml")
    locs = _sitemap_locs(resp.text)
    assert locs.count("https://vibeshub.test/alice") == 1
    assert locs.count("https://vibeshub.test/alice/widget") == 1
    assert locs.count("https://vibeshub.test/alice/widget/pull/7") == 1
    # Each trace short_id still gets its own entry.
    assert locs.count("https://vibeshub.test/alice/widget/pull/7/aaa00001") == 1
    assert locs.count("https://vibeshub.test/alice/widget/pull/7/aaa00002") == 1
