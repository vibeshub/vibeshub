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


def _synth_exploration_blob(reads: int, greps: int) -> bytes:
    """Synthesize a JSONL with N reads + M greps, no intervening text."""
    import json as _json
    lines: list[str] = []
    lines.append(_json.dumps({
        "type": "user", "uuid": "uStart",
        "message": {"content": "Find the auth handler"},
    }))
    for i in range(reads):
        lines.append(_json.dumps({
            "type": "assistant", "uuid": f"r{i}",
            "message": {"content": [{
                "type": "tool_use", "id": f"tr{i}", "name": "Read",
                "input": {"file_path": f"webapp/backend/app/file_{i}.py"},
            }]},
        }))
    for i in range(greps):
        lines.append(_json.dumps({
            "type": "assistant", "uuid": f"g{i}",
            "message": {"content": [{
                "type": "tool_use", "id": f"tg{i}", "name": "Grep",
                "input": {"pattern": "handler", "path": "webapp/backend"},
            }]},
        }))
    lines.append(_json.dumps({
        "type": "assistant", "uuid": "aEnd",
        "message": {"content": [{
            "type": "text", "text": "Found it in oauth.py.",
        }]},
    }))
    return ("\n".join(lines) + "\n").encode("utf-8")


def test_short_exploration_run_not_collapsed():
    # 5 reads is BELOW the threshold of 6
    blob = _synth_exploration_blob(reads=5, greps=0)
    out = distill(blob, subagent_blobs={})
    # All 5 reads still appear individually
    assert out.count("Read webapp/backend/app/file_") == 5
    assert "[exploration:" not in out


def test_long_exploration_run_is_collapsed():
    # 12 reads + 3 greps = 15 consecutive tool calls
    blob = _synth_exploration_blob(reads=12, greps=3)
    out = distill(blob, subagent_blobs={}, target_tokens=200)
    # The individual Reads are gone, replaced with one collapse line
    assert out.count("Read webapp/backend/app/file_") == 0
    assert "[exploration:" in out
    # Spine survives
    assert "Find the auth handler" in out
    assert "Found it in oauth.py." in out


def test_distill_carries_target_and_hardcap_kwargs():
    # Smoke test that the signature accepts the new kwargs
    blob = _synth_exploration_blob(reads=1, greps=0)
    out = distill(
        blob, subagent_blobs={}, target_tokens=60_000, hard_cap_tokens=200_000,
    )
    assert isinstance(out, str)


def test_truncation_when_over_hardcap_keeps_head_and_tail():
    blob = _synth_exploration_blob(reads=200, greps=0)
    # Force the hard cap to trip by setting an absurdly small cap; the
    # adaptive collapse won't help because every event collapses to one line
    # already after the exploration pass. We bypass collapse by setting the
    # target VERY low and the hard cap also low.
    out = distill(
        blob, subagent_blobs={}, target_tokens=10, hard_cap_tokens=20,
    )
    assert "[… elided" in out
    # First and last events still present
    assert "Find the auth handler" in out
    assert "Found it in oauth.py." in out


def test_spawn_agent_dispatch_renders_like_task():
    # Codex-converted traces dispatch subagents via spawn_agent tool_uses;
    # the converter gives them the same input keys the Task branch reads
    # (subagent_type, description), so the distiller must emit the same
    # Subagent[...] one-liner instead of a bare tool name.
    blob = (
        b'{"type":"assistant","uuid":"a9","message":{"content":[{"type":'
        b'"tool_use","id":"c_spawn","name":"spawn_agent","input":{'
        b'"subagent_type":"default","model":"default",'
        b'"prompt":"Review src/util.ts for edge cases and report back.",'
        b'"description":"Review src/util.ts for edge cases and report back.'
        b'"}}]}}\n'
    )
    out = distill(blob, subagent_blobs={})
    assert (
        "Subagent[default]: Review src/util.ts for edge cases and report"
        in out
    )
    assert "spawn_agent" not in out


def test_codex_shell_renders_command_like_bash():
    # codex_convert emits shell tool_uses with the same input keys as Bash
    # (command, description); the command must survive into the one-liner.
    blob = (
        b'{"type":"assistant","uuid":"a1","message":{"content":[{"type":'
        b'"tool_use","id":"c1","name":"shell","input":{'
        b'"command":"git diff main --stat","description":"/repo"}}]}}\n'
    )
    out = distill(blob, subagent_blobs={})
    assert "shell: git diff main --stat" in out


def test_codex_update_plan_is_dropped_as_scratchpad():
    # update_plan is Codex's TodoWrite: plan churn, not work.
    blob = (
        b'{"type":"assistant","uuid":"a1","message":{"content":[{"type":'
        b'"tool_use","id":"c1","name":"update_plan","input":{'
        b'"plan":[{"step":"x","status":"in_progress"}],"explanation":""}}]}}\n'
    )
    out = distill(blob, subagent_blobs={})
    assert "update_plan" not in out
