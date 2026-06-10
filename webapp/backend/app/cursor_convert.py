"""Convert raw Cursor agent transcripts to Claude-shaped JSONL.

Python port of the frontend's former cursorExport.ts (deleted when
conversion moved server-side to ingest). Pure: bytes in, bytes out,
no I/O.

Cursor records are already close to canonical:
{ role, message: { content: [blocks] } }. The conversion adds a
synthetic top-level uuid per record, emits a cursor-meta marker, strips
the <user_query>/<timestamp> envelope from user text, parses coarse
timestamps, and assigns deterministic ids to Task/Subagent tool calls so
subagents nest under their spawning card (link_cursor_subagents in the
plugin uses the same cursor-agent-<n> scheme).

The synthetic uuids (cursor-rec-<n>) are load-bearing: digest chapter
anchor_uuids are generated against this conversion and resolved against
the same converted jsonl the API serves to the viewer. Changing the uuid
scheme or record order breaks chapter jumps on already-digested traces.
tests/test_cursor_convert.py pins the output against goldens captured
from cursorExport.ts before its removal.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta

from app.codex_convert import _s

_TS_RE = re.compile(r"<timestamp>(.*?)</timestamp>", re.DOTALL)
_QUERY_RE = re.compile(r"<user_query>\s*(.*?)\s*</user_query>", re.DOTALL)
_CURSOR_TS_RE = re.compile(
    r"([A-Za-z]+ \d{1,2}, \d{4}),?\s+(\d{1,2}:\d{2})\s*([AaPp][Mm])"
    r"\s*\(UTC([+-]\d{1,2})(?::?(\d{2}))?\)"
)


def looks_like_cursor(blob: bytes) -> bool:
    """True when the first line is a Cursor transcript record.

    Cursor records carry no top-level type (Claude/Codex/terminal records
    do), just { role, message: { content: [...] } }. Matches the former
    looksLikeCursor in cursorExport.ts and _looks_like_cursor in
    message_count.py.
    """
    nl = blob.find(b"\n")
    first = (blob if nl == -1 else blob[:nl]).strip()
    if not first:
        return False
    try:
        rec = json.loads(first)
    except ValueError:
        return False
    return (
        isinstance(rec, dict)
        and "type" not in rec
        and rec.get("role") in ("user", "assistant")
        and isinstance(rec.get("message"), dict)
        and isinstance(rec["message"].get("content"), list)
    )


def _parse_cursor_timestamp(raw: str) -> str | None:
    """"Wednesday, Jun 3, 2026, 7:30 PM (UTC-7)" -> ISO instant.

    Coarse (minute precision, user turns only). None when unparseable.
    """
    m = _CURSOR_TS_RE.search(raw)
    if m is None:
        return None
    date_s, hm, ap, off_h, off_m = m.groups()
    wall = None
    # JS Date.parse accepts both "Jun" and "June"; try both formats.
    for fmt in ("%b %d, %Y %I:%M %p", "%B %d, %Y %I:%M %p"):
        try:
            wall = datetime.strptime(f"{date_s} {hm} {ap.upper()}", fmt)
            break
        except ValueError:
            continue
    if wall is None:
        return None
    sign = -1 if off_h.startswith("-") else 1
    offset_min = int(off_h) * 60 + sign * int(off_m or "0")
    # Wall clock is in (UTC + offset); true UTC = wall - offset.
    utc = wall - timedelta(minutes=offset_min)
    return utc.strftime("%Y-%m-%dT%H:%M:%S") + ".000Z"


def _user_text(content: list) -> str:
    return "\n".join(
        _s(b.get("text"))
        for b in content
        if isinstance(b, dict) and b.get("type") == "text"
    )


def cursor_to_claude_jsonl(blob: bytes) -> bytes:
    """Walk the transcript once and emit Claude-shaped JSONL.

    One content block per assistant record (the canonical parser renders
    only the LAST block of each assistant record) and a unique truthy
    top-level uuid on every record, mirroring the former cursorToJsonl.
    """
    records: list[dict] = []
    rec_n = 0
    agent_n = 0  # ordinal of Task/Subagent dispatches, in document order
    last_ts = ""

    def uuid() -> str:
        nonlocal rec_n
        u = f"cursor-rec-{rec_n}"
        rec_n += 1
        return u

    def push_assistant(block: dict, ts: str) -> None:
        records.append({
            "type": "assistant",
            "uuid": uuid(),
            "timestamp": ts,
            "message": {
                # rec_n was just bumped by uuid(); cursorExport.ts had the
                # same post-increment quirk, so cursor-rec-N carries
                # cursor-msg-N+1.
                "id": f"cursor-msg-{rec_n}",
                "model": None,
                "content": [block],
            },
        })

    records.append({
        "type": "cursor-meta", "source": "cursor", "uuid": uuid(),
        "timestamp": "", "sessionId": None, "cwd": None,
    })

    for raw_line in blob.decode("utf-8", errors="replace").split("\n"):
        line = raw_line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if not isinstance(rec, dict):
            continue
        role = rec.get("role")
        msg = rec.get("message")
        if not isinstance(msg, dict):
            msg = {}
        content = msg.get("content")
        if content is None:
            content = []
        if not isinstance(content, list):
            continue

        if role == "user":
            raw_text = _user_text(content)
            ts_m = _TS_RE.search(raw_text)
            if ts_m:
                iso = _parse_cursor_timestamp(ts_m.group(1))
                if iso:
                    last_ts = iso
            q = _QUERY_RE.search(raw_text)
            clean = (q.group(1) if q else _TS_RE.sub("", raw_text)).strip()
            records.append({
                "type": "user", "uuid": uuid(), "timestamp": last_ts,
                "message": {"content": clean},
            })
            continue

        if role == "assistant":
            for b in content:
                if not isinstance(b, dict):
                    continue
                btype = b.get("type")
                if btype == "text":
                    push_assistant(
                        {"type": "text", "text": _s(b.get("text"))}, last_ts,
                    )
                elif btype == "thinking":
                    push_assistant(
                        {"type": "thinking",
                         "thinking": _s(b.get("thinking"))},
                        last_ts,
                    )
                elif btype == "tool_use":
                    if b.get("name") in ("Task", "Subagent"):
                        tool_id = f"cursor-agent-{agent_n}"
                        agent_n += 1
                    else:
                        tool_id = f"cursor-tool-{rec_n}"
                    inp = b.get("input")
                    push_assistant({
                        "type": "tool_use", "id": tool_id,
                        "name": _s(b.get("name")),
                        "input": inp if inp is not None else {},
                    }, last_ts)

    return (
        "\n".join(
            json.dumps(r, ensure_ascii=False, separators=(",", ":"))
            for r in records
        ) + "\n"
    ).encode("utf-8")
