from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class RedactionReport:
    counts: dict[str, int] = field(default_factory=dict)

    def total(self) -> int:
        return sum(self.counts.values())


# Order matters: more specific patterns first, since text replacement is
# applied sequentially and overlaps would otherwise be partially shadowed.
_PATTERNS: list[tuple[str, re.Pattern[bytes]]] = [
    ("anthropic_key", re.compile(rb"sk-ant-[A-Za-z0-9_\-]{20,}")),
    ("openai_key", re.compile(rb"sk-[A-Za-z0-9]{40,}")),
    ("github_token", re.compile(rb"gh[pousr]_[A-Za-z0-9]{30,}")),
    ("aws_access_key_id", re.compile(rb"AKIA[0-9A-Z]{16}")),
    ("aws_secret_access_key", re.compile(rb"(?<![A-Za-z0-9/+])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+])")),
    ("jwt", re.compile(rb"eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}")),
    # KEY=value where value looks high-entropy and >= 16 chars
    ("env_assignment", re.compile(rb"([A-Z][A-Z0-9_]{2,}_(?:KEY|TOKEN|SECRET|PASSWORD|PASS))=([A-Za-z0-9/+=_\-]{16,})")),
]


def _replace(category: str, match: re.Match[bytes]) -> bytes:
    if category == "env_assignment":
        return match.group(1) + b"=[REDACTED:" + category.encode() + b"]"
    return b"[REDACTED:" + category.encode() + b"]"


def redact_jsonl(data: bytes) -> tuple[bytes, RedactionReport]:
    """
    Apply redaction patterns to raw JSONL bytes. Operates on bytes so we don't
    need to parse-and-reserialize each line; that would change formatting and
    risk altering claude-code-log's expected schema.
    """
    report = RedactionReport()
    out = data
    for category, pattern in _PATTERNS:
        def _sub(match: re.Match[bytes], _cat=category) -> bytes:
            report.counts[_cat] = report.counts.get(_cat, 0) + 1
            return _replace(_cat, match)
        out = pattern.sub(_sub, out)
    return out, report
