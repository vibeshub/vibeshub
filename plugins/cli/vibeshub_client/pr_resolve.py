from __future__ import annotations

import subprocess


def _gh(*args: str, cwd: str | None = None) -> str:
    return subprocess.run(
        ["gh", *args], check=True, capture_output=True, text=True, cwd=cwd,
    ).stdout.strip()


def resolve_pr_url(arg: str | None, *, cwd: str | None = None) -> str:
    """Resolve a PR URL.

    arg=None        -> the open PR for the current branch
    arg is a digit  -> that PR number in the current repo
    arg otherwise   -> returned unchanged (already a URL)

    `cwd` is the directory `gh` runs in (defaults to the process cwd).

    Raises subprocess.CalledProcessError if `gh` cannot resolve a PR (e.g.
    the branch has no open PR), or OSError if `gh` is not installed.
    """
    if arg is None:
        return _gh("pr", "view", "--json", "url", "-q", ".url", cwd=cwd)
    if arg.isdigit():
        return _gh("pr", "view", arg, "--json", "url", "-q", ".url", cwd=cwd)
    return arg
