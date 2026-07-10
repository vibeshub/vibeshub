# vibeshub backend

FastAPI service that ingests Claude Code transcripts, hosts GitHub OAuth sign-in,
and serves the SPA viewer.

Requires Python 3.12–3.13.

## Local dev

From repo root:

```bash
./env/bin/pip install -e "webapp/backend[dev]"
cd webapp/backend
../../env/bin/uvicorn app.main:app --reload
```

By default the server uses an in-memory SQLite DB and a temp blob dir, both of
which reset on restart. Set `VIBESHUB_DATABASE_URL=postgresql+psycopg://...`
and `VIBESHUB_BLOB_DIR=/path/to/dir` for persistent local dev.

To use Azure Blob Storage instead of a local directory, install the `[azure]`
extra and set `VIBESHUB_AZURE_BLOB_CONTAINER` plus either
`VIBESHUB_AZURE_STORAGE_ACCOUNT_URL` (managed identity, recommended for prod)
or `VIBESHUB_AZURE_STORAGE_CONNECTION_STRING` (local/dev with Azurite).

GitHub sign-in is optional locally: until `VIBESHUB_GITHUB_OAUTH_CLIENT_ID`,
`VIBESHUB_SESSION_SECRET`, and `VIBESHUB_TOKEN_ENCRYPTION_KEY` are set, the
auth routes return `503 oauth_not_configured` and the app boots normally
without them. To exercise sign-in locally, register a GitHub OAuth app with
callback `http://127.0.0.1:8000/api/auth/github/callback` and set
`VIBESHUB_COOKIE_SECURE=false`.

## Tests

```bash
cd webapp/backend
../../env/bin/pytest -v
```

## API surface (selected)

| Route | Purpose |
|---|---|
| `POST /api/ingest` | Plugin upload (bearer = `gh auth token`); ships tar bundle of main + subagent JSONL |
| `POST /api/uploads` | Web upload (session cookie); multipart form with transcript + optional subagents zip |
| `GET /api/traces/{short_id}` | Trace metadata (gated for private traces) |
| `GET /api/traces/{short_id}/raw` | Main JSONL blob |
| `GET /api/traces/{short_id}/agents/{agent_id}` | Per-subagent JSONL blob |
| `GET /api/traces/{owner}/{repo}/pull/{number}` | Traces attached to a PR |
| `GET /api/users/{login}` | Profile page payload (traces + repo breakdown + stats) |
| `GET /api/repos/{owner}/{repo}` | Repo page payload (traces + contributors + stats) |
| `PATCH /api/traces/{short_id}` | Edit privacy / PR / repo association (owner only) |
| `DELETE /api/traces/{short_id}` | Soft-delete a trace (owner only; bearer or cookie) |
| `GET /api/auth/me` | Current user, or 204 |
| `GET /api/auth/github/login` | Start OAuth (pass `?scope=private` to request `repo`) |
| `GET /api/auth/github/callback` | OAuth callback; sets `vibeshub_session` cookie |
| `POST /api/auth/logout` | Clear session |
| `GET /api/github/my-repos` | Repo picker for the upload form |
| `GET /api/github/users/...` / `repos/...` | Public GitHub stats used on profile + repo pages |
| `GET /api/health` | Liveness |

## Storage layout

Traces are written under `blob_prefix` (currently `traces/<short_id>/`):

- `<prefix>main.jsonl` — primary transcript
- `<prefix>agents/<agent_id>.jsonl` — one per subagent
- `<prefix>agents/<agent_id>.meta.json` — subagent metadata

Old single-file traces (`blob_path`) are still served; the v2 layout is the
default for new uploads.

## Environment variables

### Core

| Var | Default | Notes |
|---|---|---|
| `VIBESHUB_DATABASE_URL` | `sqlite+aiosqlite:///:memory:` | Use Postgres in production (`postgresql+psycopg://…`) |
| `VIBESHUB_BLOB_DIR` | `/tmp/vibeshub-blobs` | Local-disk blob root; ignored if `VIBESHUB_AZURE_BLOB_CONTAINER` is set |
| `VIBESHUB_AZURE_BLOB_CONTAINER` | _(unset)_ | Azure container name; presence switches blob storage to Azure |
| `VIBESHUB_AZURE_STORAGE_ACCOUNT_URL` | _(unset)_ | e.g. `https://<acct>.blob.core.windows.net`; auths via `DefaultAzureCredential` |
| `VIBESHUB_AZURE_STORAGE_CONNECTION_STRING` | _(unset)_ | Fallback auth (account key or Azurite); ignored if account URL is set |
| `VIBESHUB_GITHUB_API_BASE` | `https://api.github.com` | Override for tests |
| `VIBESHUB_MAX_TRACE_BYTES` | `52428800` (50 MB) | Cap on transcript size |
| `VIBESHUB_PUBLIC_BASE_URL` | `https://vibeshub.ai` | Used in `trace_url` responses |

### OAuth & sessions

Auth routes return 503 until these are populated. The full reference (with
generation commands for the secrets) is in
[../../deploy/azure/.env.example](../../deploy/azure/.env.example).

| Var | Default | Notes |
|---|---|---|
| `VIBESHUB_GITHUB_OAUTH_CLIENT_ID` | _(empty)_ | GitHub OAuth app client ID |
| `VIBESHUB_GITHUB_OAUTH_CLIENT_SECRET` | _(empty)_ | GitHub OAuth app client secret |
| `VIBESHUB_GITHUB_FALLBACK_TOKEN` | _(empty)_ | Server-side PAT used to read public GitHub data for anonymous viewers |
| `VIBESHUB_SESSION_SECRET` | _(empty)_ | Signs the short-lived OAuth `state` cookie |
| `VIBESHUB_TOKEN_ENCRYPTION_KEY` | _(empty)_ | Fernet key used to encrypt stored OAuth access tokens (comma-separate `new,old` to rotate) |
| `VIBESHUB_COOKIE_SECURE` | `true` | Set `false` only for local HTTP dev |

### Trace digest (optional)

All three must be set for the summary agent to run. Missing any → upload still
succeeds; the viewer hides the DigestPanel. Full flow, degradation modes, and
ops queries: [app/agents/digest/README.md](app/agents/digest/README.md).

| Var | Default | Notes |
|---|---|---|
| `VIBESHUB_OPENAI_API_KEY` | _(unset)_ | OpenAI (or compatible) API key |
| `VIBESHUB_OPENAI_ENDPOINT` | _(unset)_ | API base URL |
| `VIBESHUB_OPENAI_MODEL` | _(unset)_ | Model / deployment name |
