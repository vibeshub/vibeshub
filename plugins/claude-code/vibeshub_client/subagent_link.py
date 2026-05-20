"""Resolve the agent_id <-> tool_use_id linkage between a session's main
transcript and its `subagents/` sidecar files.

Claude Code does not reliably populate `meta.toolUseId` (1 of 147 files on
the original developer's machine), and subagent .jsonl files don't carry
parentToolUseID. We match by (description, timestamp-within-bucket) instead.

Algorithm:
  1. Collect parent_agents = [(tool_use_id, description, ts)]
     from main jsonl in file order.
  2. Collect subagents = [(agent_id, agent_type, description, first_ts,
                          jsonl_path, meta_path)] from subagents/*.
  3. Group both by description. For each bucket:
       sort each side by timestamp, zip pairwise.
  4. Subagent entries that fail to pair get tool_use_id=None and a
     log warning. They still ship in the bundle (frontend renders them
     as orphan/no-expand).
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

AGENT_ID_RE = re.compile(r"^agent-(a[0-9a-f]{16})\.(jsonl|meta\.json)$")


@dataclass
class AgentEntry:
    agent_id: str
    tool_use_id: str | None
    agent_type: str
    description: str
    jsonl_path: Path
    meta_path: Path


@dataclass
class _ParentRef:
    tool_use_id: str
    description: str
    timestamp: str


@dataclass
class _SubagentRef:
    agent_id: str
    agent_type: str
    description: str
    timestamp: str
    jsonl_path: Path
    meta_path: Path


def _read_parent_agents(main_jsonl: Path) -> list[_ParentRef]:
    out: list[_ParentRef] = []
    if not main_jsonl.is_file():
        return out
    with main_jsonl.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("type") != "assistant":
                continue
            msg = rec.get("message") or {}
            ts = rec.get("timestamp", "")
            for block in (msg.get("content") or []):
                if not isinstance(block, dict):
                    continue
                if block.get("type") != "tool_use":
                    continue
                if block.get("name") != "Agent":
                    continue
                tool_use_id = block.get("id", "")
                desc = (block.get("input") or {}).get("description", "")
                out.append(_ParentRef(tool_use_id=tool_use_id, description=desc, timestamp=ts))
    return out


def _read_subagent_refs(subagents_dir: Path) -> list[_SubagentRef]:
    out: list[_SubagentRef] = []
    if subagents_dir is None or not subagents_dir.is_dir():
        return out

    jsonls: dict[str, Path] = {}
    metas: dict[str, Path] = {}
    for child in subagents_dir.iterdir():
        m = AGENT_ID_RE.match(child.name)
        if not m:
            continue
        agent_id = m.group(1)
        if child.name.endswith(".meta.json"):
            metas[agent_id] = child
        else:
            jsonls[agent_id] = child

    for agent_id, jsonl_path in jsonls.items():
        meta_path = metas.get(agent_id)
        if meta_path is None:
            log.warning("subagent %s has jsonl but no meta.json; skipping", agent_id)
            continue
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            log.warning("subagent %s meta unreadable (%s); skipping", agent_id, e)
            continue
        first_ts = ""
        try:
            with jsonl_path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        first_ts = json.loads(line).get("timestamp", "")
                    except json.JSONDecodeError:
                        continue
                    break
        except OSError:
            pass
        out.append(_SubagentRef(
            agent_id=agent_id,
            agent_type=meta.get("agentType", ""),
            description=meta.get("description", ""),
            timestamp=first_ts,
            jsonl_path=jsonl_path,
            meta_path=meta_path,
        ))
    return out


def link_subagents(
    main_jsonl: Path,
    subagents_dir: Path | None,
) -> list[AgentEntry]:
    """Returns one AgentEntry per discoverable subagent file. Entries with
    no matching parent Agent tool_use have tool_use_id=None.
    """
    if subagents_dir is None or not subagents_dir.is_dir():
        return []
    parents = _read_parent_agents(main_jsonl) if main_jsonl.is_file() else []
    subs = _read_subagent_refs(subagents_dir)
    if not subs:
        return []
    if not parents:
        log.warning("no main jsonl Agent tool_uses to match against %d subagent file(s)", len(subs))
        return [
            AgentEntry(
                agent_id=s.agent_id,
                tool_use_id=None,
                agent_type=s.agent_type,
                description=s.description,
                jsonl_path=s.jsonl_path,
                meta_path=s.meta_path,
            )
            for s in subs
        ]

    parents_by_desc: dict[str, list[_ParentRef]] = {}
    for p in parents:
        parents_by_desc.setdefault(p.description, []).append(p)
    for bucket in parents_by_desc.values():
        bucket.sort(key=lambda x: x.timestamp)

    subs_by_desc: dict[str, list[_SubagentRef]] = {}
    for s in subs:
        subs_by_desc.setdefault(s.description, []).append(s)
    for bucket in subs_by_desc.values():
        bucket.sort(key=lambda x: x.timestamp)

    entries: list[AgentEntry] = []
    for desc, sub_bucket in subs_by_desc.items():
        parent_bucket = parents_by_desc.get(desc, [])
        for i, s in enumerate(sub_bucket):
            p = parent_bucket[i] if i < len(parent_bucket) else None
            entries.append(AgentEntry(
                agent_id=s.agent_id,
                tool_use_id=p.tool_use_id if p else None,
                agent_type=s.agent_type,
                description=s.description,
                jsonl_path=s.jsonl_path,
                meta_path=s.meta_path,
            ))
            if p is None:
                log.warning(
                    "subagent %s (desc=%r) had no matching parent Agent tool_use",
                    s.agent_id, s.description,
                )
    return entries
