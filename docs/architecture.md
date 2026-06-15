# Architecture

How a trace gets from an AI coding session onto the pull request it produced. The
[README](../README.md) shows the three-step version; this is the full pipeline.

## The upload pipeline (ten steps)

1. A platform hook fires after a shell command (Claude Code and Codex: `PostToolUse` on `Bash`; Cursor: `afterShellExecution`). It looks for `gh pr create`, `gh pr edit`, or `git push` and, when one is detected, runs the share pipeline.
2. The hook locates the session transcript for that platform (e.g. `~/.claude/projects/.../*.jsonl`, `~/.codex/sessions/.../*.jsonl`, or `~/.cursor/projects/.../agent-transcripts/.../*.jsonl`, plus any subagent transcripts) and runs client-side redaction (AWS / GitHub / OpenAI / Anthropic keys, JWTs, env-style assignments, high-entropy tokens).
3. It uploads to the backend with your `gh auth token` as identity. TLS is verified against the OS trust store so uploads work on networks behind a TLS-intercepting proxy.
4. The backend stores the transcript blob (main + per-subagent), runs a second redaction pass, and runs the trace digest summary agent when OpenAI credentials are configured.
5. The digest agent converts platform transcripts into a shared Claude-shaped stream, distills the trace into a compact prompt, persists the structured digest and chapter anchors, and records each run in `agent_run` for cost and failure-mode rollups.
6. The backend returns the trace URL and any generated digest.
7. The plugin posts that URL as a comment on the PR the first time; when a digest exists, the comment includes the summary. Subsequent updates refresh the same trace.
8. Visiting the URL loads the SPA and renders the JSONL as a trace viewer (hero + digest panel + chapter jumps + collapsible tool cards + prompt rail + activity timeline + light/dark theme + syntax-highlighted code/diffs).
9. Private-repo traces are gated: the backend checks the signed-in viewer's GitHub access to the repo (via their OAuth token) before serving the trace. Viewers grant private access with an opt-in "Enable private repositories" login.
10. Web upload (`/upload`) and standalone (no-repo) traces are also supported; those uploads use a session cookie rather than a `gh` bearer token.

## Adding a platform

Additional platforms can plug in by mirroring [plugins/cli/](../plugins/cli/). See [plugins/README.md](../plugins/README.md) for the contract a new platform plugin has to satisfy.
