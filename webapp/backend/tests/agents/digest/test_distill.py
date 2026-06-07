from pathlib import Path

from app.agents.digest.distill import distill

FIXTURES = Path(__file__).parent / "fixtures"


def _read(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def test_user_prompts_are_verbatim():
    out = distill(_read("short.jsonl"), subagent_blobs={})
    assert "Add a /healthcheck route" in out


def test_assistant_text_is_verbatim():
    out = distill(_read("short.jsonl"), subagent_blobs={})
    assert "I'll add it." in out
    assert "Done." in out


def test_tool_use_collapses_to_one_liner():
    out = distill(_read("short.jsonl"), subagent_blobs={})
    assert "Edit webapp/backend/app/main.py" in out
    # The verbose new_string content must NOT appear
    assert "NEW WITH LOTS OF CONTENT" not in out
    assert "OLD" not in out


def test_tool_result_collapses_to_status_plus_prefix():
    out = distill(_read("short.jsonl"), subagent_blobs={})
    # Result body kept (short here, fits under 80 chars)
    assert "ok" in out


def test_tier4_events_are_dropped():
    out = distill(_read("short.jsonl"), subagent_blobs={})
    assert "permission-mode" not in out
    assert "acceptEdits" not in out
    assert "ai-title" not in out
    assert "Add healthcheck" not in out  # the ai-title text itself
    assert "file-history-snapshot" not in out


def test_each_line_carries_source_uuid():
    out = distill(_read("short.jsonl"), subagent_blobs={})
    # User prompt line carries its uuid; LLM uses these as anchor candidates
    assert "[u1]" in out
    assert "[a1]" in out
    assert "[a3]" in out
    # Dropped events do NOT appear as anchor candidates
    assert "[ai-title]" not in out


def test_emits_event_uuids_helper():
    from app.agents.digest.distill import distill_with_uuids
    text, uuids = distill_with_uuids(_read("short.jsonl"), subagent_blobs={})
    assert "u1" in uuids
    assert "a1" in uuids
    assert "a3" in uuids
    # The Edit tool_use is collapsed but its uuid is still anchorable
    assert "a2" in uuids


def test_determinism_same_input_same_output():
    a = distill(_read("short.jsonl"), subagent_blobs={})
    b = distill(_read("short.jsonl"), subagent_blobs={})
    assert a == b


def test_adjacent_duplicate_events_are_deduped():
    """Two events with identical payload but different uuids should
    collapse to one line. Some Claude Code hooks double-fire."""
    import json as _json
    dupe = _json.dumps({
        "type": "assistant", "uuid": "dup-a",
        "message": {"content": [{"type": "text", "text": "Same payload"}]},
    })
    dupe2 = _json.dumps({
        "type": "assistant", "uuid": "dup-b",
        "message": {"content": [{"type": "text", "text": "Same payload"}]},
    })
    blob = (dupe + "\n" + dupe2 + "\n").encode("utf-8")
    out = distill(blob, subagent_blobs={})
    # Only one line in the output
    assert out.count("Same payload") == 1


def test_subagent_collapses_to_one_line():
    parent = _read("with_subagent.jsonl")
    child = _read("with_subagent_child.jsonl")
    # The plugin's storage names subagent blobs by tool_use_id (see
    # trace_service.create_or_update_trace). The distiller takes the
    # same dict shape.
    out = distill(parent, subagent_blobs={"tu1": child})
    # One subagent line, not the child's three events
    matches = [ln for ln in out.splitlines() if ln.startswith("[a1]")]
    assert len(matches) == 1
    line = matches[0]
    assert "Subagent[code-reviewer]" in line
    assert "Audit auth" in line
    # The child's final assistant text is the summary
    assert "Two issues" in line
    # The child's interior is NEVER inlined
    assert "webapp/backend/app/auth/oauth.py" not in out


def test_subagent_missing_blob_falls_back_to_action_count():
    parent = _read("with_subagent.jsonl")
    out = distill(parent, subagent_blobs={})  # no child blob given
    line = next(ln for ln in out.splitlines() if ln.startswith("[a1]"))
    # Falls back to a non-empty descriptor so the LLM has SOMETHING to read
    assert "Subagent[code-reviewer]" in line
    assert "Audit auth" in line
