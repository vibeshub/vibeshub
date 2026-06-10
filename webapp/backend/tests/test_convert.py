"""Tests for app.convert, the imported-format dispatch shared by ingest
(store a converted copy) and serving (legacy in-memory fallback)."""
from pathlib import Path

from app.convert import (
    IMPORTED_FORMATS,
    convert_imported,
    sniff_import_format,
)

FIXTURES = Path(__file__).parent / "fixtures"


def test_sniffs_and_converts_codex():
    raw = (FIXTURES / "codex" / "rollout.jsonl").read_bytes()
    assert sniff_import_format(raw) == "codex"
    converted = convert_imported(raw)
    assert converted is not None
    assert b'"codex-meta"' in converted.splitlines()[0]


def test_sniffs_and_converts_cursor():
    raw = (FIXTURES / "cursor" / "transcript.jsonl").read_bytes()
    assert sniff_import_format(raw) == "cursor"
    converted = convert_imported(raw)
    assert converted is not None
    assert b'"cursor-meta"' in converted.splitlines()[0]


def test_claude_is_not_imported():
    raw = (FIXTURES / "sample-session.jsonl").read_bytes()
    assert sniff_import_format(raw) is None
    assert convert_imported(raw) is None
    assert "claude" not in IMPORTED_FORMATS
    assert "terminal" not in IMPORTED_FORMATS


def test_converted_output_is_not_reconvertible():
    # Double-conversion guard: converted output starts with a *-meta
    # record carrying a top-level "type", which both sniffers reject.
    for sub in ("codex/rollout.jsonl", "cursor/transcript.jsonl"):
        converted = convert_imported((FIXTURES / sub).read_bytes())
        assert converted is not None
        assert sniff_import_format(converted) is None
        assert convert_imported(converted) is None
