from pathlib import Path
from codex_reader import CodexTranscriptReader


def test_uses_payload_transcript_path(tmp_path):
    rollout = tmp_path / "rollout-2026-05-31T09-20-17-019e7ed6.jsonl"
    rollout.write_bytes(b'{"type":"session_meta","payload":{"id":"019e7ed6"}}\n')
    reader = CodexTranscriptReader()
    paths = reader.find_session_paths({"transcript_path": str(rollout)})
    assert paths.main_jsonl == rollout
    assert paths.subagents_dir is None
    assert reader.platform_id() == "codex"


def test_falls_back_to_newest_rollout(tmp_path, monkeypatch):
    sessions = tmp_path / "sessions" / "2026" / "05" / "31"
    sessions.mkdir(parents=True)
    old = sessions / "rollout-2026-05-31T09-00-00-aaa.jsonl"
    new = sessions / "rollout-2026-05-31T10-00-00-bbb.jsonl"
    old.write_bytes(b"{}\n")
    new.write_bytes(b"{}\n")
    import os
    os.utime(new, (new.stat().st_atime, old.stat().st_mtime + 100))
    monkeypatch.setenv("CODEX_HOME", str(tmp_path))
    reader = CodexTranscriptReader()
    paths = reader.find_session_paths({})
    assert paths.main_jsonl == new


def _rollout(dir_, name, *, thread_source="cli", mtime):
    p = dir_ / name
    p.write_bytes(
        b'{"type":"session_meta","payload":{"id":"x","thread_source":"'
        + thread_source.encode() + b'"}}\n'
    )
    import os
    os.utime(p, (mtime, mtime))
    return p


def test_fallback_prefers_codex_thread_id(tmp_path, monkeypatch):
    sessions = tmp_path / "sessions" / "2026" / "05" / "31"
    sessions.mkdir(parents=True)
    mine = _rollout(sessions, "rollout-2026-05-31T09-00-00-0199aaaa-1111.jsonl", mtime=100)
    _rollout(sessions, "rollout-2026-05-31T10-00-00-0199bbbb-2222.jsonl", mtime=200)
    monkeypatch.setenv("CODEX_HOME", str(tmp_path))
    monkeypatch.setenv("CODEX_THREAD_ID", "0199aaaa-1111")
    paths = CodexTranscriptReader().find_session_paths({})
    assert paths.main_jsonl == mine


def test_fallback_skips_subagent_rollouts(tmp_path, monkeypatch):
    sessions = tmp_path / "sessions" / "2026" / "05" / "31"
    sessions.mkdir(parents=True)
    main = _rollout(sessions, "rollout-2026-05-31T09-00-00-aaa.jsonl", mtime=100)
    _rollout(sessions, "rollout-2026-05-31T10-00-00-bbb.jsonl",
             thread_source="subagent", mtime=200)
    monkeypatch.setenv("CODEX_HOME", str(tmp_path))
    monkeypatch.delenv("CODEX_THREAD_ID", raising=False)
    paths = CodexTranscriptReader().find_session_paths({})
    assert paths.main_jsonl == main
