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
