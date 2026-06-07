"""Distill a Claude Code JSONL trace into a compact text form for the LLM.

The four-tier classification is documented in
docs/superpowers/specs/2026-06-06-trace-digest-agent-design.md §5.

This module is pure: no I/O, no env-var reads. It operates on bytes in,
returns str out. Easy to unit-test against fixture jsonls.
"""
from __future__ import annotations

import json
from typing import Any

_DROPPED_TYPES = {
    "permission-mode",
    "file-history-snapshot",
    "attachment",
    "last-prompt",
    "ai-title",
}

# Tools whose presence we record but whose inputs are scratchpad noise.
_SCRATCH_TOOLS = {"TodoWrite"}

_TOOL_RESULT_PREFIX = 80
_TOOL_RESULT_ERROR_PREFIX = 400
_BASH_COMMAND_MAX = 120


def distill(blob: bytes, *, subagent_blobs: dict[str, bytes]) -> str:
    """Return a compact text form of `blob` ready for the LLM call."""
    text, _ = distill_with_uuids(blob, subagent_blobs=subagent_blobs)
    return text


def distill_with_uuids(
    blob: bytes, *, subagent_blobs: dict[str, bytes],
) -> tuple[str, set[str]]:
    """Like `distill`, but also returns the set of event UUIDs that appear
    in the output. Callers use this to validate chapter anchor_uuids
    against the actual anchorable surface.
    """
    lines: list[str] = []
    uuids: set[str] = set()
    prev: str | None = None
    for raw in blob.splitlines():
        if not raw.strip():
            continue
        try:
            ev = json.loads(raw)
        except json.JSONDecodeError:
            continue
        rendered = _render(ev, subagent_blobs)
        if rendered is None:
            continue
        prefix, body = rendered
        if body == prev:
            continue  # adjacent duplicate (compare bodies, not uuid-prefixed lines)
        prev = body
        uuid = ev.get("uuid")
        if uuid:
            uuids.add(uuid)
        lines.append(prefix + body)
    return "\n".join(lines), uuids


def _render(
    ev: dict, subagent_blobs: dict[str, bytes],
) -> tuple[str, str] | None:
    et = ev.get("type")
    if et in _DROPPED_TYPES:
        return None
    uuid = ev.get("uuid", "")
    prefix = f"[{uuid}] " if uuid else ""
    if et == "user":
        text = _user_text(ev)
        if text is None:
            return None
        return prefix, f"USER: {text}"
    if et == "assistant":
        body = _render_assistant(ev, subagent_blobs)
        if body is None:
            return None
        return prefix, body
    return None


def _user_text(ev: dict) -> str | None:
    msg = ev.get("message") or {}
    content = msg.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                parts.append(str(block.get("text") or ""))
            elif block.get("type") == "tool_result":
                parts.append(_tool_result_to_line(block))
        joined = " | ".join(p for p in parts if p)
        return joined or None
    return None


def _render_assistant(
    ev: dict, subagent_blobs: dict[str, bytes],
) -> str | None:
    msg = ev.get("message") or {}
    content = msg.get("content") or []
    if not isinstance(content, list):
        return None
    parts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        btype = block.get("type")
        if btype == "text":
            text = (block.get("text") or "").strip()
            if text:
                parts.append(f"ASSISTANT: {text}")
        elif btype == "tool_use":
            line = _tool_use_to_line(block, subagent_blobs)
            if line is not None:
                parts.append(line)
        # Thinking blocks are intentionally dropped
    if not parts:
        return None
    return " ".join(parts)


def _tool_use_to_line(
    block: dict, subagent_blobs: dict[str, bytes],
) -> str | None:
    name = block.get("name") or ""
    inp = block.get("input") or {}
    if name in _SCRATCH_TOOLS:
        return None
    if name == "Task":
        agent_id = (inp.get("subagent_type") or "agent")
        desc = (inp.get("description") or "").strip()
        sub_summary = _summarize_subagent(block, subagent_blobs)
        return f"Subagent[{agent_id}]: {desc} → {sub_summary}".rstrip(" →")
    if name == "Bash":
        cmd = (inp.get("command") or "").strip()
        if len(cmd) > _BASH_COMMAND_MAX:
            cmd = cmd[:_BASH_COMMAND_MAX] + "…"
        return f"Bash: {cmd}"
    fp = inp.get("file_path")
    if isinstance(fp, str) and fp:
        return f"{name} {fp}"
    # Grep/Glob carry pattern + path; other tools fall through to a label.
    pattern = inp.get("pattern") or inp.get("query")
    path = inp.get("path") or ""
    if pattern:
        return f'{name} "{pattern}"' + (f" in {path}" if path else "")
    return name


def _tool_result_to_line(block: dict) -> str:
    content = block.get("content")
    is_error = bool(block.get("is_error"))
    if isinstance(content, list):
        text_parts = [
            str(b.get("text") or "") for b in content if isinstance(b, dict)
        ]
        body = " ".join(text_parts).strip()
    else:
        body = str(content or "").strip()
    limit = _TOOL_RESULT_ERROR_PREFIX if is_error else _TOOL_RESULT_PREFIX
    body = body.replace("\n", " ")
    if len(body) > limit:
        body = body[:limit] + "…"
    status = "ERR" if is_error else "OK"
    return f"RESULT[{status}]: {body}" if body else f"RESULT[{status}]"


def _summarize_subagent(
    block: dict, subagent_blobs: dict[str, bytes],
) -> str:
    """Heuristic one-line outcome for a subagent dispatch.

    Strategy:
    1. If we have the child's blob, take the LAST assistant_text and use
       the first sentence (~120 chars).
    2. Otherwise, fall back to "(N tool calls)" so the LLM at least sees
       that something happened.
    """
    tool_use_id = block.get("id") or ""
    child = subagent_blobs.get(tool_use_id)
    if child is None:
        return ""
    last_text: str | None = None
    tool_call_count = 0
    for raw in child.splitlines():
        if not raw.strip():
            continue
        try:
            ev = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if ev.get("type") != "assistant":
            continue
        msg = ev.get("message") or {}
        content = msg.get("content") or []
        if not isinstance(content, list):
            continue
        for sub_block in content:
            if not isinstance(sub_block, dict):
                continue
            btype = sub_block.get("type")
            if btype == "text":
                t = (sub_block.get("text") or "").strip()
                if t:
                    last_text = t
            elif btype == "tool_use":
                tool_call_count += 1
    if last_text:
        # First sentence, capped at 120 chars
        sentence = last_text.split(". ")[0].strip()
        if len(sentence) > 120:
            sentence = sentence[:120] + "…"
        return sentence
    if tool_call_count:
        return f"({tool_call_count} tool calls)"
    return ""
