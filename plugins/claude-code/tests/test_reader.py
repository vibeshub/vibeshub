from pathlib import Path

import pytest

from reader import ClaudeCodeTranscriptReader


def test_platform_id():
    reader = ClaudeCodeTranscriptReader()
    assert reader.platform_id() == "claude-code"


def test_find_session_locates_transcript(tmp_path: Path, monkeypatch):
    cwd = tmp_path / "myrepo"
    cwd.mkdir()

    home = tmp_path / "fakehome"
    encoded = "-" + str(cwd).replace("/", "-").lstrip("-")
    transcripts_dir = home / ".claude" / "projects" / encoded
    transcripts_dir.mkdir(parents=True)

    session_id = "abc123-session"
    target = transcripts_dir / f"{session_id}.jsonl"
    target.write_text("{}\n")

    monkeypatch.setenv("HOME", str(home))
    reader = ClaudeCodeTranscriptReader()

    found = reader.find_session({"session_id": session_id, "cwd": str(cwd)})
    assert found == target


def test_find_session_raises_when_missing(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    reader = ClaudeCodeTranscriptReader()
    with pytest.raises(FileNotFoundError):
        reader.find_session({"session_id": "nope", "cwd": str(tmp_path)})
