# vibeshub

Deployed at [vibeshub.ai](https://vibeshub.ai).

Host AI coding-agent conversation traces and link them to the pull requests they produced. vibeshub supports **Claude Code**, **Cursor**, and **Codex** — each platform's plugin uploads the session transcript whenever you create or update a PR (or push the branch), and posts a comment on the PR linking to the trace. A backend summary agent distills each trace into an AI digest with the ask, key decisions, dead ends, and chapter anchors so reviewers can start from the story before reading the raw transcript. Trace visibility mirrors the repository on GitHub: public stays public, private stays private and is gated on the viewer's GitHub access.

## Supported platforms

| Platform | Install |
|----------|---------|
| Claude Code | Marketplace plugin — see [plugins/cli/README.md](plugins/cli/README.md#install) |
| Codex | Marketplace plugin — same package, auto-detected at runtime |
| Cursor | One-time hook install: `python3 plugins/cli/commands/install-cursor.py` |

All three share the same upload pipeline, redaction, and PR comment logic. Platform-specific hook surfaces and transcript paths are documented in [plugins/cli/README.md](plugins/cli/README.md).

## How it works

1. A platform hook fires after a shell command (Claude Code and Codex: `PostToolUse` on `Bash`; Cursor: `afterShellExecution`). It looks for `gh pr create`, `gh pr edit`, or `git push` and, when one is detected, runs the share pipeline.
2. The hook locates the session transcript for that platform (e.g. `~/.claude/projects/.../*.jsonl`, `~/.codex/sessions/.../*.jsonl`, or `~/.cursor/projects/.../agent-transcripts/.../*.jsonl`, plus any subagent transcripts) and runs client-side redaction (AWS / GitHub / OpenAI / Anthropic keys, JWTs, env-style assignments, high-entropy tokens).
3. It uploads to the backend with your `gh auth token` as identity. TLS is verified against the OS trust store so uploads work on networks behind a TLS-intercepting proxy.
4. The backend stores the transcript blob (main + per-subagent), runs a second redaction pass, and runs the trace digest summary agent when OpenAI credentials are configured.
5. The digest agent converts platform transcripts into a shared Claude-shaped stream, distills the trace into a compact prompt, persists the structured digest and chapter anchors, and records each run in `agent_run` for cost and failure-mode rollups.
6. The backend returns the trace URL and any generated digest.
7. The plugin posts that URL as a comment on the PR the first time; when a digest exists, the comment includes the summary. Subsequent updates refresh the same trace.
8. Visiting the URL loads the SPA and renders the JSONL as a trace viewer (hero + digest panel + chapter jumps + collapsible tool cards + prompt rail + activity timeline + light/dark theme + syntax-highlighted code/diffs).
9. Private-repo traces are gated: the backend checks the signed-in viewer's GitHub access to the repo (via their OAuth token) before serving the trace. Viewers grant private access with an opt-in "Enable private repositories" login.
10. Web upload (`/upload`) and standalone (no-repo) traces are also supported — those uploads use a session cookie rather than a `gh` bearer token.

Additional platforms can plug in by mirroring [plugins/cli/](plugins/cli/) — see [plugins/README.md](plugins/README.md).

## Repo layout

```
vibeshub/
├── plugins/
│   ├── cli/            # Claude Code + Codex + Cursor: hooks + /share-trace slash command;
│   │                   # bundles the vibeshub_client library (redaction, upload, gh-comment)
│   └── README.md       # how to add a new platform plugin
├── webapp/
│   ├── backend/        # FastAPI + SQLAlchemy + Alembic; serves SPA from frontend_dist/
│   │                   # GitHub OAuth, session cookies, repo-access gating, blob storage
│   │                   # agents/digest: trace summary agent + chapter anchors
│   └── frontend/       # React + Vite SPA; build copies dist/ → backend/frontend_dist/
│                       # Landing, /home, /upload, /privacy, /:owner, /:owner/:repo,
│                       # /:owner/:repo/pull/:number, /t/:shortId trace viewer
├── deploy/azure/       # Dockerfile + deploy.sh + Portal/CLI walkthroughs
└── docs/superpowers/   # design spec + implementation plans
```

Per-component docs:
- [webapp/backend/README.md](webapp/backend/README.md) — env vars, OAuth setup, local run, tests
- [webapp/backend/app/agents/digest/README.md](webapp/backend/app/agents/digest/README.md) — summary agent flow, OpenAI env vars, degradation modes, operations queries
- [webapp/frontend/README.md](webapp/frontend/README.md) — routes, dev server, build, tests
- [plugins/cli/README.md](plugins/cli/README.md) — install, hook config, slash command

## Local development

```bash
# Backend (FastAPI on :8000) — in-memory SQLite, /tmp blob dir
./env/bin/pip install -e "webapp/backend[dev]"
./env/bin/uvicorn app.main:app --reload --app-dir webapp/backend

# Frontend (Vite on :5173) — proxies /api → backend:8000
cd webapp/frontend && npm install && npm run dev
```

GitHub OAuth is optional locally — auth routes return `503 oauth_not_configured` until `VIBESHUB_GITHUB_OAUTH_CLIENT_ID`, `VIBESHUB_SESSION_SECRET`, and `VIBESHUB_TOKEN_ENCRYPTION_KEY` are set. See the backend README for the full list.

## Deploying

- **Azure** — Container Apps + Postgres Flexible Server + Blob Storage with managed identity: see [deploy/azure/README.md](deploy/azure/README.md) (CLI) or [deploy/azure/README-portal.md](deploy/azure/README-portal.md) (Portal walkthrough).
