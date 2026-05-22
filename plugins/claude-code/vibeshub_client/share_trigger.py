from __future__ import annotations


def classify_share_trigger(command: str) -> str | None:
    """Classify a Bash command into the kind of vibeshub share it triggers.

    Returns:
      "create" — `gh pr create`  (PR URL comes from gh stdout)
      "push"   — `git push`      (PR URL resolved from the current branch)
      "edit"   — `gh pr edit`    (PR URL resolved from the current branch)
      None     — anything else

    Substring matching, so compound commands (`git add . && git push`) are
    handled. `gh pr create` and `gh pr edit` are checked before `git push`,
    so a command doing both edits and pushes classifies as the gh action
    (both resolve to the same current-branch PR anyway).
    """
    if "gh pr create" in command:
        return "create"
    if "gh pr edit" in command:
        return "edit"
    if "git push" in command:
        return "push"
    return None
