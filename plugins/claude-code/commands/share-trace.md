---
name: share-trace
description: Manually upload the current Claude Code session to vibeshub, or delete an existing trace.
argument-hint: "[<pr-number-or-url>] | delete <pr-url | pr-number | /t/<id> url | short-id>"
---

Use this command to upload the current session's trace to vibeshub. Without
arguments it picks the best target automatically:

1. The most recent open PR you authored on the current branch — the trace is
   attached to that PR and a PR comment is posted.
2. Otherwise, if you are inside a git repo with a GitHub remote, the trace is
   attached to that repo.
3. Otherwise, the trace is uploaded standalone and is public; you can switch
   it to private from the trace page in the vibeshub UI.

Pass a PR number or URL to force a specific PR. Use `delete` with a PR URL, a
bare PR number, a `/t/<id>` trace URL, or a bare short id to remove a trace. A
bare number is always treated as a PR number.

Run the helper script:

!python3 "${CLAUDE_PLUGIN_ROOT}/commands/share-trace.py" $ARGUMENTS
