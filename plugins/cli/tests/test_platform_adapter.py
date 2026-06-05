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


def test_selects_codex_by_codex_thread_env_when_home_missing():
    assert select_adapter({}, env={"CODEX_THREAD_ID": "019e952d-758f"}).platform_id() == "codex"


def test_claude_plugin_root_takes_precedence_over_codex_thread_env():
    r = select_adapter(
        {"plugin_root": "/Users/x/src/vibeshub/plugins/cli"},
        env={
            "CLAUDE_PLUGIN_ROOT": "/Users/x/src/vibeshub/plugins/cli",
            "CODEX_THREAD_ID": "019e952d-758f",
        },
    )
    assert r.platform_id() == "claude-code"


def test_selects_codex_by_plugin_root_when_env_missing():
    r = select_adapter(
        {"plugin_root": "/Users/x/.codex/plugins/cache/vibeshub/vibeshub/0.4.0"},
        env={},
    )
    assert r.platform_id() == "codex"


def test_selects_cursor_by_transcript_path():
    r = select_adapter(
        {"transcript_path": "/Users/x/.cursor/projects/Repo/agent-transcripts/ID/ID.jsonl"},
        env={},
    )
    assert r.platform_id() == "cursor"


def test_selects_cursor_by_env_signal():
    r = select_adapter({"cwd": "/Users/x/repo"}, env={"VIBESHUB_PLATFORM": "cursor"})
    assert r.platform_id() == "cursor"
