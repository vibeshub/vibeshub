import subprocess
from unittest.mock import MagicMock

import pytest

from vibeshub_client.post_comment import build_comment_body, post_pr_comment


def test_build_comment_body_rewrites_short_url_to_pr_style():
    body = build_comment_body(
        "https://vibeshub.test/t/abc",
        "https://github.com/alice/repo/pull/3",
    )
    assert "https://vibeshub.test/alice/repo/pull/3/abc" in body
    assert "/t/abc" not in body
    assert "Uploaded by the PR author." in body
    assert "public by default" not in body.lower()


def test_comment_body_uses_platform_label():
    body = build_comment_body(
        "https://vibeshub.test/t/abc",
        "https://github.com/alice/repo/pull/1",
        platform_label="Codex CLI",
    )
    assert "Codex CLI trace for this PR" in body
    # default stays Claude Code
    default = build_comment_body(
        "https://vibeshub.test/t/abc",
        "https://github.com/alice/repo/pull/1",
    )
    assert "Claude Code trace for this PR" in default


def test_build_comment_body_passes_through_unrecognized_trace_url():
    body = build_comment_body(
        "https://vibeshub.test/something-else",
        "https://github.com/alice/repo/pull/3",
    )
    assert "https://vibeshub.test/something-else" in body


def test_build_comment_body_passes_through_unrecognized_pr_url():
    body = build_comment_body(
        "https://vibeshub.test/t/abc",
        "https://example.com/not-a-pr",
    )
    assert "https://vibeshub.test/t/abc" in body


def test_post_pr_comment_invokes_gh(monkeypatch):
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        return MagicMock(returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    post_pr_comment(
        pr_url="https://github.com/alice/repo/pull/3",
        body="hello",
    )

    assert len(calls) == 1
    cmd = calls[0]
    assert cmd[0] == "gh"
    assert "pr" in cmd
    assert "comment" in cmd
    assert "https://github.com/alice/repo/pull/3" in cmd
    assert "-b" in cmd
    assert "hello" in cmd


def test_post_pr_comment_raises_on_failure(monkeypatch):
    def fake_run(cmd, **kwargs):
        raise subprocess.CalledProcessError(1, cmd, stderr="boom")

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(RuntimeError, match="boom"):
        post_pr_comment(pr_url="https://github.com/x/y/pull/1", body="x")


def test_build_comment_body_without_digest_is_unchanged():
    """Regression guard: today's one-line body must be preserved when no
    digest is supplied so older backends keep working."""
    from vibeshub_client.post_comment import build_comment_body
    body = build_comment_body(
        trace_url="https://vibeshub.test/t/abc12345",
        pr_url="https://github.com/x/y/pull/1",
    )
    assert "Claude Code trace for this PR" in body
    assert "**Ask:**" not in body  # no digest formatting


def test_build_comment_body_with_digest_prepends_five_bullets():
    from vibeshub_client.post_comment import build_comment_body
    digest = {
        "ask": "Add /healthcheck",
        "decisions": "Inline in main.py",
        "files": "webapp/backend/app/main.py",
        "tests": "test_health.py: assert 200 on /healthcheck",
        "dead_ends": "Considered a new router; YAGNI",
        "chapters": [],
    }
    body = build_comment_body(
        trace_url="https://vibeshub.test/t/abc12345",
        pr_url="https://github.com/x/y/pull/1",
        digest=digest,
    )
    # Five bullets in order
    lines = body.splitlines()
    expected_prefixes = [
        "**Ask:**", "**Key decisions:**", "**Files touched:**",
        "**Tests added:**", "**Dead ends:**",
    ]
    found = [l for l in lines if any(l.startswith(p) for p in expected_prefixes)]
    assert len(found) == 5
    assert "Add /healthcheck" in body
    # Trace link still present
    assert "Claude Code trace for this PR" in body


def test_build_comment_body_with_partial_digest_still_renders_known_fields():
    from vibeshub_client.post_comment import build_comment_body
    # Backend could omit fields in some failure mode; we just render what's
    # present without raising KeyError.
    digest = {"ask": "x"}
    body = build_comment_body(
        trace_url="https://vibeshub.test/t/abc12345",
        pr_url="https://github.com/x/y/pull/1",
        digest=digest,
    )
    assert "**Ask:** x" in body
