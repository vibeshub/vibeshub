# vibeshub

Host Claude Code conversation traces and link them to the pull requests they produced. When you run `gh pr create` inside Claude Code, the vibeshub plugin uploads the session's transcript and posts a comment on the PR linking to a public viewer page.

## How it works

1. The Claude Code plugin's `PostToolUse` hook fires after any `Bash` invocation that contains `gh pr create`.
2. The hook locates the session's `~/.claude/projects/.../*.jsonl` transcript and runs client-side redaction (AWS / GitHub / OpenAI / Anthropic keys, JWTs, env-style assignments, high-entropy tokens).
3. It uploads to the backend with your `gh auth token` as identity.
4. The backend stores the transcript blob, runs a second redaction pass, and returns a public URL.
5. The plugin posts that URL as a comment on the PR.
6. Visiting the URL loads the SPA, which fetches the raw JSONL from the backend and renders it as a single-page trace viewer (hero + collapsible tool cards + activity timeline + light/dark theme).

Other platforms (Cursor, Codex, …) can plug in by mirroring [plugins/claude-code/](plugins/claude-code/) — see [plugins/README.md](plugins/README.md).

## Repo layout

```
vibeshub/
├── plugins/
│   ├── claude-code/    # PostToolUse hook + /share-pr slash command;
│   │                   # bundles the vibeshub_client library (redaction, upload, gh-comment)
│   └── README.md       # how to add a new platform plugin
├── webapp/
│   ├── backend/        # FastAPI + SQLAlchemy + alembic; serves SPA from frontend_dist/
│   └── frontend/       # React + Vite SPA; build copies dist/ → backend/frontend_dist/
└── docs/superpowers/   # design spec + implementation plans
```

Per-component docs:
- [webapp/backend/README.md](webapp/backend/README.md) — env vars, local run, tests
- [webapp/frontend/README.md](webapp/frontend/README.md) — dev server, build, tests
- [plugins/claude-code/README.md](plugins/claude-code/README.md) — install, hook config, slash command

## Local development

```bash
# Backend (FastAPI on :8000) — in-memory SQLite, /tmp blob dir
./env/bin/pip install -e "webapp/backend[dev]"
./env/bin/uvicorn app.main:app --reload --app-dir webapp/backend

# Frontend (Vite on :5173) — proxies /api → backend:8000
cd webapp/frontend && npm install && npm run dev
```

## Deploying

- **Azure** — Container Apps + Postgres Flexible Server + Blob Storage with managed identity: see [deploy/azure/README.md](deploy/azure/README.md).
