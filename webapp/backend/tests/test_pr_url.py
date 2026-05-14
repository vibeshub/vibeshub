import pytest

from app.api.pr_url import ParsedPrUrl, parse_pr_url


def test_parses_canonical_url():
    parsed = parse_pr_url("https://github.com/alice/repo/pull/42")
    assert parsed == ParsedPrUrl(owner="alice", repo="repo", number=42)


def test_parses_with_trailing_slash():
    parsed = parse_pr_url("https://github.com/alice/repo/pull/42/")
    assert parsed.number == 42


def test_rejects_non_github():
    with pytest.raises(ValueError):
        parse_pr_url("https://gitlab.com/x/y/pull/1")


def test_rejects_issue_url():
    with pytest.raises(ValueError):
        parse_pr_url("https://github.com/alice/repo/issues/42")
