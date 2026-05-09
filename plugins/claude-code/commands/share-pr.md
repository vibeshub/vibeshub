---
name: share-pr
description: Manually upload the current Claude Code session to vibeshub for a PR, or delete an existing trace.
argument-hint: "[<pr-number-or-url>] | delete <pr-url>"
---

Use this command when the automatic `gh pr create` hook didn't run (e.g., the PR
was created in the GitHub UI, the server was down at the time, or you want to
re-share). Without arguments, the command picks the most recent open PR
authored by you on the current branch.

Run the helper script:

!python3 "${CLAUDE_PLUGIN_ROOT}/commands/share-pr.py" $ARGUMENTS
