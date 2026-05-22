"""Access control and schema behavior for standalone (no repo/PR) traces."""
import pytest

from app.api.schemas import TraceSummary


def test_trace_summary_accepts_null_repo_and_pr():
    summary = TraceSummary(
        trace_id="t-1",
        short_id="standalone1",
        owner_login="alice",
        repo_full_name=None,
        pr_number=None,
        pr_url=None,
        pr_title=None,
        platform="claude-code",
        byte_size=10,
        message_count=1,
        created_at="2026-05-22T00:00:00+00:00",
        is_private=False,
    )
    dumped = summary.model_dump()
    assert dumped["repo_full_name"] is None
    assert dumped["pr_number"] is None
    assert dumped["pr_url"] is None
