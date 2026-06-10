"""Convert raw Codex rollouts to Claude-shaped JSONL.

Originally the backend mirror of the frontend's codexExport.ts, which
died when conversion moved server-side: ingest now stores this module's
output as {blob_prefix}converted.jsonl and the API serves it to the
viewer. Pure: bytes in, bytes out, no I/O.

The synthetic uuids (codex-rec-<n>) are load-bearing: digest chapter
anchor_uuids are generated against this conversion and resolved against
the same converted jsonl the API serves, and digests computed before
the converted-copy era already reference these uuids. Changing the uuid
scheme or record order breaks chapter jumps on existing digests.
tests/test_codex_convert.py pins the output against goldens (originally
captured from the frontend converter) as a determinism/regression
contract.
"""
from __future__ import annotations

import json
import re
from typing import Any

_APPLY_PATCH_RE = re.compile(r"\s*apply_patch\b")
_EXIT_CODE_RE = re.compile(r"Process exited with code (\d+)")
_PATCH_FILE_RE = re.compile(r"\*\*\* (?:Update|Add|Delete) File: (.+)$")
_OUTPUT_MARKER = "\nOutput:\n"


def looks_like_codex(blob: bytes) -> bool:
    """True when the first line is a Codex session_meta record. Reads the
    whole first line (Codex >= 0.135 pushes it past 32 KB), matching the
    former codexExport.ts looksLikeCodex."""
    nl = blob.find(b"\n")
    first = (blob if nl == -1 else blob[:nl]).strip()
    if not first:
        return False
    try:
        rec = json.loads(first)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return False
    if not isinstance(rec, dict):
        return False
    payload = rec.get("payload")
    return (
        rec.get("type") == "session_meta"
        and isinstance(payload, dict)
        and isinstance(payload.get("id"), str)
    )


def _s(value: Any, default: str = "") -> str:
    """String(value ?? default) for the JS-shaped fields we copy."""
    if value is None:
        return default
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _parse_exec_output(output: str) -> tuple[str, int | None]:
    m = _EXIT_CODE_RE.search(output)
    exit_code = int(m.group(1)) if m else None
    idx = output.find(_OUTPUT_MARKER)
    body = output[idx + len(_OUTPUT_MARKER):] if idx >= 0 else output
    return body, exit_code


def _parse_apply_patch(cmd: str) -> list[dict] | None:
    """Parse an `apply_patch` envelope into one hunk per file. Line numbers
    are approximate (the envelope omits them); the +/-/context lines are
    exact. Returns None when nothing parseable is found."""
    begin = cmd.find("*** Begin Patch")
    end = cmd.find("*** End Patch")
    if begin < 0 or end < 0 or end < begin:
        return None
    files: list[dict] = []
    current: dict | None = None

    def flush() -> None:
        nonlocal current
        if current and current["lines"]:
            lines = current["lines"]
            added = sum(1 for ln in lines if ln.startswith("+"))
            removed = sum(1 for ln in lines if ln.startswith("-"))
            ctx = len(lines) - added - removed
            files.append({
                "path": current["path"],
                "hunk": {
                    "oldStart": 1, "oldLines": ctx + removed,
                    "newStart": 1, "newLines": ctx + added,
                    "lines": lines,
                },
            })
        current = None

    for line in cmd[begin:end].split("\n"):
        file_m = _PATCH_FILE_RE.match(line)
        if file_m:
            flush()
            current = {"path": file_m.group(1).strip(), "lines": []}
            continue
        if line.startswith("***") or line.startswith("@@"):
            continue
        if current is not None and line[:1] in ("+", "-", " "):
            current["lines"].append(line)
    flush()
    return files or None


def _map_usage(last: dict) -> dict:
    """Codex counts cached tokens INSIDE input_tokens; Anthropic's shape
    excludes cache_read from input_tokens. Convert so downstream summation
    matches."""
    input_tokens = last.get("input_tokens") or 0
    cached = last.get("cached_input_tokens") or 0
    return {
        "input_tokens": max(0, input_tokens - cached),
        "cache_read_input_tokens": cached,
        "cache_creation_input_tokens": 0,
        "output_tokens": last.get("output_tokens") or 0,
    }


def _map_tool_call(
    raw_name: str, args: Any, call_id: str, patch_by_call: dict,
) -> tuple[str, Any]:
    get = args.get if isinstance(args, dict) else (lambda _k: None)
    if raw_name == "exec_command":
        cmd = _s(get("cmd"))
        if _APPLY_PATCH_RE.match(cmd):
            parsed = _parse_apply_patch(cmd)
            if parsed and len(parsed) == 1:
                patch_by_call[call_id] = parsed[0]["hunk"]
                return "apply_patch", {"file_path": parsed[0]["path"]}
            # multi-file or unparseable: fall through to a shell card
            # showing the raw patch (honest fallback).
        return "shell", {"command": cmd, "description": _s(get("workdir"))}
    if raw_name == "update_plan":
        plan = get("plan")
        explanation = get("explanation")
        return "update_plan", {
            "plan": plan if plan is not None else [],
            "explanation": explanation if explanation is not None else "",
        }
    if raw_name == "spawn_agent":
        message = _s(get("message"))
        return "spawn_agent", {
            "subagent_type": _s(get("agent_type"), "default"),
            "model": _s(get("model"), "default"),
            "prompt": message,
            "description": message,
        }
    return raw_name, args


