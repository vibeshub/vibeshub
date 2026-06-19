from __future__ import annotations

import re

_PR_URL_RE = re.compile(
    r"https?://github\.com/[^/\s]+/[^/\s]+/pull/\d+"
)


def extract_pr_url_from_gh_stdout(stdout: str) -> str | None:
    """
    `gh pr create` prints the new PR URL on stdout (typically the last line).
    We grab the first GitHub PR URL we see.
    """
    m = _PR_URL_RE.search(stdout)
    return m.group(0) if m else None
