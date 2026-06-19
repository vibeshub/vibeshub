"""Link a Cursor main agent transcript to its subagents/ child transcripts.

Cursor's main transcript dispatches subagents via `Task`/`Subagent` tool_use
blocks that carry NO id, and the child files carry NO on-disk meta.json. We:
  - read the ordered dispatches (name in {Task, Subagent}) from the main jsonl,
  - read each child's first user message (envelope stripped) as its prompt,
  - match each dispatch to a child by prompt-prefix, tie-breaking identical
    prompts by file order (mtime, then name),
  - assign each child a deterministic tool_use_id = "cursor-agent-<ordinal>",
    where <ordinal> is the dispatch's document position. The backend converter
    (webapp/backend/app/cursor_convert.py) assigns the SAME id to the Nth
    Task/Subagent block, so the viewer nests the subagent under its spawning card.
Meta is synthesized in-memory (no .meta.json), as the Codex linker does;
bundle.py honors AgentEntry.meta when present.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path

from vibeshub_client.subagent_link import AgentEntry

log = logging.getLogger(__name__)

_QUERY_RE = re.compile(r"<user_query>\s*(.*?)\s*</user_query>", re.DOTALL)
_TS_RE = re.compile(r"<timestamp>.*?</timestamp>", re.DOTALL)
_PREFIX = 200


@dataclass
class _Dispatch:
    ordinal: int
    description: str
    subagent_type: str
    prompt: str


def _read_dispatches(main_jsonl: Path) -> list[_Dispatch]:
    out: list[_Dispatch] = []
    if not main_jsonl.is_file():
        return out
    n = 0
    with main_jsonl.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("role") != "assistant":
                continue
            for block in (rec.get("message") or {}).get("content") or []:
                if not isinstance(block, dict) or block.get("type") != "tool_use":
                    continue
                if block.get("name") not in ("Task", "Subagent"):
                    continue
                inp = block.get("input") or {}
                out.append(_Dispatch(
                    ordinal=n,
                    description=str(inp.get("description") or ""),
                    subagent_type=str(inp.get("subagent_type") or "default"),
                    prompt=str(inp.get("prompt") or ""),
                ))
                n += 1
    return out


def _child_prompt(jsonl_path: Path) -> str:
    try:
        with jsonl_path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if rec.get("role") != "user":
                    continue
                text = "\n".join(
                    str(b.get("text") or "")
                    for b in (rec.get("message") or {}).get("content") or []
                    if isinstance(b, dict)
                )
                q = _QUERY_RE.search(text)
                cleaned = q.group(1) if q else _TS_RE.sub("", text)
                return cleaned.strip()
    except OSError:
        pass
    return ""


def _entry(agent_id, tool_use_id, agent_type, description, path) -> AgentEntry:
    return AgentEntry(
        agent_id=agent_id,
        tool_use_id=tool_use_id,
        agent_type=agent_type,
        description=description,
        jsonl_path=path,
        meta_path=path,  # unused; meta is in-memory
        meta={"agentType": agent_type, "description": description, "toolUseId": tool_use_id},
    )


def link_cursor_subagents(main_jsonl: Path, subagents_dir: Path | None) -> list[AgentEntry]:
    if subagents_dir is None or not subagents_dir.is_dir():
        return []
    children = sorted(subagents_dir.glob("*.jsonl"), key=lambda p: (p.stat().st_mtime, p.name))
    if not children:
        return []
    dispatches = _read_dispatches(main_jsonl)
    child_prompt = {c: _child_prompt(c) for c in children}

    entries: list[AgentEntry] = []
    used: set[Path] = set()
    for d in dispatches:
        match = None
        for c in children:
            if c in used:
                continue
            cp = child_prompt[c]
            # Require a non-empty dispatch prompt: an empty prompt would make
            # cp.startswith("") always true and greedily claim the first child.
            if cp and d.prompt and (cp.startswith(d.prompt[:_PREFIX]) or d.prompt.startswith(cp[:_PREFIX])):
                match = c
                break
        if match is None:
            log.warning("cursor dispatch #%d (%r) matched no child", d.ordinal, d.description)
            continue
        used.add(match)
        entries.append(_entry(
            match.stem, f"cursor-agent-{d.ordinal}", d.subagent_type,
            d.description or d.prompt[:80], match,
        ))

    for c in children:
        if c in used:
            continue
        log.warning("cursor subagent %s matched no dispatch; bundling as orphan", c.stem)
        entries.append(_entry(c.stem, None, "default", "", c))
    return entries
