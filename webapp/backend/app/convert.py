"""Dispatch imported-format traces (Codex, Cursor) to their converters.

Single sniff/convert entry point shared by ingest (which stores a
Claude-shaped converted copy next to the raw blob) and serving (which
converts in memory for traces uploaded before converted copies existed).
"""
from __future__ import annotations

from app.codex_convert import codex_to_claude_jsonl, looks_like_codex
from app.cursor_convert import cursor_to_claude_jsonl, looks_like_cursor

# source_format values whose traces carry a stored converted.jsonl copy.
IMPORTED_FORMATS = ("codex", "cursor")


def sniff_import_format(blob: bytes) -> str | None:
    """"codex" / "cursor" when the blob is in an imported native format."""
    if looks_like_codex(blob):
        return "codex"
    if looks_like_cursor(blob):
        return "cursor"
    return None


def convert_imported(blob: bytes) -> bytes | None:
    """Claude-shaped JSONL for an imported-format blob, None otherwise."""
    fmt = sniff_import_format(blob)
    if fmt == "codex":
        return codex_to_claude_jsonl(blob)
    if fmt == "cursor":
        return cursor_to_claude_jsonl(blob)
    return None
