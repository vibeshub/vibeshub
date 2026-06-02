from pathlib import Path

import pytest

from vibeshub_client.subagent_link import AgentEntry, link_subagents

FIXTURES = Path(__file__).parent / "fixtures" / "sessions"


def test_single_agent_links_by_description():
    base = FIXTURES / "single-agent"
    entries = link_subagents(base / "session.jsonl", base / "subagents")
    assert len(entries) == 1
    e = entries[0]
    assert e.agent_id == "a1111111111111111"
    assert e.tool_use_id == "toolu_01alpha"
    assert e.agent_type == "Explore"
    assert e.description == "Probe X"


def test_multi_agent_preserves_order():
    base = FIXTURES / "multi-agent"
    entries = link_subagents(base / "session.jsonl", base / "subagents")
    descs = sorted([e.description for e in entries])
    assert descs == ["Task A", "Task B", "Task C"]
    assert all(e.tool_use_id is not None for e in entries)


def test_parallel_same_desc_uses_timestamp_within_bucket():
    base = FIXTURES / "parallel-same-desc"
    entries = link_subagents(base / "session.jsonl", base / "subagents")
    assert len(entries) == 3
    assert all(e.tool_use_id is not None for e in entries)
    assert len({e.tool_use_id for e in entries}) == 3


def test_orphan_agent_gets_null_tool_use_id():
    base = FIXTURES / "orphan-agent"
    entries = link_subagents(base / "session.jsonl", base / "subagents")
    by_desc = {e.description: e for e in entries}
    assert "Task A" in by_desc
    assert by_desc["Task A"].tool_use_id is not None


def test_aborted_parent_no_main_jsonl():
    base = FIXTURES / "aborted-parent"
    entries = link_subagents(base / "session.jsonl", base / "subagents")
    # Main missing → subagents/ entries returned with tool_use_id=None
    # (not an empty list — orphan logic in §3.1 of design doc)
    assert len(entries) == 1
    assert entries[0].tool_use_id is None


def test_no_subagents_dir():
    base = FIXTURES / "single-agent"
    entries = link_subagents(base / "session.jsonl", subagents_dir=None)
    assert entries == []
