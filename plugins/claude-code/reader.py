from __future__ import annotations

import os
import time
from pathlib import Path

from vibeshub_client.reader import TranscriptReader


def _encode_cwd(cwd: str) -> str:
    """
    Claude Code's transcript directory uses the absolute cwd with `/` replaced
    by `-`. For `/Users/x/repo` this gives `-Users-x-repo`.
    """
    return cwd.replace("/", "-")


class ClaudeCodeTranscriptReader(TranscriptReader):
    def platform_id(self) -> str:
        return "claude-code"

    def find_session(self, hook_input: dict) -> Path:
        session_id = hook_input.get("session_id")
        cwd = hook_input.get("cwd") or os.getcwd()
        if not session_id:
            raise ValueError("hook_input missing session_id")

        home = Path(os.environ.get("HOME", "/"))
        # Claude Code hook payloads carry the canonical transcript_path.
        # cwd-encoding is fragile — it breaks when the shell drifts into a
        # subdir mid-session — so prefer the payload path when present.
        candidates: list[Path] = []
        payload_path = hook_input.get("transcript_path")
        if payload_path:
            candidates.append(Path(payload_path))
        candidates.append(
            home
            / ".claude"
            / "projects"
            / _encode_cwd(cwd)
            / f"{session_id}.jsonl"
        )

        # Brief retry: the writer may not have flushed yet.
        for _ in range(2):
            for c in candidates:
                if c.is_file():
                    return c
            time.sleep(0.2)

        raise FileNotFoundError(f"transcript not found: {candidates[-1]}")
