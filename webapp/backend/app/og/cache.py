"""Cache addressing for rendered social cards.

The cache key is content-addressed: it folds the card version and every
value shown on the card into a short hash. When any of those change (a
new digest, an edited PR title, a layout bump), the tag changes, so the
blob key changes and the `?v=` on the og:image URL changes too. That
makes invalidation implicit: stale cards are simply never requested
again, and social scrapers refetch because the URL moved.
"""

from __future__ import annotations

import hashlib

from app.og.card import CardData
from app.og.render import CARD_VERSION


def card_tag(card: CardData) -> str:
    """A short, stable content hash over everything the card displays."""
    parts = (
        CARD_VERSION,
        card.subject,
        card.agent_label,
        card.repo_ref or "",
        card.owner_login or "",
        card.ask or "",
        card.decisions or "",
        card.dead_ends or "",
        str(card.message_count),
        str(card.subagent_count),
    )
    raw = "\x1f".join(parts).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:12]


def blob_key(short_id: str, tag: str) -> str:
    return f"og/{short_id}-{tag}.png"
