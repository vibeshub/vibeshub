from __future__ import annotations

import os
from typing import Mapping

from reader import ClaudeCodeTranscriptReader
from codex_reader import CodexTranscriptReader
from cursor_reader import CursorTranscriptReader


def select_adapter(payload: dict, env: Mapping[str, str] | None = None):
    """Pick the per-runtime adapter. VIBESHUB_PLATFORM is an explicit override
    set by our Cursor hooks.json (Cursor's afterShellExecution payload carries
    no transcript_path). Otherwise transcript_path is the strongest signal
    (Claude under ~/.claude, Codex under ~/.codex/sessions, Cursor under
    ~/.cursor/projects); CODEX_HOME breaks ties for the manual/command path."""
    env = os.environ if env is None else env
    tp = payload.get("transcript_path") or ""
    plugin_root = payload.get("plugin_root") or ""
    if env.get("VIBESHUB_PLATFORM") == "cursor":
        return CursorTranscriptReader()
    if "/.codex/sessions/" in tp:
        return CodexTranscriptReader()
    if "/.codex/plugins/" in plugin_root:
        return CodexTranscriptReader()
    if "/.cursor/projects/" in tp:
        return CursorTranscriptReader()
    if "/.claude/" in tp:
        return ClaudeCodeTranscriptReader()
    if env.get("CODEX_HOME"):
        return CodexTranscriptReader()
    if not env.get("CLAUDE_PLUGIN_ROOT") and (
        env.get("CODEX_THREAD_ID") or env.get("CODEX_SANDBOX")
    ):
        return CodexTranscriptReader()
    return ClaudeCodeTranscriptReader()
