#!/usr/bin/env python3
"""
Manual upload / delete entry point for vibeshub.

Usage:
  share-pr                       # auto-detect current branch's open PR
  share-pr <pr-url-or-number>    # specify a PR
  share-pr delete <pr-url>       # delete the most recent trace for this PR
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from pathlib import Path


def _gh(*args: str) -> str:
    return subprocess.run(
        ["gh", *args], check=True, capture_output=True, text=True
    ).stdout.strip()


def _resolve_pr_url(arg: str | None) -> str:
    if arg is None:
        return _gh("pr", "view", "--json", "url", "-q", ".url")
    if arg.isdigit():
        return _gh("pr", "view", arg, "--json", "url", "-q", ".url")
    return arg


async def _share(pr_url: str, server_url: str, session_id: str | None) -> None:
    plugin_root = Path(os.environ.get("CLAUDE_PLUGIN_ROOT", Path(__file__).resolve().parent.parent))
    sys.path.insert(0, str(plugin_root))

    from vibeshub_client.gh_token import get_gh_token
    from vibeshub_client.pipeline import RunOptions, run_share_pipeline
    from reader import ClaudeCodeTranscriptReader

    if not session_id:
        sys.stderr.write(
            "[vibeshub] no session_id available; this command must be run "
            "inside a Claude Code session\n"
        )
        return

    options = RunOptions(
        server_url=server_url,
        token=get_gh_token(),
        pr_url=pr_url,
        confirm=os.environ.get("VIBESHUB_AUTO_YES") != "1",
        session_id=session_id,
    )
    reader = ClaudeCodeTranscriptReader()
    hook_input = {"session_id": session_id, "cwd": os.getcwd()}

    result = await run_share_pipeline(
        reader=reader, hook_input=hook_input, options=options
    )
    if result.uploaded:
        print(f"trace uploaded: {result.trace_url}")
    else:
        print(f"skipped: {result.skip_reason}", file=sys.stderr)


async def _delete(pr_url: str, server_url: str) -> None:
    plugin_root = Path(os.environ.get("CLAUDE_PLUGIN_ROOT", Path(__file__).resolve().parent.parent))
    sys.path.insert(0, str(plugin_root))

    import httpx

    from vibeshub_client.gh_token import get_gh_token

    parts = pr_url.rstrip("/").split("/")
    owner, repo = parts[-4], parts[-3]
    number = parts[-1]
    list_url = f"{server_url.rstrip('/')}/api/traces/{owner}/{repo}/pull/{number}"
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(list_url)
        r.raise_for_status()
        traces = r.json().get("traces", [])
        if not traces:
            print("no traces found for that PR", file=sys.stderr)
            return
        short_id = traces[0]["short_id"]
        token = get_gh_token()
        d = await client.delete(
            f"{server_url.rstrip('/')}/api/traces/{short_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        if d.status_code == 204:
            print(f"deleted trace {short_id}")
        else:
            print(f"delete failed: {d.status_code} {d.text}", file=sys.stderr)


def main() -> None:
    args = sys.argv[1:]
    server_url = os.environ.get("VIBESHUB_SERVER_URL", "https://vibeshub.app")
    session_id = os.environ.get("CLAUDE_SESSION_ID")

    if args and args[0] == "delete":
        if len(args) < 2:
            print("usage: share-pr delete <pr-url>", file=sys.stderr)
            sys.exit(1)
        asyncio.run(_delete(_resolve_pr_url(args[1]), server_url))
        return

    pr_arg = args[0] if args else None
    pr_url = _resolve_pr_url(pr_arg)
    asyncio.run(_share(pr_url, server_url, session_id))


if __name__ == "__main__":
    main()