def codex_to_claude_jsonl(blob: bytes) -> bytes:
    """Walk the rollout once and emit Claude-shaped JSONL. One content
    block per assistant record, a unique truthy top-level uuid on every
    record, mirroring the former codexExport.ts codexToJsonl."""
    records: list[dict] = []
    rec_n = 0
    model: str | None = None
    last_assistant: dict | None = None
    patch_by_call: dict[str, dict] = {}

    def uuid() -> str:
        nonlocal rec_n
        u = f"codex-rec-{rec_n}"
        rec_n += 1
        return u

    def push_assistant(block: dict, ts: str) -> None:
        nonlocal last_assistant
        rec = {
            "type": "assistant", "uuid": uuid(), "timestamp": ts,
            # rec_n was just bumped by uuid(); the former codexExport.ts had
            # the same post-increment quirk, so codex-rec-N carries
            # codex-msg-N+1.
            "message": {"id": f"codex-msg-{rec_n}", "model": model,
                        "content": [block]},
        }
        records.append(rec)
        last_assistant = rec

    for raw in blob.decode("utf-8", errors="replace").split("\n"):
        raw = raw.strip()
        if not raw:
            continue
        try:
            rec = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if not isinstance(rec, dict):
            continue
        ts = _s(rec.get("timestamp"))
        payload = rec.get("payload")
        if not isinstance(payload, dict):
            payload = {}

        if rec.get("type") == "session_meta":
            git = payload.get("git")
            if not isinstance(git, dict):
                git = {}
            records.append({
                "type": "codex-meta", "source": "codex", "uuid": uuid(),
                "timestamp": ts,
                "sessionId": payload.get("id"), "cwd": payload.get("cwd"),
                "gitBranch": git.get("branch"),
                "version": payload.get("cli_version"),
            })
            continue
        if rec.get("type") == "turn_context":
            if isinstance(payload.get("model"), str):
                model = payload["model"]
            continue
        if rec.get("type") == "event_msg":
            pt = payload.get("type")
            if (
                pt == "user_message"
                and isinstance(payload.get("message"), str)
                and payload["message"]
            ):
                records.append({
                    "type": "user", "uuid": uuid(), "timestamp": ts,
                    "message": {"content": payload["message"]},
                })
            elif pt == "token_count" and last_assistant is not None:
                info = payload.get("info")
                last_use = (
                    info.get("last_token_usage")
                    if isinstance(info, dict) else None
                )
                if last_use is not None:
                    last_assistant["message"]["usage"] = _map_usage(last_use)
            elif (
                pt == "task_complete"
                and isinstance(payload.get("duration_ms"), (int, float))
                and not isinstance(payload.get("duration_ms"), bool)
            ):
                records.append({
                    "type": "system", "subtype": "turn_duration",
                    "durationMs": payload["duration_ms"],
                    "uuid": uuid(), "timestamp": ts,
                })
            continue
        if rec.get("type") == "response_item":
            pt = payload.get("type")
            if pt == "message" and payload.get("role") == "assistant":
                for part in payload.get("content") or []:
                    if isinstance(part, dict) and part.get("type") == "output_text":
                        push_assistant(
                            {"type": "text", "text": _s(part.get("text"))}, ts,
                        )
            elif pt == "reasoning":
                parts = list(payload.get("summary") or []) + list(
                    payload.get("content") or [],
                )
                for s in parts:
                    if (
                        isinstance(s, dict)
                        and isinstance(s.get("text"), str) and s["text"]
                    ):
                        push_assistant(
                            {"type": "thinking", "thinking": s["text"]}, ts,
                        )
            elif pt == "function_call":
                call_id = _s(payload.get("call_id"))
                try:
                    args = json.loads(_s(payload.get("arguments"), "{}"))
                except json.JSONDecodeError:
                    args = {}
                name, inp = _map_tool_call(
                    _s(payload.get("name")), args, call_id, patch_by_call,
                )
                push_assistant(
                    {"type": "tool_use", "id": call_id, "name": name,
                     "input": inp},
                    ts,
                )
            elif pt == "function_call_output":
                call_id = _s(payload.get("call_id"))
                body, exit_code = _parse_exec_output(_s(payload.get("output")))
                tool_use_result: dict = {"stdout": body}
                if exit_code is not None:
                    tool_use_result["exitCode"] = exit_code
                hunk = patch_by_call.get(call_id)
                if hunk is not None:
                    tool_use_result["structuredPatch"] = [hunk]
                records.append({
                    "type": "user", "uuid": uuid(), "timestamp": ts,
                    "message": {"content": [{
                        "type": "tool_result", "tool_use_id": call_id,
                        "content": body,
                        "is_error": exit_code is not None and exit_code != 0,
                    }]},
                    "toolUseResult": tool_use_result,
                })
            continue

    out = "\n".join(
        json.dumps(r, ensure_ascii=False, separators=(",", ":"))
        for r in records
    )
    return (out + "\n").encode("utf-8")
