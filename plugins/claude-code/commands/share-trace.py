#!/usr/bin/env python3
"""
Manual upload / delete entry point for vibeshub.

Usage:
  share-trace                       # auto-detect: PR, else repo, else standalone
  share-trace <pr-url-or-number>    # share a specific PR
  share-trace delete <id>           # delete a trace by PR URL, /t/<id> URL,
                                    # or bare short id
"""
from __future__ import annotations

import asyncio
import os
import re
import sys
from pathlib import Path

_SHORT_ID_RE = re.compile(r"^[A-Za-z0-9]+$")


def _session_id() -> str | None:
    """The current Claude Code session id. Claude Code exports
    CLAUDE_CODE_SESSION_ID; CLAUDE_SESSION_ID is accepted as a legacy/manual
    fallback."""
    return os.environ.get("CLAUDE_CODE_SESSION_ID") or os.environ.get(
        "CLAUDE_SESSION_ID"
    )


def _delete_short_id(arg: str, server_url: str) -> str | None:
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
    from urllib import request as urllib_request

    parts = pr_url.rstrip("/").split("/")
    owner, repo, number = parts[-4], parts[-3], parts[-1]
    list_url = (
        f"{_server_base(server_url)}/api/traces/{owner}/{repo}/pull/{number}"
    )

    def _list() -> list[dict]:
        with urllib_request.urlopen(list_url, timeout=15.0) as resp:
            if resp.status >= 400:
                raise RuntimeError(f"list failed: HTTP {resp.status}")
            data = json.loads(resp.read().decode("utf-8"))
        return data.get("traces", [])

    traces = await asyncio.to_thread(_list)
    if not traces:
        print("no traces found for that PR", file=sys.stderr)
        return
    await _delete_by_short_id(traces[0]["short_id"], server_url)


def main() -> None:
    args = sys.argv[1:]
    server_url = os.environ.get("VIBESHUB_SERVER_URL", "https://vibeshub.ai")
    session_id = _session_id()

    plugin_root = Path(
        os.environ.get(
            "CLAUDE_PLUGIN_ROOT", Path(__file__).resolve().parent.parent
        )
    )
    if str(plugin_root) not in sys.path:
        sys.path.insert(0, str(plugin_root))

    from vibeshub_client.pr_resolve import resolve_pr_url

    if args and args[0] == "delete":
        if len(args) < 2:
            print(
                "usage: share-trace delete <pr-url | /t/<id> url | short-id>",
                file=sys.stderr,
            )
            sys.exit(1)
        short_id = _delete_short_id(args[1], server_url)
        if short_id is not None:
            asyncio.run(_delete_by_short_id(short_id, server_url))
        else:
            asyncio.run(_delete_by_pr(resolve_pr_url(args[1]), server_url))
        return

    asyncio.run(_share(args, server_url, session_id))


if __name__ == "__main__":
    main()
