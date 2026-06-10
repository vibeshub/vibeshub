"""Tests for app.codex_convert, the backend mirror of the frontend's
codexExport.ts converter.

The *.golden.jsonl fixtures are the actual output of the frontend
converter (codexToJsonl) over the matching *.jsonl rollout, captured via
a one-shot vitest run. They pin the cross-language parity contract: both
converters must emit the same records in the same order with the same
synthetic uuids, because digest chapter anchor_uuids are produced against
the backend conversion but resolved against the frontend's render-time
conversion. Regenerate by running codexToJsonl over the fixtures and
saving the output (see the "Parity" note in app/codex_convert.py).
"""
import json
from pathlib import Path

import pytest

from app.codex_convert import codex_to_claude_jsonl, looks_like_codex

FIXTURES = Path(__file__).parent / "fixtures" / "codex"


def _records(blob: bytes) -> list[dict]:
    return [json.loads(line) for line in blob.splitlines() if line.strip()]


@pytest.mark.parametrize(
    "name", ["rollout", "rollout_subagent", "kitchen_sink"],
)
def test_conversion_matches_frontend_golden(name):
    raw = (FIXTURES / f"{name}.jsonl").read_bytes()
    golden = (FIXTURES / f"{name}.golden.jsonl").read_bytes()
    assert _records(codex_to_claude_jsonl(raw)) == _records(golden)


def test_uuid_sequence_is_positional():
    # Anchors only line up because both converters assign uuids by record
    # creation order: codex-rec-<n>, no gaps, no reordering.
    raw = (FIXTURES / "kitchen_sink.jsonl").read_bytes()
    recs = _records(codex_to_claude_jsonl(raw))
    assert [r["uuid"] for r in recs] == [
        f"codex-rec-{i}" for i in range(len(recs))
    ]


def test_injected_user_role_items_are_ignored():
    # The genuine ask travels as event_msg/user_message; response_item
    # user-role messages carry harness noise (<environment_context>, the
    # prompt echo, <turn_aborted>) and must not become USER records.
    raw = (FIXTURES / "kitchen_sink.jsonl").read_bytes()
    out = codex_to_claude_jsonl(raw).decode()
    assert "environment_context" not in out
    user_recs = [
        r for r in _records(codex_to_claude_jsonl(raw))
        if r["type"] == "user" and isinstance(r["message"]["content"], str)
    ]
    assert len(user_recs) == 1


def test_looks_like_codex_accepts_rollout():
    assert looks_like_codex((FIXTURES / "rollout.jsonl").read_bytes())


def test_looks_like_codex_rejects_claude_trace():
    claude = (
        Path(__file__).parent / "agents" / "digest" / "fixtures"
        / "short.jsonl"
    )
    assert not looks_like_codex(claude.read_bytes())


def test_looks_like_codex_rejects_garbage():
    assert not looks_like_codex(b"")
    assert not looks_like_codex(b"not json\n")
    assert not looks_like_codex(b'{"type":"session_meta"}\n')  # no payload.id
