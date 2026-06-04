from pathlib import Path

from vibeshub_client.cursor_subagent_link import link_cursor_subagents

FIXTURES = Path(__file__).parent / "fixtures" / "sessions"


def test_links_parallel_identical_prompt_dispatches():
    base = FIXTURES / "cursor-parallel"
    entries = link_cursor_subagents(base / "session.jsonl", base / "subagents")
    assert len(entries) == 3
    # Each child gets a distinct deterministic id matching its dispatch ordinal.
    ids = sorted(e.tool_use_id for e in entries)
    assert ids == ["cursor-agent-0", "cursor-agent-1", "cursor-agent-2"]
    # Agent type comes from the dispatch input; meta is synthesized in-memory.
    assert all(e.agent_type == "explore" for e in entries)
    assert all(e.meta is not None and e.meta["toolUseId"] == e.tool_use_id for e in entries)
    # agent_id is the child file stem (UUID).
    assert all(len(e.agent_id) == 36 for e in entries)


def test_unmatched_child_is_orphan():
    # No readable dispatches -> every child is an orphan (tool_use_id None).
    base = FIXTURES / "cursor-parallel"
    entries = link_cursor_subagents(Path("/nonexistent/session.jsonl"), base / "subagents")
    assert len(entries) == 3
    assert all(e.tool_use_id is None for e in entries)


def test_no_subagents_dir_returns_empty():
    assert link_cursor_subagents(Path("/nope/session.jsonl"), None) == []
