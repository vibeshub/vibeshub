"""Tests for server-side meta tag injection on the SPA catch-all."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.api.spa_seo import extract_trace_short_id
from app.storage.models import Trace


SHORT_OK = "abc7defk2j"  # 10 chars, [a-z2-7]
SHORT_OK_2 = "qrst7uvwx2"


def _make_trace(**overrides) -> Trace:
    return Trace(
        id=uuid.uuid4(),
        short_id=overrides.pop("short_id"),
        owner_login=overrides.pop("owner_login", "alice"),
        repo_full_name=overrides.pop("repo_full_name", None),
        pr_number=overrides.pop("pr_number", None),
        pr_title=overrides.pop("pr_title", None),
        platform="claude-code",
        byte_size=1024,
        message_count=overrides.pop("message_count", 42),
        is_private=overrides.pop("is_private", False),
        deleted_at=overrides.pop("deleted_at", None),
        created_at=overrides.pop("created_at", datetime(2026, 5, 1, tzinfo=timezone.utc)),
    )


# ---------------------------------------------------------------------------
# extract_trace_short_id
# ---------------------------------------------------------------------------

class TestExtractShortId:
    def test_standalone(self):
        assert extract_trace_short_id("t/abc7defk2j") == "abc7defk2j"

    def test_repo_attached(self):
        assert (
            extract_trace_short_id("alice/widget/pull/7/abc7defk2j")
            == "abc7defk2j"
        )

    def test_non_trace_paths_return_none(self):
        assert extract_trace_short_id("") is None
        assert extract_trace_short_id("privacy") is None
        assert extract_trace_short_id("alice") is None
        assert extract_trace_short_id("alice/widget") is None
        # PR list (no short_id) is not a trace URL.
        assert extract_trace_short_id("alice/widget/pull/7") is None
        # /home is the authed redirect, not a trace.
        assert extract_trace_short_id("home") is None


# ---------------------------------------------------------------------------
# Integration: SPA catch-all with frontend_dist override
# ---------------------------------------------------------------------------

INDEX_TEMPLATE = """<!doctype html>
<html><head>
  <meta charset="UTF-8" />
  <!--SEO_HEAD_START-->
  <title>vibeshub · share Claude Code sessions as replayable traces</title>
  <meta name="description" content="default description" />
  <link rel="canonical" href="https://vibeshub.ai/" />
  <meta property="og:title" content="vibeshub" />
  <meta property="og:image" content="https://vibeshub.ai/og-default.png" />
  <!--SEO_HEAD_END-->
