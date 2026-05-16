from __future__ import annotations

import math
import re
from dataclasses import dataclass, field


@dataclass
class RedactionReport:
    counts: dict[str, int] = field(default_factory=dict)

    def total(self) -> int:
        return sum(self.counts.values())


_NAMED_PATTERNS: list[tuple[str, re.Pattern[bytes]]] = [
    ("anthropic_key", re.compile(rb"sk-ant-[A-Za-z0-9_\-]{20,}")),
    ("openai_key", re.compile(rb"sk-[A-Za-z0-9]{40,}")),
    ("github_token", re.compile(rb"gh[pousr]_[A-Za-z0-9]{30,}")),
    ("aws_access_key_id", re.compile(rb"AKIA[0-9A-Z]{16}")),
    ("aws_secret_access_key", re.compile(
        rb"(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])"
    )),
    ("jwt", re.compile(
        rb"eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"
    )),
    ("env_assignment", re.compile(
        rb"([A-Z][A-Z0-9_]{2,}_(?:KEY|TOKEN|SECRET|PASSWORD|PASS))=([A-Za-z0-9/+=_\-]{16,})"
    )),
]

_TOKEN_RE = re.compile(rb'"((?:[A-Za-z0-9_\-+/=]){32,})"')
_ENTROPY_THRESHOLD = 4.0


def _shannon_entropy(s: bytes) -> float:
    if not s:
        return 0.0
    freq: dict[int, int] = {}
    for b in s:
        freq[b] = freq.get(b, 0) + 1
    n = len(s)
    return -sum((c / n) * math.log2(c / n) for c in freq.values())


def _replace_named(category: str, match: re.Match[bytes]) -> bytes:
    if category == "env_assignment":
        return match.group(1) + b"=[REDACTED:" + category.encode() + b"]"
    return b"[REDACTED:" + category.encode() + b"]"


def redact_jsonl(data: bytes) -> tuple[bytes, RedactionReport]:
    report = RedactionReport()
    out = data
    for category, pattern in _NAMED_PATTERNS:
        def _sub(match: re.Match[bytes], _cat=category) -> bytes:
            report.counts[_cat] = report.counts.get(_cat, 0) + 1
            return _replace_named(_cat, match)
        out = pattern.sub(_sub, out)

    def _entropy_sub(match: re.Match[bytes]) -> bytes:
        token = match.group(1)
        if _shannon_entropy(token) >= _ENTROPY_THRESHOLD:
            report.counts["high_entropy_token"] = (
                report.counts.get("high_entropy_token", 0) + 1
            )
            return b'"[REDACTED:high_entropy_token]"'
        return match.group(0)

    out = _TOKEN_RE.sub(_entropy_sub, out)
    return out, report
