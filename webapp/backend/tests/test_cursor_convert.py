"""Tests for app.cursor_convert, the backend port of the frontend's
former cursorExport.ts converter (deleted when conversion moved
server-side to ingest).

The *.golden.jsonl fixtures started as the actual output of the
frontend converter (cursorToJsonl) over the matching *.jsonl
transcript, captured via a one-shot vitest run before that converter
was removed, then had tool names/inputs rewritten when the backend
gained Claude-dialect tool normalization (StrReplace->Edit etc.). They
pin determinism: digest chapter anchor_uuids reference the synthetic
cursor-rec-<n> uuids and the viewer resolves them against the same
converted jsonl this module produces, so record order and uuid
assignment must never drift.
"""
import json
from pathlib import Path

import pytest

from app.cursor_convert import cursor_to_claude_jsonl, looks_like_cursor

FIXTURES = Path(__file__).parent / "fixtures" / "cursor"


def _records(blob: bytes) -> list[dict]:
    return [json.loads(line) for line in blob.splitlines() if line.strip()]


@pytest.mark.parametrize(
    "name", ["transcript", "transcript_subagent", "kitchen_sink"],
)
def test_conversion_matches_golden(name):
    raw = (FIXTURES / f"{name}.jsonl").read_bytes()
    golden = (FIXTURES / f"{name}.golden.jsonl").read_bytes()
    assert _records(cursor_to_claude_jsonl(raw)) == _records(golden)


def test_uuid_sequence_is_positional():
    # Anchors only resolve because uuids are assigned by record creation
    # order: cursor-rec-<n>, no gaps, no reordering.
    raw = (FIXTURES / "kitchen_sink.jsonl").read_bytes()
    recs = _records(cursor_to_claude_jsonl(raw))
    assert [r["uuid"] for r in recs] == [
        f"cursor-rec-{i}" for i in range(len(recs))
    ]


def test_user_envelope_is_stripped():
    raw = (FIXTURES / "transcript.jsonl").read_bytes()
    recs = _records(cursor_to_claude_jsonl(raw))
    users = [r for r in recs if r["type"] == "user"]
    assert users[0]["message"]["content"] == (
        "Review the frontend for likely bugs."
    )
    assert users[0]["timestamp"] == "2026-06-04T02:30:00.000Z"


def test_task_and_subagent_get_deterministic_agent_ids():
    raw = (FIXTURES / "kitchen_sink.jsonl").read_bytes()
    recs = _records(cursor_to_claude_jsonl(raw))
    tool_uses = [
        b
        for r in recs if r["type"] == "assistant"
        for b in r["message"]["content"] if b["type"] == "tool_use"
    ]
    agent_ids = [
        b["id"] for b in tool_uses if b["name"] in ("Task", "Subagent")
    ]
    assert agent_ids == ["cursor-agent-0", "cursor-agent-1"]


def test_tool_calls_are_normalized_to_claude_dialect():
    # Cursor's native tool vocabulary maps onto the Claude names the
    # viewer's Changes view and the digest key on: StrReplace becomes Edit
    # with file_path, Shell becomes Bash, Read/ReadFile carry file_path.
    # Unmapped tools (AwaitShell, Grep) pass through untouched.
    raw = (
        b'{"role":"assistant","message":{"content":['
        b'{"type":"tool_use","name":"StrReplace","input":{'
        b'"path":"/repo/a.ts","old_string":"x","new_string":"y"}},'
        b'{"type":"tool_use","name":"Shell","input":{"command":"ls",'
        b'"description":"list","block_until_ms":500}},'
        b'{"type":"tool_use","name":"Read","input":{'
        b'"path":"/repo/a.ts","limit":10}},'
        b'{"type":"tool_use","name":"ReadFile","input":{"path":"/repo/b.ts"}},'
        b'{"type":"tool_use","name":"AwaitShell","input":{"id":"sh-1"}},'
        b'{"type":"tool_use","name":"Grep","input":{'
        b'"pattern":"p","path":"/repo"}}'
        b"]}}\n"
    )
    recs = _records(cursor_to_claude_jsonl(raw))
    calls = [
        b
        for r in recs if r["type"] == "assistant"
        for b in r["message"]["content"] if b["type"] == "tool_use"
    ]
    assert [c["name"] for c in calls] == [
        "Edit", "Bash", "Read", "Read", "AwaitShell", "Grep",
    ]
    assert calls[0]["input"] == {
        "file_path": "/repo/a.ts", "old_string": "x", "new_string": "y",
    }
    # Renames touch only the mapped keys; everything else survives as is.
    assert calls[1]["input"] == {
        "command": "ls", "description": "list", "block_until_ms": 500,
    }
    assert calls[2]["input"] == {"file_path": "/repo/a.ts", "limit": 10}
    assert calls[3]["input"] == {"file_path": "/repo/b.ts"}
    assert calls[4]["input"] == {"id": "sh-1"}
    # Claude's Grep already takes path, so Grep is not renamed.
    assert calls[5]["input"] == {"pattern": "p", "path": "/repo"}


def test_looks_like_cursor_accepts_transcript():
    assert looks_like_cursor((FIXTURES / "transcript.jsonl").read_bytes())


def test_looks_like_cursor_rejects_claude_and_codex():
    claude = (
        Path(__file__).parent / "agents" / "digest" / "fixtures"
        / "short.jsonl"
    )
    assert not looks_like_cursor(claude.read_bytes())
    codex = Path(__file__).parent / "fixtures" / "codex" / "rollout.jsonl"
    assert not looks_like_cursor(codex.read_bytes())


def test_looks_like_cursor_rejects_garbage():
    assert not looks_like_cursor(b"")
    assert not looks_like_cursor(b"not json\n")
    # content must be a block list, not a string
    assert not looks_like_cursor(
        b'{"role":"user","message":{"content":"x"}}\n'
    )


def test_only_first_timestamp_tag_is_stripped():
    # JS String.replace without the g flag strips only the first match;
    # later <timestamp> tags survive into the user text verbatim.
    raw = (
        b'{"role":"user","message":{"content":[{"type":"text","text":'
        b'"<timestamp>Monday, Jun 1, 2026, 9:05 AM (UTC+0)</timestamp>'
        b' keep <timestamp>second</timestamp> tail"}]}}\n'
    )
    recs = _records(cursor_to_claude_jsonl(raw))
    user = [r for r in recs if r["type"] == "user"][0]
    assert user["message"]["content"] == (
        "keep <timestamp>second</timestamp> tail"
    )


def test_sept_month_form_parses():
    # JS Date.parse accepts "Sept"; strptime %b/%B do not, so the port
    # normalizes it rather than silently dropping the timestamp.
    raw = (
        b'{"role":"user","message":{"content":[{"type":"text","text":'
        b'"<timestamp>Tuesday, Sept 15, 2026, 1:00 PM (UTC+0)</timestamp>'
        b'\\n<user_query>q</user_query>"}]}}\n'
    )
    recs = _records(cursor_to_claude_jsonl(raw))
    user = [r for r in recs if r["type"] == "user"][0]
    assert user["timestamp"] == "2026-09-15T13:00:00.000Z"
