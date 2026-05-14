from __future__ import annotations

import shutil
import subprocess


class GhTokenError(Exception):
    pass


def get_gh_token() -> str:
    """
    Read the user's GitHub token via `gh auth token`. Returns the raw token
    string. Raises GhTokenError if `gh` is not installed or unauthenticated.
    """
    if shutil.which("gh") is None:
        raise GhTokenError("`gh` CLI not found in PATH; install via brew install gh")
    try:
        result = subprocess.run(
            ["gh", "auth", "token"],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as e:
        raise GhTokenError(
            f"`gh auth token` failed; run `gh auth login` first. stderr: {e.stderr}"
        ) from e
    token = result.stdout.strip()
    if not token:
        raise GhTokenError("`gh auth token` returned empty output")
    return token
