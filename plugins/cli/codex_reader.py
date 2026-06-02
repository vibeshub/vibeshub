from __future__ import annotations

import os
import time
from pathlib import Path

from reader import SessionPaths
from vibeshub_client.reader import TranscriptReader
from vibeshub_client.codex_subagent_link import link_codex_subagents


def _codex_home() -> Path:
    return Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))


class CodexTranscriptReader(TranscriptReader):
    def platform_id(self) -> str:
        return "codex"

    def find_session_paths(self, hook_input: dict) -> SessionPaths:
        # Codex PostToolUse payloads carry transcript_path = the rollout file.
        payload_path = hook_input.get("transcript_path")
        if payload_path:
            p = Path(payload_path)
            for _ in range(2):
                if p.is_file():
                    return SessionPaths(main_jsonl=p, subagents_dir=None)
                time.sleep(0.2)
            return SessionPaths(main_jsonl=p, subagents_dir=None)

        # Manual/fallback: newest rollout under $CODEX_HOME/sessions.
        sessions = _codex_home() / "sessions"
        rollouts = sorted(
            sessions.glob("**/rollout-*.jsonl"),
            key=lambda f: f.stat().st_mtime,
            reverse=True,
        )
        main = rollouts[0] if rollouts else sessions / "missing.jsonl"
        return SessionPaths(main_jsonl=main, subagents_dir=None)

    def link_subagents(self, paths: SessionPaths, hook_input: dict) -> list:
        return link_codex_subagents(paths.main_jsonl, hook_input)

    def find_session(self, hook_input: dict) -> Path:
        return self.find_session_paths(hook_input).main_jsonl
