from pathlib import Path

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


def test_find_session_returns_nonexistent_when_missing(tmp_path: Path, monkeypatch):
    # The shim now returns the candidate path even when the file doesn't exist
    # so the pipeline can decide what to do (skip with a clear reason instead
    # of crashing). Callers must check is_file() themselves.
    monkeypatch.setenv("HOME", str(tmp_path))
    reader = ClaudeCodeTranscriptReader()
    found = reader.find_session({"session_id": "nope", "cwd": str(tmp_path)})
    assert not found.is_file()


def test_find_session_prefers_payload_transcript_path(tmp_path: Path, monkeypatch):
    # Claude Code passes `transcript_path` in PostToolUse payloads. It is the
    # canonical location of the transcript; cwd-derived encoding is fragile
    # (breaks when the shell drifts into a subdir mid-session).
    home = tmp_path / "fakehome"
    transcripts_dir = home / ".claude" / "projects" / "-real-project"
    transcripts_dir.mkdir(parents=True)
    session_id = "abc123-session"
    target = transcripts_dir / f"{session_id}.jsonl"
    target.write_text("{}\n")

    monkeypatch.setenv("HOME", str(home))
    reader = ClaudeCodeTranscriptReader()

    drifted_cwd = tmp_path / "drifted" / "subdir"
    found = reader.find_session(
        {
            "session_id": session_id,
            "cwd": str(drifted_cwd),
            "transcript_path": str(target),
        }
    )
    assert found == target


def test_find_session_falls_back_when_payload_path_missing(
    tmp_path: Path, monkeypatch
):
    # If the payload's transcript_path doesn't exist on disk, fall back to the
    # cwd-derived path so older Claude Code versions still work.
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

    found = reader.find_session(
        {
            "session_id": session_id,
            "cwd": str(cwd),
            "transcript_path": str(tmp_path / "does" / "not" / "exist.jsonl"),
        }
    )
    assert found == target
