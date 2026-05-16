from __future__ import annotations

import subprocess


def build_comment_body(trace_url: str) -> str:
    return (
        f"Claude Code trace for this PR: {trace_url}\n\n"
        "Uploaded by the PR author."
    )


def post_pr_comment(*, pr_url: str, body: str) -> None:
    """
    Post a comment to the PR via `gh pr comment`. The user's `gh` auth is used,
    so the comment author is the user themselves.
    """
    try:
        subprocess.run(
            ["gh", "pr", "comment", pr_url, "-b", body],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as e:
        raise RuntimeError(
            f"gh pr comment failed: {e.stderr.strip() if e.stderr else e}"
        ) from e
