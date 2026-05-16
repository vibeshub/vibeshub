#!/usr/bin/env python3
"""
PostToolUse hook for Claude Code.

Reads the hook payload from stdin (JSON), checks if the tool call was
`gh pr create`, and if so runs the vibeshub share pipeline:
preview -> confirm -> upload -> comment.

Exits 0 on success or any non-fatal failure (we never want to block Claude).
Errors are written to stderr.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path


def _log_path() -> Path:
    override = os.environ.get("VIBESHUB_HOOK_LOG")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".vibeshub" / "hook.log"


_SESSION_ID: str | None = None


def _log(message: str) -> None:
    """Append a timestamped line to the hook log. Never raises."""
    try:
        path = _log_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().isoformat(timespec="seconds")
        sid = f" session={_SESSION_ID}" if _SESSION_ID else ""
        with path.open("a", encoding="utf-8") as f:
            f.write(f"{ts}{sid} {message}\n")
    except Exception:
        # Logging must never break the hook.
        pass


def _bail(message: str) -> None:
    _log(f"bail: {message}")
    print(f"[vibeshub] {message}", file=sys.stderr)
    sys.exit(0)


def main() -> None:
    global _SESSION_ID

    plugin_root = Path(os.environ.get("CLAUDE_PLUGIN_ROOT", Path(__file__).resolve().parent.parent))
    sys.path.insert(0, str(plugin_root))

    _log("hook invoked")

    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as e:
        _bail(f"could not parse hook payload: {e}")
        return

    _SESSION_ID = payload.get("session_id")

    tool_input = payload.get("tool_input", {})
    tool_response = payload.get("tool_response", {})

    command = tool_input.get("command", "")
    if "gh pr create" not in command:
        _log("skipped: not a gh pr create command")
        return  # not for us

    stdout = ""
    if isinstance(tool_response, dict):
        stdout = tool_response.get("stdout", "") or tool_response.get("output", "")
    elif isinstance(tool_response, str):
        stdout = tool_response

    from vibeshub_client.gh_token import GhTokenError, get_gh_token
    from vibeshub_client.parse_pr_url import extract_pr_url_from_gh_stdout
    from vibeshub_client.pipeline import RunOptions, run_share_pipeline

    pr_url = extract_pr_url_from_gh_stdout(stdout)
    if not pr_url:
        _log("skipped: no PR URL in gh stdout (command likely failed)")
        return  # likely the command failed; nothing to share

    _log(f"detected PR: {pr_url}")

    try:
        token = get_gh_token()
    except GhTokenError as e:
        _bail(str(e))
        return

    server_url = os.environ.get("VIBESHUB_SERVER_URL", "https://vibeshub.ai")

    from reader import ClaudeCodeTranscriptReader

    options = RunOptions(
        server_url=server_url,
        token=token,
        pr_url=pr_url,
        confirm=os.environ.get("VIBESHUB_AUTO_YES") != "1",
        session_id=payload.get("session_id"),
    )
    reader = ClaudeCodeTranscriptReader()

    try:
        result = asyncio.run(
            run_share_pipeline(
                reader=reader,
                hook_input=payload,
                options=options,
            )
        )
    except Exception as e:
        _bail(f"share failed: {e}")
        return

    if result.uploaded:
        msg = f"trace uploaded: {result.trace_url}"
        if result.skip_reason:
            msg += f" (note: {result.skip_reason})"
        _log(msg)
        print(f"[vibeshub] {msg}", file=sys.stderr)
    else:
        _log(f"skipped: {result.skip_reason}")
        print(f"[vibeshub] skipped: {result.skip_reason}", file=sys.stderr)


if __name__ == "__main__":
    main()
