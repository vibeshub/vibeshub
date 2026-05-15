# vibeshub — Claude Code plugin

Uploads your Claude Code conversation trace to vibeshub when you create a PR
via `gh pr create`, and posts a comment on the PR linking to the public viewer.

## Install

Clone the vibeshub repo, register it as a local plugin marketplace, and install:

```bash
git clone https://github.com/Bhavya6187/vibeshub.git ~/code/vibeshub

# Inside Claude Code:
/plugin marketplace add ~/code/vibeshub
/plugin install vibeshub@vibeshub
```

The marketplace manifest at [.claude-plugin/marketplace.json](../../.claude-plugin/marketplace.json) points
Claude Code at this directory.

You'll also need:
- `gh` CLI, authenticated (`gh auth login`)
- Python 3.12+
- `pip install -e <vibeshub-repo>/plugins/shared` and
  `pip install -e <vibeshub-repo>/plugins/claude-code` so the hook script can
  import the client library

## Configure

| Env var | Default | Notes |
|---|---|---|
| `VIBESHUB_SERVER_URL` | `https://vibeshub.app` | Override for self-hosting |
| `VIBESHUB_AUTO_YES` | unset | Set to `1` to skip the y/N preview |

## How it works

After every Bash tool call, a `PostToolUse` hook runs and checks whether the
command included `gh pr create`. If so, the hook:

1. Locates this session's transcript at
   `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`.
2. Runs client-side redaction over the JSONL (AWS keys, GitHub tokens, OpenAI
   keys, Anthropic keys, JWTs, env-style assignments, and high-entropy tokens).
3. Prints a one-line summary on your terminal and prompts `y/N` (unless
   `VIBESHUB_AUTO_YES=1`).
4. Uploads to vibeshub using your `gh auth token` for identity.
5. Posts a `gh pr comment` linking to the public trace.

## Slash command

`/share-pr` lets you upload manually (e.g., the hook didn't run, or you want to
re-share after fixing something) or delete an existing trace:

- `/share-pr` — share the current branch's open PR
- `/share-pr <pr-url-or-number>` — share a specific PR
- `/share-pr delete <pr-url>` — delete the most recent trace for a PR

## Privacy

Traces are public by default. Two redaction passes (client + server) catch
known secret patterns, but neither is a guarantee. The y/N preview shows the
redaction summary so you can spot-check before uploading.
