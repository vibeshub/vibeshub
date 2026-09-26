from __future__ import annotations

from pathlib import Path

from reader import SessionPaths
from vibeshub_client.reader import TranscriptReader
from vibeshub_client.cursor_subagent_link import link_cursor_subagents


def _projects_root() -> Path:
    return Path.home() / ".cursor" / "projects"


def _workspace_project_dir(hook_input: dict) -> Path | None:
    """Cursor names a project dir after the workspace root with "/" turned
    into "-" and the leading slash dropped (/Users/x/repo -> Users-x-repo).
    Returns that dir when the payload names a workspace root and the dir
    exists; None otherwise."""
    roots = hook_input.get("workspace_roots")
    root = roots[0] if isinstance(roots, list) and roots else None
    if not isinstance(root, str) or not root:
        return None
    candidate = _projects_root() / root.strip("/").replace("/", "-")
    return candidate if candidate.is_dir() else None


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
        # Scope the search to this workspace's project dir when we can name
        # it, so a more recently active Cursor window on a *different* (maybe
        # private) repo is never picked up and uploaded against this PR.
        scopes = [_projects_root()]
        project_dir = _workspace_project_dir(hook_input)
        if project_dir is not None:
            scopes.insert(0, project_dir)
        for scope in scopes:
            pattern = (
                "agent-transcripts/*/*.jsonl" if scope != _projects_root()
                else "*/agent-transcripts/*/*.jsonl"
            )
            transcripts = sorted(
                scope.glob(pattern),
                key=lambda f: f.stat().st_mtime,
                reverse=True,
            )
            if transcripts:
                main = transcripts[0]
                return SessionPaths(main_jsonl=main, subagents_dir=_subagents_dir(main))
        main = _projects_root() / "missing.jsonl"
        return SessionPaths(main_jsonl=main, subagents_dir=_subagents_dir(main))

    def link_subagents(self, paths: SessionPaths, hook_input: dict) -> list:
        return link_cursor_subagents(paths.main_jsonl, paths.subagents_dir)

    def find_session(self, hook_input: dict) -> Path:
        return self.find_session_paths(hook_input).main_jsonl
