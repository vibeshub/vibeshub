from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class ParsedPrUrl:
    owner: str
    repo: str
    number: int


_RE = re.compile(
    r"^https?://github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+)/pull/(?P<number>\d+)/?$"
)


def parse_pr_url(url: str) -> ParsedPrUrl:
    m = _RE.match(url.strip())
    if not m:
        raise ValueError(f"not a github PR URL: {url}")
    return ParsedPrUrl(
        owner=m["owner"], repo=m["repo"], number=int(m["number"])
    )
