"""Tests for assembling social-card data from a Trace."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.og.card import CardData, build_card_data
from app.storage.models import Trace


def _make_trace(**overrides) -> Trace:
    return Trace(
        id=uuid.uuid4(),
        short_id=overrides.pop("short_id", "abc7defk2j"),
        owner_login=overrides.pop("owner_login", "alice"),
        repo_full_name=overrides.pop("repo_full_name", None),
        pr_number=overrides.pop("pr_number", None),
        pr_title=overrides.pop("pr_title", None),
        platform=overrides.pop("platform", "claude-code"),
        byte_size=1024,
        message_count=overrides.pop("message_count", 42),
        agent_count=overrides.pop("agent_count", 0),
        digest_json=overrides.pop("digest_json", None),
        is_private=overrides.pop("is_private", False),
        deleted_at=None,
        created_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
    )


def _digest(**over) -> dict:
    base = {
        "ask": "Stop the navbar overflowing on small screens",
        "decisions": "Switched to flex-wrap, dropped fixed widths",
        "files": "navbar.tsx, layout.css",
        "tests": "added a viewport snapshot",
        "dead_ends": "Tried overflow-x first, broke the sticky header",
        "chapters": [],
        "file_notes": [],
    }
    base.update(over)
    return base


def test_full_repo_trace_with_digest():
    trace = _make_trace(
        repo_full_name="acme/site",
        pr_number=482,
        pr_title="Fix navbar overflow on mobile",
        message_count=257,
        agent_count=4,
        digest_json=_digest(),
    )
    card = build_card_data(trace)
    assert isinstance(card, CardData)
    assert card.subject == "Fix navbar overflow on mobile"
    assert card.agent_label == "Claude Code"
    assert card.repo_ref == "acme/site #482"
    assert card.owner_login == "alice"
    assert card.ask == "Stop the navbar overflowing on small screens"
    assert card.decisions == "Switched to flex-wrap, dropped fixed widths"
    assert card.dead_ends == "Tried overflow-x first, broke the sticky header"
    assert card.message_count == 257
    assert card.subagent_count == 4


def test_no_digest_leaves_rows_empty():
    trace = _make_trace(
        repo_full_name="acme/site", pr_number=482,
        pr_title="Fix navbar overflow", digest_json=None,
    )
    card = build_card_data(trace)
    assert card.subject == "Fix navbar overflow"
    assert card.ask is None
    assert card.decisions is None
    assert card.dead_ends is None


def test_standalone_trace_subject_and_repo_ref():
    trace = _make_trace(
        short_id="qrst7uvwx2", repo_full_name=None, pr_number=None,
        pr_title=None,
    )
    card = build_card_data(trace)
    assert card.subject == "Trace qrst7uvwx2"
    assert card.repo_ref is None


def test_repo_without_pr_number():
    trace = _make_trace(
        short_id="abc7defk2j",
        repo_full_name="acme/site", pr_number=None, pr_title=None,
    )
    card = build_card_data(trace)
    # No PR title and no PR number -> subject falls back to the trace id,
    # but the header chip still shows the bare repo.
    assert card.subject == "Trace abc7defk2j"
    assert card.repo_ref == "acme/site"


def test_empty_digest_strings_treated_as_missing():
    trace = _make_trace(
        pr_title="x",
        digest_json=_digest(ask="   ", decisions="", dead_ends="\n"),
    )
    card = build_card_data(trace)
    assert card.ask is None
    assert card.decisions is None
    assert card.dead_ends is None


def test_codex_and_cursor_agent_labels():
    assert build_card_data(_make_trace(platform="codex")).agent_label == "Codex CLI"
    assert build_card_data(_make_trace(platform="cursor")).agent_label == "Cursor"


def test_agent_count_none_is_zero_subagents():
    trace = _make_trace()
    trace.agent_count = None  # unflushed row: column default not applied yet
    card = build_card_data(trace)
    assert card.subagent_count == 0
