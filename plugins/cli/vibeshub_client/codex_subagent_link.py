"""Link a Codex main rollout to its subagent (and guardian) child rollouts.

Linkage signals, all recoverable from the stored JSONL alone (spec §11):
  - parent -> child: the main rollout's `spawn_agent` function_call_output is
    `{"agent_id": <child>, "nickname": ...}`; its `call_id` is the tool_use_id.
  - child -> parent + role/nickname: the child rollout's line-1 session_meta
    (`forked_from_id`, `source.subagent.thread_spawn`).
`state_<N>.sqlite` is an optional enrichment/locator; the JSONL-header glob is
the schema-independent fallback. Guardians are bundled too (tool_use_id=None,
agent_type="guardian") so a future "show guardians" needs no re-upload.
"""
from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from vibeshub_client.subagent_link import AgentEntry

log = logging.getLogger(__name__)

_STATE_DB_RE = re.compile(r"^state_(\d+)\.sqlite$")


@dataclass
class _ChildHeader:
    child_id: str
    forked_from: str | None
    role: str | None
    nickname: str | None
    path: Path


def _codex_home() -> Path:
    return Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))


def _read_thread_id(jsonl: Path) -> str | None:
    try:
        with jsonl.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                rec = json.loads(line)
                if rec.get("type") == "session_meta":
                    return (rec.get("payload") or {}).get("id")
                return None
    except (OSError, json.JSONDecodeError):
        return None
    return None


def _scan_child_headers(home: Path) -> list[_ChildHeader]:
    out: list[_ChildHeader] = []
    for path in (home / "sessions").glob("**/rollout-*.jsonl"):
        try:
            with path.open("r", encoding="utf-8") as f:
                first = f.readline().strip()
            if not first:
                continue
            payload = (json.loads(first).get("payload") or {})
        except (OSError, json.JSONDecodeError):
            continue
        if payload.get("thread_source") != "subagent":
            continue
        sub = (payload.get("source") or {}).get("subagent") or {}
        spawn = sub.get("thread_spawn") or {}
        role = spawn.get("agent_role")
        if sub.get("other") == "guardian" or role is None:
            role = "guardian"
        out.append(_ChildHeader(
            child_id=payload.get("id"),
            forked_from=payload.get("forked_from_id"),
            role=role,
            nickname=spawn.get("agent_nickname"),
            path=path,
        ))
    return out


def _read_spawn_outputs(jsonl: Path) -> dict[str, str]:
    """child_thread_id -> spawn_agent call_id, from a transcript's outputs."""
    out: dict[str, str] = {}
    try:
        with jsonl.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or '"function_call_output"' not in line:
                    continue
                try:
                    p = (json.loads(line).get("payload") or {})
                except json.JSONDecodeError:
                    continue
                if p.get("type") != "function_call_output":
                    continue
                try:
                    body = json.loads(p.get("output") or "")
                except (json.JSONDecodeError, TypeError):
                    continue
                if isinstance(body, dict) and body.get("agent_id"):
                    out[body["agent_id"]] = p.get("call_id")
    except OSError:
        pass
    return out


def _find_state_db(home: Path) -> Path | None:
    candidates: list[tuple[int, Path]] = []
    for p in home.glob("state_*.sqlite"):
        m = _STATE_DB_RE.match(p.name)
        if m:
            candidates.append((int(m.group(1)), p))
    for _, p in sorted(candidates, reverse=True):
        try:
            con = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
            try:
                has = con.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='thread_spawn_edges'"
                ).fetchone()
            finally:
                con.close()
            if has:
                return p
        except sqlite3.Error:
            continue
    return None


def _sqlite_meta(home: Path, child_ids: set[str]) -> dict[str, dict]:
    db = _find_state_db(home)
    if not db or not child_ids:
        return {}
    placeholders = ",".join("?" for _ in child_ids)
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            rows = con.execute(
                f"SELECT id, rollout_path, agent_role, agent_nickname, model, first_user_message "
                f"FROM threads WHERE id IN ({placeholders})",
                tuple(child_ids),
            ).fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return {}
    return {
        r[0]: {"rollout_path": r[1], "role": r[2], "nickname": r[3],
               "model": r[4], "first_user_message": r[5]}
        for r in rows
    }


def link_codex_subagents(main_jsonl: Path, hook_input: dict) -> list[AgentEntry]:
    home = _codex_home()
    main_id = _read_thread_id(main_jsonl)
    if not main_id:
        return []

    headers = _scan_child_headers(home)
    by_parent: dict[str, list[_ChildHeader]] = defaultdict(list)
    for h in headers:
        if h.forked_from:
            by_parent[h.forked_from].append(h)

    # BFS over descendants (depth > 1 supported).
    discovered: dict[str, _ChildHeader] = {}
    frontier = [main_id]
    while frontier:
        pid = frontier.pop()
        for h in by_parent.get(pid, []):
            if h.child_id and h.child_id not in discovered:
                discovered[h.child_id] = h
                frontier.append(h.child_id)
    if not discovered:
        return []

    # Cross-link call_id from spawn outputs across main + every discovered transcript.
    call_by_child: dict[str, str] = {}
    for path in [main_jsonl] + [h.path for h in discovered.values()]:
        call_by_child.update(_read_spawn_outputs(path))

    meta = _sqlite_meta(home, set(discovered))

    entries: list[AgentEntry] = []
    for cid, h in discovered.items():
        m = meta.get(cid, {})
        role = h.role or m.get("role") or "default"
        nickname = h.nickname or m.get("nickname")
        description = m.get("first_user_message") or nickname or ""
        tool_use_id = call_by_child.get(cid)
        entries.append(AgentEntry(
            agent_id=cid,
            tool_use_id=tool_use_id,
            agent_type=role,
            description=description,
            jsonl_path=h.path,
            meta_path=h.path,  # unused; meta is in-memory below
            meta={"agentType": role, "description": description,
                  "toolUseId": tool_use_id, "nickname": nickname},
        ))
    return entries
