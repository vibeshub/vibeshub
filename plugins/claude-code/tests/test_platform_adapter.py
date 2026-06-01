from platform_adapter import select_adapter


def test_selects_codex_by_transcript_path():
    r = select_adapter({"transcript_path": "/Users/x/.codex/sessions/2026/05/31/rollout-a.jsonl"}, env={})
    assert r.platform_id() == "codex"


def test_selects_claude_by_transcript_path():
    r = select_adapter({"transcript_path": "/Users/x/.claude/projects/-x/abc.jsonl"}, env={})
    assert r.platform_id() == "claude-code"


def test_selects_codex_by_env_when_path_ambiguous():
    assert select_adapter({}, env={"CODEX_HOME": "/Users/x/.codex"}).platform_id() == "codex"
    assert select_adapter({}, env={}).platform_id() == "claude-code"
