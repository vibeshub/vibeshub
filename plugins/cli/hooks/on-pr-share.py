#!/usr/bin/env python3
"""
PostToolUse hook for Claude Code.

Reads the hook payload from stdin (JSON). When the tool call was a command
that creates or updates a PR — `gh pr create`, `git push`, or `gh pr edit` —
it runs the vibeshub share pipeline: redact, upload, and (for a brand-new
trace) comment on the PR.

Exits 0 on success or any non-fatal failure (we never want to block Claude).
Errors are written to stderr.
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
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


def _repo_dir(payload: dict) -> str | None:
    """Directory gh should run in. Claude Code and Codex payloads carry `cwd`;
    Cursor's afterShellExecution payload has no `cwd` (and the hook process
    itself runs from `~/.cursor`, outside any repo), so fall back to the
    first workspace root."""
    if payload.get("cwd"):
        return payload["cwd"]
    roots = payload.get("workspace_roots")
    if isinstance(roots, list) and roots:
        return roots[0]
    return None


def _gh_error(e: Exception) -> str:
    """Render a gh failure for the log, including stderr when available —
    the exit status alone can't distinguish "no open PR" from e.g.
    "not a git repository"."""
    detail = (getattr(e, "stderr", "") or "").strip()
    return f"{e}: {detail}" if detail else str(e)


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
    command = (
        tool_input.get("command")
        or tool_input.get("cmd")
        or payload.get("command")  # Cursor afterShellExecution payload
        or ""
    )

    try:
        from vibeshub_client.gh_token import GhTokenError, get_gh_token
        from vibeshub_client.parse_pr_url import extract_pr_url_from_gh_stdout
        from vibeshub_client.pipeline import RunOptions, run_share_pipeline
        from vibeshub_client.pr_resolve import resolve_pr_url
        from vibeshub_client.share_trigger import classify_share_trigger
    except ImportError as e:
        _bail(f"failed to import vibeshub_client (is the plugin's Python missing deps?): {e}")
        return

    trigger = classify_share_trigger(command)
    if trigger is None:
        _log("skipped: command is not a share trigger")
        return  # not for us

    pr_url: str | None = None
    if trigger == "create":
        stdout = ""
        if isinstance(tool_response, dict):
            stdout = tool_response.get("stdout", "") or tool_response.get("output", "")
        elif isinstance(tool_response, str):
            stdout = tool_response
        if not stdout:
            # Cursor's afterShellExecution payload carries no `tool_response`;
            # the command's stdout (with the new PR URL) is in `output`.
            stdout = payload.get("output") or ""
        pr_url = extract_pr_url_from_gh_stdout(stdout)
        if not pr_url and "tool_response" not in payload:
            # No URL in the captured output. The PR was just created, so
            # resolve the open PR for the current branch — same as the
            # push/edit path below.
            try:
                pr_url = resolve_pr_url(None, cwd=_repo_dir(payload))
            except (subprocess.SubprocessError, OSError) as e:
                _log(
                    "skipped: gh pr create, but no open PR for current branch "
                    f"({_gh_error(e)})"
                )
                return
        if not pr_url:
            _log("skipped: no PR URL in gh stdout (command likely failed)")
            return  # likely the command failed; nothing to share
    else:
        # "push" / "edit": no PR URL in the command output. Resolve the open
        # PR for the current branch. A failure here is the normal case for a
        # push outside a PR — bail silently (log only, nothing on stderr).
        #
        # We intentionally do not check whether the push/edit command itself
        # succeeded. The trace is the conversation transcript, not the diff,
        # so refreshing it after a failed push just re-uploads the same
        # conversation to the branch's existing PR — harmless and idempotent.
        # (The `create` path bails when stdout has no PR URL only because a
        # failed `gh pr create` leaves no PR to attach a trace to.)
        try:
            pr_url = resolve_pr_url(None, cwd=_repo_dir(payload))
        except (subprocess.SubprocessError, OSError) as e:
            _log(f"skipped: no open PR for current branch ({_gh_error(e)})")
            return
        if not pr_url:
            _log("skipped: no open PR for current branch")
            return

    _log(f"detected PR ({trigger}): {pr_url}")

    try:
        token = get_gh_token()
    except GhTokenError as e:
        _bail(str(e))
        return

    server_url = os.environ.get("VIBESHUB_SERVER_URL", "https://vibeshub.ai")

    from platform_adapter import select_adapter

    options = RunOptions(
        server_url=server_url,
        token=token,
        pr_url=pr_url,
        session_id=payload.get("session_id"),
    )
    reader = select_adapter(payload)

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

    diag = ""
    if result.payload_bytes is not None and result.upload_elapsed_seconds is not None:
        diag = f" (bytes={result.payload_bytes} elapsed={result.upload_elapsed_seconds:.2f}s)"

    if result.uploaded:
        msg = f"trace uploaded: {result.trace_url}"
        if result.skip_reason:
            msg += f" (note: {result.skip_reason})"
        _log(msg + diag)
        print(f"[vibeshub] {msg}", file=sys.stderr)
    else:
        _log(f"skipped: {result.skip_reason}{diag}")
        print(f"[vibeshub] skipped: {result.skip_reason}", file=sys.stderr)


if __name__ == "__main__":
    main()
