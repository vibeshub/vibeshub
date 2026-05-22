import subprocess
from unittest.mock import patch

from vibeshub_client.repo_resolve import resolve_repo_full_name


def test_resolve_repo_full_name_returns_owner_slash_name():
    fake = subprocess.CompletedProcess(
        args=[], returncode=0,
        stdout="alice/repo\n", stderr="",
    )
    with patch("vibeshub_client.repo_resolve.subprocess.run", return_value=fake) as run:
        assert resolve_repo_full_name() == "alice/repo"
        assert run.call_args.args[0] == [
            "gh", "repo", "view", "--json", "nameWithOwner",
            "-q", ".nameWithOwner",
        ]


def test_resolve_repo_full_name_passes_cwd():
    fake = subprocess.CompletedProcess(
        args=[], returncode=0,
        stdout="alice/repo\n", stderr="",
    )
    with patch("vibeshub_client.repo_resolve.subprocess.run", return_value=fake) as run:
        resolve_repo_full_name(cwd="/some/repo")
        assert run.call_args.kwargs["cwd"] == "/some/repo"


def test_resolve_repo_full_name_returns_none_when_no_github_remote():
    def boom(*args, **kwargs):
        raise subprocess.CalledProcessError(1, args[0], stderr="no remote")

    with patch("vibeshub_client.repo_resolve.subprocess.run", side_effect=boom):
        assert resolve_repo_full_name() is None


def test_resolve_repo_full_name_returns_none_when_gh_missing():
    with patch("vibeshub_client.repo_resolve.subprocess.run", side_effect=OSError):
        assert resolve_repo_full_name() is None


def test_resolve_repo_full_name_returns_none_on_empty_output():
    fake = subprocess.CompletedProcess(
        args=[], returncode=0, stdout="\n", stderr="",
    )
    with patch("vibeshub_client.repo_resolve.subprocess.run", return_value=fake):
        assert resolve_repo_full_name() is None
