import os
from pathlib import Path

from cursor_reader import CursorTranscriptReader


def _make_transcript(home: Path, slug: str, uuid: str, *, with_sub: bool = False) -> Path:
    d = home / ".cursor" / "projects" / slug / "agent-transcripts" / uuid
    d.mkdir(parents=True, exist_ok=True)
    main = d / f"{uuid}.jsonl"
    main.write_text('{"role":"user","message":{"content":[{"type":"text","text":"hi"}]}}\n', encoding="utf-8")
    if with_sub:
        sub = d / "subagents"
        sub.mkdir(exist_ok=True)
        (sub / "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl").write_text(
            '{"role":"user","message":{"content":[{"type":"text","text":"sub"}]}}\n', encoding="utf-8")
    return main


def test_platform_id():
    assert CursorTranscriptReader().platform_id() == "cursor"


def test_explicit_transcript_path(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    main = _make_transcript(tmp_path, "Repo", "11111111-1111-1111-1111-111111111111", with_sub=True)
    paths = CursorTranscriptReader().find_session_paths({"transcript_path": str(main)})
    assert paths.main_jsonl == main
    assert paths.subagents_dir == main.parent / "subagents"


def test_session_id_lookup(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    uuid = "44444444-4444-4444-4444-444444444444"
    main = _make_transcript(tmp_path, "Repo", uuid)
    paths = CursorTranscriptReader().find_session_paths({"session_id": uuid})
    assert paths.main_jsonl == main


def test_newest_by_mtime_fallback(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    older = _make_transcript(tmp_path, "RepoA", "22222222-2222-2222-2222-222222222222")
    newer = _make_transcript(tmp_path, "RepoB", "33333333-3333-3333-3333-333333333333")
    os.utime(older, (1, 1))
    os.utime(newer, (10_000, 10_000))
    paths = CursorTranscriptReader().find_session_paths({})
    assert paths.main_jsonl == newer


def test_mtime_fallback_is_scoped_to_the_workspace_project(tmp_path, monkeypatch):
    # Another Cursor window on a different repo was active more recently.
    # With a workspace root in the payload, the fallback must stay inside
    # that workspace's project dir, never uploading the other repo's chat.
    monkeypatch.setenv("HOME", str(tmp_path))
    mine = _make_transcript(tmp_path, "Users-me-git-mine",
                            "44444444-4444-4444-4444-444444444444")
    other = _make_transcript(tmp_path, "Users-me-git-private",
                             "55555555-5555-5555-5555-555555555555")
    os.utime(mine, (1, 1))
    os.utime(other, (10_000, 10_000))
    paths = CursorTranscriptReader().find_session_paths(
        {"workspace_roots": ["/Users/me/git/mine"]})
    assert paths.main_jsonl == mine


def test_mtime_fallback_uses_global_scan_when_project_dir_unknown(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    only = _make_transcript(tmp_path, "SomeOpaqueName",
                            "66666666-6666-6666-6666-666666666666")
    paths = CursorTranscriptReader().find_session_paths(
        {"workspace_roots": ["/Users/me/git/nowhere"]})
    assert paths.main_jsonl == only
