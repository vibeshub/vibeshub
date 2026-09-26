from __future__ import annotations

import json
import os
import time
from pathlib import Path

from reader import SessionPaths
from vibeshub_client.reader import TranscriptReader
from vibeshub_client.codex_subagent_link import link_codex_subagents


def _codex_home() -> Path:
    return Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))


def _is_subagent_rollout(path: Path) -> bool:
    """True when the rollout's session_meta says thread_source == subagent.
    Unreadable or malformed headers count as not-a-subagent so the fallback
    still returns *something* for the user to inspect."""
    try:
        with path.open("rb") as fh:
            first = fh.readline()
        rec = json.loads(first)
    except (OSError, ValueError):
        return False
    if not isinstance(rec, dict):
        return False
    payload = rec.get("payload")
    return isinstance(payload, dict) and payload.get("thread_source") == "subagent"


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

        sessions = _codex_home() / "sessions"

        # Manual path (share-trace under Codex): the shell exports
        # CODEX_THREAD_ID, and the rollout filename ends in that id, so pick
        # *this* thread rather than whichever rollout was written last (a
        # subagent, a guardian, or another window's private session).
        thread_id = os.environ.get("CODEX_THREAD_ID")
        if thread_id:
            for cand in sessions.glob(f"**/rollout-*-{thread_id}.jsonl"):
                if cand.is_file():
                    return SessionPaths(main_jsonl=cand, subagents_dir=None)

        # Fallback: newest top-level rollout under $CODEX_HOME/sessions,
        # skipping subagent rollouts (they are never the user's session).
        rollouts = sorted(
            sessions.glob("**/rollout-*.jsonl"),
            key=lambda f: f.stat().st_mtime,
            reverse=True,
        )
        main = next(
            (r for r in rollouts if not _is_subagent_rollout(r)),
            sessions / "missing.jsonl",
        )
        return SessionPaths(main_jsonl=main, subagents_dir=None)

    def link_subagents(self, paths: SessionPaths, hook_input: dict) -> list:
        return link_codex_subagents(paths.main_jsonl, hook_input)

    def find_session(self, hook_input: dict) -> Path:
        return self.find_session_paths(hook_input).main_jsonl
