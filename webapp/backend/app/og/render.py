"""Render a CardData into a 1200x630 PNG social card.

Pure and deterministic: same CardData in, same PNG out. Uses Pillow's
bundled scalable default font, so there is no system-font or bundled-TTF
dependency. Matches the site's dark theme (green-black background, green
accent).
"""

from __future__ import annotations

from functools import lru_cache
from io import BytesIO

from PIL import Image, ImageDraw, ImageFont

from app.og.card import CardData

# Bump when the visual layout changes so cached cards regenerate (the tag
# in app.og.cache folds this in, busting both the blob key and the og:image
# URL scrapers cache).
CARD_VERSION = "1"

CARD_WIDTH = 1200
CARD_HEIGHT = 630

_PAD = 64
_CONTENT_W = CARD_WIDTH - 2 * _PAD

# Palette derived from the frontend theme tokens (tokens.css): green-black
# background, vivid green accent.
_BG = (15, 20, 17)
_FG = (228, 234, 230)
_DIM = (135, 148, 140)
_GRN = (45, 209, 140)
_RULE = (36, 44, 39)

# Digest rows: label column + wrapped one-line value.
_LABEL_COL_W = 250


@lru_cache(maxsize=16)
def _font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.load_default(size=size)


def _ellipsize(
    draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_w: int
) -> str:
    """Trim `text` (adding an ellipsis) until it fits within max_w pixels."""
    if draw.textlength(text, font=font) <= max_w:
        return text
    ell = "…"
    while text and draw.textlength(text + ell, font=font) > max_w:
        text = text[:-1]
    return (text.rstrip() + ell) if text else ell


def _wrap(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    max_w: int,
    max_lines: int,
) -> list[str]:
    """Greedy word-wrap to at most max_lines, ellipsizing any overflow."""
    words = text.split()
    lines: list[str] = []
    i, n = 0, len(words)
    while i < n and len(lines) < max_lines:
        cur = words[i]
        i += 1
        while i < n:
            trial = f"{cur} {words[i]}"
            if draw.textlength(trial, font=font) <= max_w:
                cur, i = trial, i + 1
            else:
                break
        lines.append(cur)
    if i < n:  # leftover words -> ellipsize the last line
        rest = " ".join([lines[-1], *words[i:]])
        lines[-1] = _ellipsize(draw, rest, font, max_w)
    # A single token wider than max_w (no spaces to break on) still overflows.
    return [
        ln if draw.textlength(ln, font=font) <= max_w
        else _ellipsize(draw, ln, font, max_w)
        for ln in lines
    ]


def _draw_header(draw: ImageDraw.ImageDraw, card: CardData) -> None:
    y = 52
    # Brand mark: a rounded green square with a white "v".
    mark = (_PAD, y, _PAD + 44, y + 44)
    draw.rounded_rectangle(mark, radius=12, fill=_GRN)
    mark_font = _font(30)
    draw.text((_PAD + 12, y + 4), "v", font=mark_font, fill=_BG)

    brand_font = _font(28)
    x = _PAD + 60
    draw.text((x, y + 8), "vibeshub", font=brand_font, fill=_FG)
    x += int(draw.textlength("vibeshub", font=brand_font)) + 22

    sep_font = _font(24)
    draw.text((x, y + 10), "·", font=sep_font, fill=_DIM)
    x += 24

    # Platform: green dot + lowercased agent label.
    draw.ellipse((x, y + 20, x + 12, y + 32), fill=_GRN)
    x += 22
    plat_font = _font(24)
    draw.text((x, y + 10), card.agent_label.lower(), font=plat_font, fill=_DIM)

    # repo_ref, right-aligned on the header row.
    if card.repo_ref:
        ref_font = _font(24)
        ref = _ellipsize(draw, card.repo_ref, ref_font, 380)
        w = draw.textlength(ref, font=ref_font)
        draw.text((CARD_WIDTH - _PAD - w, y + 10), ref, font=ref_font, fill=_DIM)


_TITLE_LINE_H = 70


def _title_lines(draw: ImageDraw.ImageDraw, subject: str) -> list[str]:
    return _wrap(draw, subject, _font(56), _CONTENT_W, max_lines=2)


def _draw_title(
    draw: ImageDraw.ImageDraw, lines: list[str], top: int
) -> int:
    """Draw the wrapped subject from `top`; return the y just below it."""
    font = _font(56)
    y = top
    for line in lines:
        draw.text((_PAD, y), line, font=font, fill=_FG)
        y += _TITLE_LINE_H
    return y


def _draw_digest(draw: ImageDraw.ImageDraw, card: CardData, top: int) -> None:
    rows = [
        ("ASK", card.ask),
        ("KEY DECISIONS", card.decisions),
        ("DEAD ENDS", card.dead_ends),
    ]
    label_font = _font(22)
    value_font = _font(28)
    value_x = _PAD + _LABEL_COL_W
    value_w = CARD_WIDTH - _PAD - value_x
    y = max(top + 34, 312)
    for label, value in rows:
        if not value:
            continue
        draw.text((_PAD, y + 4), label, font=label_font, fill=_GRN)
        draw.text(
            (value_x, y),
            _ellipsize(draw, value, value_font, value_w),
            font=value_font,
            fill=_FG,
        )
        y += 58


def _draw_footer(draw: ImageDraw.ImageDraw, card: CardData) -> None:
    rule_y = CARD_HEIGHT - 96
    draw.line(
        (_PAD, rule_y, CARD_WIDTH - _PAD, rule_y), fill=_RULE, width=1
    )

    y = rule_y + 26
    stat_font = _font(24)
    stats = [f"{card.message_count} messages"]
    if card.subagent_count > 0:
        stats.append(f"{card.subagent_count} subagents")
    draw.text((_PAD, y), "   ·   ".join(stats), font=stat_font, fill=_DIM)

    # Right side: @owner (dim) then vibeshub.ai (green), right-aligned.
    site = "vibeshub.ai"
    site_w = draw.textlength(site, font=stat_font)
    draw.text((CARD_WIDTH - _PAD - site_w, y), site, font=stat_font, fill=_GRN)
    if card.owner_login:
        handle = f"@{card.owner_login}   ·   "
        handle_w = draw.textlength(handle, font=stat_font)
        draw.text(
            (CARD_WIDTH - _PAD - site_w - handle_w, y),
            handle,
            font=stat_font,
            fill=_DIM,
        )


def render_card_png(card: CardData) -> bytes:
    img = Image.new("RGB", (CARD_WIDTH, CARD_HEIGHT), _BG)
    draw = ImageDraw.Draw(img)

    _draw_header(draw, card)

    lines = _title_lines(draw, card.subject)
    has_digest = any((card.ask, card.decisions, card.dead_ends))
    if has_digest:
        title_bottom = _draw_title(draw, lines, top=150)
        _draw_digest(draw, card, title_bottom)
    else:
        # No digest rows: center the title in the band between the header
        # and the footer rule so the card never reads as half-empty.
        band_top, band_bottom = 140, CARD_HEIGHT - 96
        block_h = _TITLE_LINE_H * len(lines)
        top = band_top + max(0, (band_bottom - band_top - block_h) // 2)
        _draw_title(draw, lines, top=top)

    _draw_footer(draw, card)

    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
