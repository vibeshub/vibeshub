import subprocess
from unittest.mock import patch

from vibeshub_client.pr_resolve import resolve_pr_url


def test_resolve_pr_url_passes_through_a_url():
    url = "https://github.com/alice/repo/pull/9"
    with patch("vibeshub_client.pr_resolve.subprocess.run") as run:
        assert resolve_pr_url(url) == url
        run.assert_not_called()


def test_resolve_pr_url_current_branch():
    fake = subprocess.CompletedProcess(
        args=[], returncode=0,
        stdout="https://github.com/a/r/pull/3\n", stderr="",
    )
    with patch("vibeshub_client.pr_resolve.subprocess.run", return_value=fake) as run:
        assert resolve_pr_url(None) == "https://github.com/a/r/pull/3"
        assert run.call_args.args[0] == [
            "gh", "pr", "view", "--json", "url", "-q", ".url",
        ]


def test_resolve_pr_url_by_number():
    fake = subprocess.CompletedProcess(
        args=[], returncode=0,
        stdout="https://github.com/a/r/pull/7\n", stderr="",
    )
    with patch("vibeshub_client.pr_resolve.subprocess.run", return_value=fake) as run:
        assert resolve_pr_url("7") == "https://github.com/a/r/pull/7"
        assert run.call_args.args[0] == [
            "gh", "pr", "view", "7", "--json", "url", "-q", ".url",
        ]


def test_resolve_pr_url_passes_cwd():
    fake = subprocess.CompletedProcess(
        args=[], returncode=0,
        stdout="https://github.com/a/r/pull/3\n", stderr="",
    )
    with patch("vibeshub_client.pr_resolve.subprocess.run", return_value=fake) as run:
        resolve_pr_url(None, cwd="/some/repo")
        assert run.call_args.kwargs["cwd"] == "/some/repo"
