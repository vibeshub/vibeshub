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


def test_find_session_paths_locates_sibling_subagents(tmp_path: Path, monkeypatch):
    # Normal (non-worktree) case: subagents/ sits beside the main transcript.
    home = tmp_path / "fakehome"
    project = home / ".claude" / "projects" / "-real-project"
    project.mkdir(parents=True)
    session_id = "abc123-session"
    target = project / f"{session_id}.jsonl"
    target.write_text("{}\n")
    subagents = project / session_id / "subagents"
    subagents.mkdir(parents=True)

    monkeypatch.setenv("HOME", str(home))
    reader = ClaudeCodeTranscriptReader()

    paths = reader.find_session_paths(
        {"session_id": session_id, "cwd": str(tmp_path), "transcript_path": str(target)}
    )
    assert paths.main_jsonl == target
    assert paths.subagents_dir == subagents


def test_find_session_paths_locates_worktree_subagents(tmp_path: Path, monkeypatch):
    # Worktree drift: Claude Code writes the main transcript under the repo's
    # project dir but the subagent transcripts under a project dir derived from
    # the worktree cwd. The two no longer share a parent, so deriving the
    # subagents dir as a sibling of the main transcript misses them.
    home = tmp_path / "fakehome"
    projects = home / ".claude" / "projects"
    repo_project = projects / "-Users-x-repo"
    repo_project.mkdir(parents=True)
    session_id = "abc123-session"
    target = repo_project / f"{session_id}.jsonl"
    target.write_text("{}\n")

    worktree_project = projects / "-Users-x-repo--claude-worktrees-feature"
    worktree_subagents = worktree_project / session_id / "subagents"
    worktree_subagents.mkdir(parents=True)

    monkeypatch.setenv("HOME", str(home))
    reader = ClaudeCodeTranscriptReader()

    paths = reader.find_session_paths(
        {"session_id": session_id, "cwd": str(tmp_path), "transcript_path": str(target)}
    )
    assert paths.main_jsonl == target
    assert paths.subagents_dir == worktree_subagents


def test_find_session_paths_no_subagents(tmp_path: Path, monkeypatch):
    # A session with no subagents at all: subagents_dir stays None.
    home = tmp_path / "fakehome"
    project = home / ".claude" / "projects" / "-real-project"
    project.mkdir(parents=True)
    session_id = "abc123-session"
    target = project / f"{session_id}.jsonl"
    target.write_text("{}\n")

    monkeypatch.setenv("HOME", str(home))
    reader = ClaudeCodeTranscriptReader()

    paths = reader.find_session_paths(
        {"session_id": session_id, "cwd": str(tmp_path), "transcript_path": str(target)}
    )
    assert paths.main_jsonl == target
    assert paths.subagents_dir is None
