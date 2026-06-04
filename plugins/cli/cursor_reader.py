from __future__ import annotations

from pathlib import Path

from reader import SessionPaths
from vibeshub_client.reader import TranscriptReader
from vibeshub_client.cursor_subagent_link import link_cursor_subagents


def _projects_root() -> Path:
    return Path.home() / ".cursor" / "projects"


def _subagents_dir(main_jsonl: Path) -> Path | None:
    d = main_jsonl.parent / "subagents"
    return d if d.is_dir() else None


class CursorTranscriptReader(TranscriptReader):
    def platform_id(self) -> str:
        return "cursor"

    def find_session_paths(self, hook_input: dict) -> SessionPaths:
        # 1. Explicit transcript path in the payload.
        payload_path = hook_input.get("transcript_path")
        if payload_path:
            p = Path(payload_path)
            return SessionPaths(main_jsonl=p, subagents_dir=_subagents_dir(p))

        # 2. A session/conversation id -> agent-transcripts/<id>/<id>.jsonl.
        sid = hook_input.get("session_id") or hook_input.get("conversation_id")
        if sid:
            for cand in _projects_root().glob(f"*/agent-transcripts/{sid}/{sid}.jsonl"):
                return SessionPaths(main_jsonl=cand, subagents_dir=_subagents_dir(cand))

        # 3. Newest agent transcript by mtime (the just-finished session). The
        # glob matches only main transcripts (<proj>/agent-transcripts/<uuid>/
        # <uuid>.jsonl); subagent files live one level deeper and are excluded.
        transcripts = sorted(
            _projects_root().glob("*/agent-transcripts/*/*.jsonl"),
            key=lambda f: f.stat().st_mtime,
            reverse=True,
        )
        main = transcripts[0] if transcripts else _projects_root() / "missing.jsonl"
        return SessionPaths(main_jsonl=main, subagents_dir=_subagents_dir(main))

    def link_subagents(self, paths: SessionPaths, hook_input: dict) -> list:
        return link_cursor_subagents(paths.main_jsonl, paths.subagents_dir)

    def find_session(self, hook_input: dict) -> Path:
        return self.find_session_paths(hook_input).main_jsonl