</head><body><div id="root"></div></body></html>
"""


@pytest.fixture
def spa_client(tmp_path, _settings_env, monkeypatch):
    """A test client where the SPA catch-all is active.

    Writes a minimal index.html with SEO markers into a tmp dir and
    points _frontend_dist_override at it, so the catch-all branch in
    create_app() takes effect.
    """
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text(INDEX_TEMPLATE)
    (dist / "assets").mkdir()

    from app import main as main_module

    monkeypatch.setattr(main_module, "_frontend_dist_override", dist)
    app = main_module.create_app()
    with TestClient(app) as c:
        yield c


def test_unknown_path_returns_default_template(spa_client):
    resp = spa_client.get("/some/random/path")
    assert resp.status_code == 200
    body = resp.text
    # Default tags are intact.
    assert "vibeshub · share Claude Code sessions" in body
    assert 'href="https://vibeshub.ai/"' in body


def test_root_returns_default_template(spa_client):
    resp = spa_client.get("/")
    assert resp.status_code == 200
    assert "vibeshub · share Claude Code sessions" in resp.text


def test_trace_not_found_falls_back_to_default(spa_client):
    # Valid short_id shape, but no row exists.
    resp = spa_client.get(f"/t/{SHORT_OK}")
    assert resp.status_code == 200
    body = resp.text
    assert "vibeshub · share Claude Code sessions" in body


def test_invalid_short_id_falls_back_to_default(spa_client):
    # Contains '8' (not in the base32 alphabet) → looks_like_short_id is
    # False → template returned unchanged.
    resp = spa_client.get("/t/abc8defk2j")
    assert resp.status_code == 200
    assert "vibeshub · share Claude Code sessions" in resp.text


@pytest.mark.asyncio
async def test_public_standalone_trace_injects_meta(spa_client):
    SessionLocal = spa_client.app.state.session_maker
    async with SessionLocal() as session:
        session.add(_make_trace(
            short_id=SHORT_OK,
            owner_login="alice",
            message_count=257,
        ))
        await session.commit()

    resp = spa_client.get(f"/t/{SHORT_OK}")
    assert resp.status_code == 200
    body = resp.text

    # Trace-specific title is in <title>.
    assert f"Trace {SHORT_OK} · vibeshub" in body
    # Default landing title is gone.
    assert "vibeshub · share Claude Code sessions" not in body
    # Description carries uploader + message count.
    assert "Claude Code session by @alice" in body
    assert "257 messages" in body
    # Canonical points at the standalone path.
    assert f'href="https://vibeshub.test/t/{SHORT_OK}"' in body
    # OG/Twitter set present.
    assert 'property="og:title"' in body
    assert 'property="og:type" content="article"' in body
    assert 'name="twitter:card" content="summary_large_image"' in body


@pytest.mark.asyncio
async def test_public_repo_trace_canonical_uses_repo_form(spa_client):
    SessionLocal = spa_client.app.state.session_maker
    async with SessionLocal() as session:
        session.add(_make_trace(
            short_id=SHORT_OK,
            owner_login="alice",
            repo_full_name="alice/widget",
            pr_number=7,
            pr_title="Tighten landing copy",
            message_count=42,
        ))
        await session.commit()

    # Hit via the repo-attached URL.
    resp = spa_client.get(f"/alice/widget/pull/7/{SHORT_OK}")
    assert resp.status_code == 200
    body = resp.text
    assert "Tighten landing copy · vibeshub" in body
    assert "alice/widget" in body
    # Canonical collapses to the repo-attached form regardless of which
    # URL was hit.
    assert (
        f'href="https://vibeshub.test/alice/widget/pull/7/{SHORT_OK}"' in body
    )

    # Hitting the standalone URL for the same trace yields the same canonical.
    resp_alt = spa_client.get(f"/t/{SHORT_OK}")
    assert (
        f'href="https://vibeshub.test/alice/widget/pull/7/{SHORT_OK}"'
        in resp_alt.text
    )


@pytest.mark.asyncio
async def test_private_trace_emits_noindex_without_leaking_title(spa_client):
    SessionLocal = spa_client.app.state.session_maker
    async with SessionLocal() as session:
        session.add(_make_trace(
            short_id=SHORT_OK,
            owner_login="alice",
            repo_full_name="alice/secret-stuff",
            pr_number=1,
            pr_title="Internal incident postmortem",
            is_private=True,
        ))
        await session.commit()

    resp = spa_client.get(f"/t/{SHORT_OK}")
    body = resp.text
    assert 'name="robots" content="noindex,nofollow"' in body
    # The sensitive title and repo name must not appear in any meta tag.
    assert "Internal incident postmortem" not in body
    assert "alice/secret-stuff" not in body
    # Default title is also gone (replaced with bare "vibeshub").
    assert "vibeshub · share Claude Code sessions" not in body


@pytest.mark.asyncio
async def test_deleted_trace_falls_back_to_default(spa_client):
    SessionLocal = spa_client.app.state.session_maker
    async with SessionLocal() as session:
        session.add(_make_trace(
            short_id=SHORT_OK_2,
            owner_login="alice",
            deleted_at=datetime.now(timezone.utc),
        ))
        await session.commit()

    resp = spa_client.get(f"/t/{SHORT_OK_2}")
    # Tombstoned traces don't get bespoke meta — the SPA will render
    # NotFound client-side, so the default landing meta is fine.
    assert "vibeshub · share Claude Code sessions" in resp.text


# ---------------------------------------------------------------------------
# User route: /<owner>
# ---------------------------------------------------------------------------

class TestUserRouteSeo:
    @pytest.mark.asyncio
    async def test_public_traces_inject_meta(self, spa_client):
        SessionLocal = spa_client.app.state.session_maker
        async with SessionLocal() as session:
            session.add(_make_trace(short_id=SHORT_OK, owner_login="alice"))
            session.add(_make_trace(short_id=SHORT_OK_2, owner_login="alice"))
            await session.commit()

        resp = spa_client.get("/alice")
        assert resp.status_code == 200
        body = resp.text

        assert "@alice · vibeshub" in body
        assert "2 public Claude Code sessions from @alice" in body
        assert 'href="https://vibeshub.test/alice"' in body
        assert 'property="og:type" content="profile"' in body
        # Default landing title is gone.
        assert "vibeshub · share Claude Code sessions" not in body

    @pytest.mark.asyncio
    async def test_singular_count_uses_session_not_sessions(self, spa_client):
        SessionLocal = spa_client.app.state.session_maker
        async with SessionLocal() as session:
            session.add(_make_trace(short_id=SHORT_OK, owner_login="solo"))
            await session.commit()

        resp = spa_client.get("/solo")
        body = resp.text
        assert "1 public Claude Code session from @solo" in body
        # Make sure the plural form didn't sneak in alongside.
        assert "1 public Claude Code sessions from @solo" not in body

    def test_zero_public_traces_falls_through(self, spa_client):
        # No traces seeded → count is 0 → template unchanged.
        resp = spa_client.get("/ghost")
        assert resp.status_code == 200
        assert "vibeshub · share Claude Code sessions" in resp.text

    @pytest.mark.asyncio
    async def test_private_only_owner_falls_through(self, spa_client):
        SessionLocal = spa_client.app.state.session_maker
        async with SessionLocal() as session:
            session.add(_make_trace(
                short_id=SHORT_OK, owner_login="bob", is_private=True,
            ))
            await session.commit()

        resp = spa_client.get("/bob")
        # Public count is 0 → fall through.
        assert "vibeshub · share Claude Code sessions" in resp.text

    @pytest.mark.parametrize(
        "slug", ["upload", "privacy", "home", "t", "api"],
    )
    def test_reserved_owner_slugs_fall_through(self, spa_client, slug):
        resp = spa_client.get(f"/{slug}")
        assert resp.status_code == 200
        assert "vibeshub · share Claude Code sessions" in resp.text

    @pytest.mark.asyncio
    @pytest.mark.parametrize("slug", ["sitemap.xml", "robots.txt"])
    async def test_try_user_returns_none_for_seo_router_slugs(
        self, spa_client, slug,
    ):
        """The seo router serves these before the SPA catch-all, but the
        reserved-owner guard inside `_try_user` is defense-in-depth — make
        sure the guard stays effective if router precedence ever changes.
        """
        from app.api.spa_seo import _try_user

        SessionLocal = spa_client.app.state.session_maker
        async with SessionLocal() as session:
            result = await _try_user(slug, session, "https://vibeshub.test")
        assert result is None
