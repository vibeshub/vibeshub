# vibeshub

Deployed at [vibeshub.ai](https://vibeshub.ai).

Host Claude Code conversation traces and link them to the pull requests they produced. The Claude Code plugin uploads the session's transcript whenever you create or update a PR (or push the branch), and posts a comment on the PR linking to the trace. Trace visibility mirrors the repository on GitHub: public stays public, private stays private and is gated on the viewer's GitHub access.

## How it works

1. The Claude Code plugin's `PostToolUse` hook fires after any `Bash` invocation. It looks for `gh pr create`, `gh pr edit`, or `git push` and, when one is detected, runs the share pipeline.
2. The hook locates the session's `~/.claude/projects/.../*.jsonl` transcript (plus any subagent transcripts spawned in git worktrees) and runs client-side redaction (AWS / GitHub / OpenAI / Anthropic keys, JWTs, env-style assignments, high-entropy tokens).
3. It uploads to the backend with your `gh auth token` as identity. TLS is verified against the OS trust store so uploads work on networks behind a TLS-intercepting proxy.
4. The backend stores the transcript blob (main + per-subagent), runs a second redaction pass, and returns the trace URL.
5. The plugin posts that URL as a comment on the PR the first time; subsequent updates refresh the same trace.
6. Visiting the URL loads the SPA and renders the JSONL as a trace viewer (hero + collapsible tool cards + prompt rail + activity timeline + light/dark theme + syntax-highlighted code/diffs).
7. Private-repo traces are gated: the backend checks the signed-in viewer's GitHub access to the repo (via their OAuth token) before serving the trace. Viewers grant private access with an opt-in "Enable private repositories" login.
8. Web upload (`/upload`) and standalone (no-repo) traces are also supported — those uploads use a session cookie rather than a `gh` bearer token.

Other platforms (Cursor, …) can plug in by mirroring [plugins/cli/](plugins/cli/) — see [plugins/README.md](plugins/README.md).

## Repo layout

```
vibeshub/
├── plugins/
│   ├── cli/            # Claude Code + Codex CLI: PostToolUse hook + /share-trace slash command;
│   │                   # bundles the vibeshub_client library (redaction, upload, gh-comment)
│   └── README.md       # how to add a new platform plugin
├── webapp/
│   ├── backend/        # FastAPI + SQLAlchemy + Alembic; serves SPA from frontend_dist/
│   │                   # GitHub OAuth, session cookies, repo-access gating, blob storage
│   └── frontend/       # React + Vite SPA; build copies dist/ → backend/frontend_dist/
│                       # Landing, /home, /upload, /privacy, /:owner, /:owner/:repo,
│                       # /:owner/:repo/pull/:number, /t/:shortId trace viewer
├── deploy/azure/       # Dockerfile + deploy.sh + Portal/CLI walkthroughs
└── docs/superpowers/   # design spec + implementation plans
```

Per-component docs:
- [webapp/backend/README.md](webapp/backend/README.md) — env vars, OAuth setup, local run, tests
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
