"""Count the conversation messages a trace JSONL will actually render.

`len(jsonl.splitlines())` overcounts badly: tool_result user lines, system
records, file-history snapshots, progress hooks and the streamed assistant
lines (each carrying the full content[] again) all inflate the raw line
count well past what the trace view shows.

`count_messages` mirrors the frontend parser (`buildSession` in
webapp/frontend/src/components/trace/parser.ts): a streamed assistant
message spans many JSONL lines, each appending one block to content[], so
we dedupe on (message id, last-block index, block type) and count only the
`text` and `tool_use` blocks — the assistant replies and tool calls the UI
renders as cards.
"""
from __future__ import annotations

import json


def count_messages(jsonl_bytes: bytes) -> int:
    """Count rendered messages (assistant text blocks + tool calls) in a
    trace JSONL. Unparseable lines are skipped, matching the parser."""
    emitted: set[tuple[str, int, str]] = set()
    count = 0
    for raw in jsonl_bytes.splitlines():
        line = raw.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if not isinstance(rec, dict) or rec.get("type") != "assistant":
            continue
        msg = rec.get("message")
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")
        if not isinstance(content, list) or not content:
            continue
        block_idx = len(content) - 1
        block = content[block_idx]
        if not isinstance(block, dict):
            continue
        block_type = block.get("type")
        if block_type not in ("text", "tool_use"):
            continue
        key = (str(msg.get("id", "")), block_idx, block_type)
        if key in emitted:
            continue
        emitted.add(key)
        count += 1
    return count
