from __future__ import annotations

import os
from typing import Mapping

from reader import ClaudeCodeTranscriptReader
from codex_reader import CodexTranscriptReader


def select_adapter(payload: dict, env: Mapping[str, str] | None = None):
    """Pick the per-runtime adapter. transcript_path is the strongest signal
    (Claude under ~/.claude, Codex under ~/.codex/sessions); CODEX_HOME breaks
    ties for the manual/command path."""
    env = os.environ if env is None else env
    tp = payload.get("transcript_path") or ""
    if "/.codex/sessions/" in tp:
        return CodexTranscriptReader()
    if "/.claude/" in tp:
        return ClaudeCodeTranscriptReader()
    if env.get("CODEX_HOME"):
        return CodexTranscriptReader()
    return ClaudeCodeTranscriptReader()
