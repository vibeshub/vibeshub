---
name: share-trace
description: Manually upload the current Codex session trace to vibeshub, share it with a PR or repository, or delete an existing trace.
---

# vibeshub share-trace

Use this skill when the user invokes `/vibeshub:share-trace` or asks to share,
upload, re-share, or delete a vibeshub trace from Codex.

Resolve the plugin root as the directory two levels above this `SKILL.md`, then
run the plugin's existing share helper from that plugin root:

```bash
python3 commands/share-trace.py
```

Pass through any user-supplied arguments to the script. Common forms:

```bash
python3 commands/share-trace.py
python3 commands/share-trace.py <pr-url-or-number>
python3 commands/share-trace.py delete <pr-url | pr-number | /t/<id> url | short-id>
```

Report the helper's stdout and stderr back to the user. If the helper uploads a
trace, include the trace URL in the response.
