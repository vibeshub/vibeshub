from __future__ import annotations

import os
import time
from dataclasses import dataclass
from pathlib import Path

from vibeshub_client.reader import TranscriptReader


@dataclass
class SessionPaths:
    main_jsonl: Path
    subagents_dir: Path | None


def _encode_cwd(cwd: str) -> str:
    """
    Claude Code's transcript directory uses the absolute cwd with `/` replaced
    by `-`. For `/Users/x/repo` this gives `-Users-x-repo`.
    """
    return cwd.replace("/", "-")


def _find_subagents_dir(home: Path, transcript_dir: Path, session_id: str) -> Path | None:
    """Locate the `<session_id>/subagents` directory for a session.

    The fast path is a sibling of the main transcript. But when a session runs
    in a git worktree, Claude Code writes the main transcript under the repo's
    project dir while writing subagent transcripts under a project dir derived
    from the worktree cwd — so the two no longer share a parent. session_id is
    globally unique, so fall back to scanning every project dir for it.
    """
    sibling = transcript_dir / session_id / "subagents"
    if sibling.is_dir():
        return sibling
    projects = home / ".claude" / "projects"
    for match in sorted(projects.glob(f"*/{session_id}/subagents")):
        if match.is_dir():
            return match
    return None


class ClaudeCodeTranscriptReader(TranscriptReader):
    def platform_id(self) -> str:
        return "claude-code"

    def find_session_paths(self, hook_input: dict) -> SessionPaths:
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
            home / ".claude" / "projects" / _encode_cwd(cwd) / f"{session_id}.jsonl"
        )

        # Brief retry: the writer may not have flushed yet.
        for _ in range(2):
            for c in candidates:
                if c.is_file():
                    return SessionPaths(
                        main_jsonl=c,
                        subagents_dir=_find_subagents_dir(home, c.parent, session_id),
                    )
            time.sleep(0.2)

        # Final probe: even when main isn't found, surface subagents/ if it
        # exists (aborted-parent edge case).
        for c in candidates:
            subagents_dir = _find_subagents_dir(home, c.parent, session_id)
            if subagents_dir is not None:
                return SessionPaths(main_jsonl=c, subagents_dir=subagents_dir)

        return SessionPaths(main_jsonl=candidates[-1], subagents_dir=None)

    def link_subagents(self, paths: "SessionPaths", hook_input: dict) -> list:
        from vibeshub_client.subagent_link import link_subagents
        return link_subagents(paths.main_jsonl, paths.subagents_dir)

    # Back-compat shim — call sites in hooks may still use find_session().
    def find_session(self, hook_input: dict) -> Path:
        return self.find_session_paths(hook_input).main_jsonl
