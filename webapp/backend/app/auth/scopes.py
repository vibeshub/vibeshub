from __future__ import annotations

from app.storage.models import User


def has_repo_scope(user: User) -> bool:
    """True if the user's GitHub token carries the classic `repo` scope.

    `repo` is what lets vibeshub read the user's private repositories on
    their behalf — the gate for viewing private-repo traces.
    """
    return "repo" in (user.token_scopes or "").split(",")
