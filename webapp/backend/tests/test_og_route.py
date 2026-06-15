"""Tests for the dynamic social-card image route and its blob cache."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

from app.og.card import CardData
from app.og.cache import blob_key, card_tag
from app.storage.models import Trace


SHORT_OK = "abc7defk2j"
SHORT_OK_2 = "qrst7uvwx2"


def _make_trace(**overrides) -> Trace:
    return Trace(
        id=uuid.uuid4(),
        short_id=overrides.pop("short_id", SHORT_OK),
        owner_login=overrides.pop("owner_login", "alice"),
        repo_full_name=overrides.pop("repo_full_name", None),
        pr_number=overrides.pop("pr_number", None),
        pr_title=overrides.pop("pr_title", "Fix the navbar"),
        platform=overrides.pop("platform", "claude-code"),
        byte_size=1024,
        message_count=overrides.pop("message_count", 42),
        agent_count=overrides.pop("agent_count", 0),
        digest_json=overrides.pop("digest_json", None),
        is_private=overrides.pop("is_private", False),
        deleted_at=overrides.pop("deleted_at", None),
        created_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
    )


async def _seed(client, trace: Trace) -> None:
    async with client.app.state.session_maker() as session:
        session.add(trace)
        await session.commit()


# ---------------------------------------------------------------------------
# cache tag
# ---------------------------------------------------------------------------

def _card(**over) -> CardData:
    base = dict(
        subject="Fix the navbar", agent_label="Claude Code", repo_ref=None,
        owner_login="alice", ask=None, decisions=None, dead_ends=None,
        message_count=42, subagent_count=0,
    )
    base.update(over)
    return CardData(**base)


class TestCacheTag:
    def test_same_content_same_tag(self):
        assert card_tag(_card()) == card_tag(_card())

    def test_different_content_different_tag(self):
        assert card_tag(_card(ask="a")) != card_tag(_card(ask="b"))

    def test_blob_key_shape(self):
        assert blob_key("abc7defk2j", "deadbeef") == "og/abc7defk2j-deadbeef.png"


# ---------------------------------------------------------------------------
# route
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_public_trace_returns_png(client):
    await _seed(client, _make_trace(message_count=257))
    resp = client.get(f"/api/og/{SHORT_OK}.png")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert "public" in resp.headers.get("cache-control", "")


@pytest.mark.asyncio
async def test_second_request_served_from_cache(client, monkeypatch):
    await _seed(client, _make_trace())

    import app.api.og as og_mod
    calls = {"n": 0}
    real = og_mod.render_card_png

    def counting(card):
        calls["n"] += 1
        return real(card)

    monkeypatch.setattr(og_mod, "render_card_png", counting)

    first = client.get(f"/api/og/{SHORT_OK}.png")
    second = client.get(f"/api/og/{SHORT_OK}.png")
    assert first.content == second.content
    assert calls["n"] == 1  # rendered once, served from blob the second time


@pytest.mark.asyncio
async def test_private_trace_redirects_to_default(client):
    await _seed(client, _make_trace(is_private=True))
    resp = client.get(f"/api/og/{SHORT_OK}.png", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"] == "/og-default.png"


def test_unknown_trace_redirects_to_default(client):
    resp = client.get(f"/api/og/{SHORT_OK}.png", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"] == "/og-default.png"


def test_invalid_short_id_redirects_to_default(client):
    resp = client.get("/api/og/abc8defk2j.png", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"] == "/og-default.png"


@pytest.mark.asyncio
async def test_deleted_trace_redirects_to_default(client):
    await _seed(
        client,
        _make_trace(short_id=SHORT_OK_2, deleted_at=datetime.now(timezone.utc)),
    )
    resp = client.get(f"/api/og/{SHORT_OK_2}.png", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"] == "/og-default.png"
