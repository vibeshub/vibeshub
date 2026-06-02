import json
import sqlite3
from pathlib import Path

from vibeshub_client.codex_subagent_link import link_codex_subagents


def _write(p: Path, records: list[dict]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("\n".join(json.dumps(r) for r in records) + "\n", encoding="utf-8")


def _build_codex_home(tmp_path: Path) -> Path:
    home = tmp_path / ".codex"
    day = home / "sessions" / "2026" / "05" / "31"
    main_id = "019e7ed1-0400-7f03-ba68-11f9a59e6f11"
    child_id = "019e7f09-bca2-7150-ac2b-54f7b075a2ea"
    guardian_id = "019e7f0a-065b-7e33-8208-8c8481cb276f"

    main = day / f"rollout-2026-05-31T09-14-47-{main_id}.jsonl"
    _write(main, [
        {"type": "session_meta", "payload": {"id": main_id}},
        {"type": "response_item", "payload": {"type": "function_call",
            "name": "spawn_agent", "call_id": "call_spawn",
            "arguments": json.dumps({"agent_type": "default", "message": "go"})}},
        {"type": "response_item", "payload": {"type": "function_call_output",
            "call_id": "call_spawn",
            "output": json.dumps({"agent_id": child_id, "nickname": "Godel"})}},
    ])
    _write(day / f"rollout-...-{child_id}.jsonl", [
        {"type": "session_meta", "payload": {"id": child_id, "thread_source": "subagent",
            "forked_from_id": main_id,
            "source": {"subagent": {"thread_spawn": {"parent_thread_id": main_id,
                "agent_role": "default", "agent_nickname": "Godel"}}}}},
    ])
    _write(day / f"rollout-...-{guardian_id}.jsonl", [
        {"type": "session_meta", "payload": {"id": guardian_id, "thread_source": "subagent",
            "forked_from_id": main_id,
            "source": {"subagent": {"other": "guardian"}}}},
    ])

    db = home / "state_5.sqlite"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, "
                "agent_role TEXT, agent_nickname TEXT, model TEXT, first_user_message TEXT, thread_source TEXT)")
    con.execute("CREATE TABLE thread_spawn_edges (parent_thread_id TEXT, child_thread_id TEXT, status TEXT)")
    con.execute("INSERT INTO threads VALUES (?,?,?,?,?,?,?)",
                (child_id, str(day / f"rollout-...-{child_id}.jsonl"),
                 "default", "Godel", "gpt-5.5", "go", "subagent"))
    con.execute("INSERT INTO thread_spawn_edges VALUES (?,?,?)", (main_id, child_id, "closed"))
    con.commit(); con.close()
    return main


def test_links_user_subagent_and_includes_guardian(tmp_path, monkeypatch):
    main = _build_codex_home(tmp_path)
    monkeypatch.setenv("CODEX_HOME", str(tmp_path / ".codex"))

    entries = link_codex_subagents(main, {})
    by_id = {e.agent_id: e for e in entries}

    child = by_id["019e7f09-bca2-7150-ac2b-54f7b075a2ea"]
    assert child.tool_use_id == "call_spawn"      # cross-linked from spawn output
    assert child.agent_type == "default"
    assert child.meta["nickname"] == "Godel"

    guardian = by_id["019e7f0a-065b-7e33-8208-8c8481cb276f"]
    assert guardian.tool_use_id is None           # no user spawn call
    assert guardian.agent_type == "guardian"      # stored but hidden by the frontend


def test_glob_fallback_when_db_absent(tmp_path, monkeypatch):
    main = _build_codex_home(tmp_path)
    (tmp_path / ".codex" / "state_5.sqlite").unlink()
    monkeypatch.setenv("CODEX_HOME", str(tmp_path / ".codex"))

    entries = link_codex_subagents(main, {})
    ids = {e.agent_id for e in entries}
    assert "019e7f09-bca2-7150-ac2b-54f7b075a2ea" in ids   # still found via header glob
    child = next(e for e in entries if e.agent_id.startswith("019e7f09"))
    assert child.tool_use_id == "call_spawn"               # linkage survives without the DB
