"""Tests for rendering a CardData into a PNG social card."""

from __future__ import annotations

from io import BytesIO

from PIL import Image

from app.og.card import CardData
from app.og.render import CARD_HEIGHT, CARD_WIDTH, render_card_png


def _card(**over) -> CardData:
    base = dict(
        subject="Fix navbar overflow on mobile",
        agent_label="Claude Code",
        repo_ref="acme/site #482",
        owner_login="alice",
        ask="Stop the navbar overflowing on small screens",
        decisions="Switched to flex-wrap, dropped fixed widths",
        dead_ends="Tried overflow-x first, broke the sticky header",
        message_count=257,
        subagent_count=4,
    )
    base.update(over)
    return CardData(**base)


def _open(png: bytes) -> Image.Image:
    return Image.open(BytesIO(png))


def test_returns_valid_png_of_card_dimensions():
    png = render_card_png(_card())
    assert isinstance(png, bytes)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    img = _open(png)
    assert img.format == "PNG"
    assert img.size == (CARD_WIDTH, CARD_HEIGHT) == (1200, 630)


def test_renders_without_digest_rows():
    png = render_card_png(_card(ask=None, decisions=None, dead_ends=None))
    assert _open(png).size == (1200, 630)


def test_renders_standalone_without_owner_or_repo():
    png = render_card_png(
        _card(repo_ref=None, owner_login=None, subject="Trace qrst7uvwx2")
    )
    assert _open(png).size == (1200, 630)


def test_renders_long_strings_without_error():
    png = render_card_png(
        _card(
            subject="A very long pull request title " * 6,
            ask="x" * 400,
            decisions="word " * 120,
            dead_ends="y" * 400,
        )
    )
    assert _open(png).size == (1200, 630)


def test_card_is_not_blank():
    """A rendered card must have real ink, not an empty canvas."""
    png = render_card_png(_card())
    img = _open(png).convert("RGB")
    colors = img.getcolors(maxcolors=100_000)
    # More than a handful of distinct colors -> text/accents actually drew.
    assert colors is None or len(colors) > 20
