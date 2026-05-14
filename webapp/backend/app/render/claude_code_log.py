from __future__ import annotations

import tempfile
from pathlib import Path


class RenderError(Exception):
    pass


def render_jsonl_to_html(data: bytes) -> str:
    """
    Render a Claude Code JSONL transcript to standalone HTML.

    Implementation note: this uses claude-code-log's Python API
    (``claude_code_log.converter.convert_jsonl_to_html``) rather than the
    CLI, since a stable in-process entry point exists. The function
    signature ``bytes -> str`` is the contract we hold; the body can be
    swapped (CLI shell-out, alternate renderer) without touching callers.
    """
    # Imported lazily so import errors surface as RenderError at call time
    # rather than at module import.
    try:
        from claude_code_log.converter import convert_jsonl_to_html
    except ImportError as e:  # pragma: no cover - defensive
        raise RenderError(f"claude-code-log is not installed: {e}") from e

    with tempfile.TemporaryDirectory() as tmpdir_str:
        tmpdir = Path(tmpdir_str)
        in_path = tmpdir / "session.jsonl"
        out_path = tmpdir / "session.html"
        in_path.write_bytes(data)
        try:
            produced = convert_jsonl_to_html(
                in_path,
                output_path=out_path,
                generate_individual_sessions=False,
                use_cache=False,
                silent=True,
            )
        except Exception as e:  # noqa: BLE001 - wrap any converter failure
            raise RenderError(f"claude-code-log failed: {e}") from e
        produced_path = Path(produced) if produced else out_path
        if not produced_path.exists():
            raise RenderError("claude-code-log produced no output file")
        return produced_path.read_text("utf-8")
