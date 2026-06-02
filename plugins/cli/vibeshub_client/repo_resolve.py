from __future__ import annotations

import subprocess


def resolve_repo_full_name(*, cwd: str | None = None) -> str | None:
    """The current repo's `owner/name`, derived from its GitHub remote.

    Runs `gh repo view`, which inspects the git remotes and resolves the
    repo on GitHub. Returns None when the directory is not a git repo, has
    no GitHub remote, or `gh` is not installed — i.e. whenever no repo can
    be attached to a trace.

    `cwd` is the directory `gh` runs in (defaults to the process cwd).
    """
    try:
        result = subprocess.run(
            ["gh", "repo", "view", "--json", "nameWithOwner",
             "-q", ".nameWithOwner"],
            check=True,
            capture_output=True,
            text=True,
            cwd=cwd,
        )
    except (subprocess.SubprocessError, OSError):
        return None
    name = result.stdout.strip()
    return name or None
