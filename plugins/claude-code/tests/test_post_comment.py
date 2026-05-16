import subprocess
from unittest.mock import MagicMock

import pytest

from vibeshub_client.post_comment import build_comment_body, post_pr_comment


def test_build_comment_body_includes_url():
    body = build_comment_body("https://vibeshub.test/alice/repo/pull/3/abc")
    assert "https://vibeshub.test/alice/repo/pull/3/abc" in body
    assert "Uploaded by the PR author." in body
    assert "public by default" not in body.lower()


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
