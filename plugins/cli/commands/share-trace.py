#!/usr/bin/env python3
"""
Manual upload / delete entry point for vibeshub.

Usage:
  share-trace                       # auto-detect: PR, else repo, else standalone
  share-trace <pr-url-or-number>    # share a specific PR
  share-trace delete <id>           # delete a trace by PR URL, PR number,
                                    # /t/<id> URL, or bare short id
"""
from __future__ import annotations

import asyncio
import os
import re
import subprocess
import sys
from pathlib import Path

_SHORT_ID_RE = re.compile(r"^[A-Za-z0-9]+$")

# The plugin root must be importable before the vibeshub_client imports
# below. CLAUDE_PLUGIN_ROOT is set by Claude Code; fall back to this file's
# grandparent when the module is imported directly (e.g. by tests).
_PLUGIN_ROOT = Path(
    os.environ.get(
        "CLAUDE_PLUGIN_ROOT", Path(__file__).resolve().parent.parent
    )
)
if str(_PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(_PLUGIN_ROOT))

from vibeshub_client.pr_resolve import resolve_pr_url  # noqa: E402
from vibeshub_client.repo_resolve import resolve_repo_full_name  # noqa: E402


def _session_id() -> str | None:
    """The current Claude Code session id. Claude Code exports
    CLAUDE_CODE_SESSION_ID; CLAUDE_SESSION_ID is accepted as a legacy/manual
    fallback."""
    return os.environ.get("CLAUDE_CODE_SESSION_ID") or os.environ.get(
        "CLAUDE_SESSION_ID"
    )


def _delete_short_id(arg: str) -> str | None:
    """Resolve a delete argument to a trace short id, or None if `arg` is
    not a short id form (e.g. it is a PR URL — the caller resolves that
    separately).

    Accepts a bare short id (`abc1234567`) or a `<server>/t/<id>` URL.
    """
    value = arg.rstrip("/")
    if "/t/" in value:
        return value.rsplit("/t/", 1)[1] or None
    if "://" in value or "/" in value:
        return None
    return value if _SHORT_ID_RE.match(value) else None


def _server_base(server_url: str) -> str:
    return server_url.rstrip("/")


async def _delete_by_short_id(short_id: str, server_url: str) -> None:
    from urllib import error as urllib_error
    from urllib import request as urllib_request

    from vibeshub_client.gh_token import get_gh_token

    def _do_delete(token: str) -> tuple[int, str]:
        req = urllib_request.Request(
            f"{_server_base(server_url)}/api/traces/{short_id}",
            headers={"Authorization": f"Bearer {token}"},
            method="DELETE",
        )
        try:
            with urllib_request.urlopen(req, timeout=15.0) as resp:
                return resp.status, resp.read().decode("utf-8", errors="replace")
        except urllib_error.HTTPError as e:
            return e.code, e.read().decode("utf-8", errors="replace")

    token = get_gh_token()
    status, body = await asyncio.to_thread(_do_delete, token)
    if status == 204:
        print(f"deleted trace {short_id}")
    else:
        print(f"delete failed: {status} {body}", file=sys.stderr)


async def _delete_by_pr(pr_url: str, server_url: str) -> None:
    import json
    from urllib import error as urllib_error
    from urllib import request as urllib_request

    parts = pr_url.rstrip("/").split("/")
    owner, repo, number = parts[-4], parts[-3], parts[-1]
    list_url = (
        f"{_server_base(server_url)}/api/traces/{owner}/{repo}/pull/{number}"
    )

    def _list() -> list[dict] | None:
        try:
            with urllib_request.urlopen(list_url, timeout=15.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib_error.HTTPError as e:
            if e.code == 404:
                return None
            print(f"list failed: HTTP {e.code}", file=sys.stderr)
            return None
        return data.get("traces", [])

    traces = await asyncio.to_thread(_list)
    if not traces:
        print("no traces found for that PR", file=sys.stderr)
        return
    await _delete_by_short_id(traces[0]["short_id"], server_url)


def _resolve_target(*, arg: str | None) -> tuple[str | None, str | None]:
    """Resolve the upload target as a (pr_url, repo_full_name) pair.

    Resolution order:
      1. An open PR (the explicit `arg`, or the current branch's PR) ->
         (pr_url, None).
      2. No PR but a GitHub repo for the current dir -> (None, repo).
      3. Neither -> (None, None), a standalone upload.
    """
    try:
        pr_url = resolve_pr_url(arg)
    except (subprocess.SubprocessError, OSError):
        pr_url = None
    if pr_url:
        return pr_url, None
    return None, resolve_repo_full_name()


async def _share(
    args: list[str], server_url: str, session_id: str | None
) -> None:
    from vibeshub_client.gh_token import get_gh_token
    from vibeshub_client.pipeline import RunOptions, run_share_pipeline
    from platform_adapter import select_adapter

    # Under Codex there is no Claude session id. select_adapter falls back to
    # CODEX_HOME, and CodexTranscriptReader picks the newest rollout for cwd.
    reader = select_adapter({"cwd": os.getcwd(), "plugin_root": str(_PLUGIN_ROOT)})

    if not session_id and reader.platform_id() == "claude-code":
        sys.stderr.write(
            "[vibeshub] no session_id available; this command must be run "
            "inside a Claude Code session\n"
        )
        return

    pr_url, repo_full_name = _resolve_target(arg=args[0] if args else None)

    options = RunOptions(
        server_url=server_url,
        token=get_gh_token(),
        pr_url=pr_url,
        repo_full_name=repo_full_name,
        session_id=session_id,
    )
    hook_input = {"session_id": session_id, "cwd": os.getcwd()}

    result = await run_share_pipeline(
        reader=reader, hook_input=hook_input, options=options
    )
    if not result.uploaded:
        print(f"skipped: {result.skip_reason}", file=sys.stderr)
        return

    print(f"trace uploaded: {result.trace_url}")
    if pr_url is None and repo_full_name is not None:
        print(f"attached to repo {repo_full_name}")
    elif pr_url is None and repo_full_name is None:
        print(
            "This is a standalone (public) trace. You can make it private "
            "from the trace page in the vibeshub UI."
        )
    if result.skip_reason:
        print(f"note: {result.skip_reason}", file=sys.stderr)


def main() -> None:
    args = sys.argv[1:]
    server_url = os.environ.get("VIBESHUB_SERVER_URL", "https://vibeshub.ai")
    session_id = _session_id()

    if args and args[0] == "delete":
        if len(args) < 2:
            print(
                "usage: share-trace delete "
                "<pr-url | pr-number | /t/<id> url | short-id>",
                file=sys.stderr,
            )
            sys.exit(1)
        if args[1].isdigit():
            # A bare number is a PR number, not a short id.
            asyncio.run(_delete_by_pr(resolve_pr_url(args[1]), server_url))
            return
        short_id = _delete_short_id(args[1])
        if short_id is not None:
            asyncio.run(_delete_by_short_id(short_id, server_url))
        else:
            asyncio.run(_delete_by_pr(resolve_pr_url(args[1]), server_url))
        return

    asyncio.run(_share(args, server_url, session_id))


if __name__ == "__main__":
    main()
