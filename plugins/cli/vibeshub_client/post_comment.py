from __future__ import annotations

import re
import subprocess

_TRACE_SHORT_RE = re.compile(r"^(?P<base>https?://[^/]+)/t/(?P<sid>[A-Za-z0-9_-]+)$")
_PR_URL_RE = re.compile(
    r"^https?://github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+)/pull/(?P<n>\d+)/?$"
)


def _pr_style_trace_url(trace_url: str, pr_url: str) -> str:
    """Rewrite a /t/<sid> server URL into the descriptive /<owner>/<repo>/pull/<n>/<sid>
    form for display in PR comments. Returns trace_url unchanged if either input
    doesn't match the expected shape."""
    t = _TRACE_SHORT_RE.match(trace_url)
    p = _PR_URL_RE.match(pr_url)
    if not t or not p:
        return trace_url
    return f"{t['base']}/{p['owner']}/{p['repo']}/pull/{p['n']}/{t['sid']}"


def build_comment_body(
    trace_url: str, pr_url: str, *, platform_label: str = "Claude Code"
) -> str:
    return (
        f"{platform_label} trace for this PR: {_pr_style_trace_url(trace_url, pr_url)}\n\n"
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
