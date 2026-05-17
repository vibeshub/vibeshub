# vibeshub backend

FastAPI service that ingests Claude Code transcripts and serves the public viewer.

## Local dev

From repo root:

```bash
./env/bin/pip install -e "webapp/backend[dev]"
cd webapp/backend
../../env/bin/uvicorn app.main:app --reload
```

By default, the server uses an in-memory SQLite DB and a temp blob dir, both of which reset on restart. Set `VIBESHUB_DATABASE_URL=postgresql+psycopg://...` and `VIBESHUB_BLOB_DIR=/path/to/dir` for persistent local dev.

To use Azure Blob Storage instead of a local directory, install the `[azure]` extra and set `VIBESHUB_AZURE_BLOB_CONTAINER` plus either `VIBESHUB_AZURE_STORAGE_ACCOUNT_URL` (managed identity, recommended for prod) or `VIBESHUB_AZURE_STORAGE_CONNECTION_STRING` (local/dev with Azurite).

## Tests

```bash
cd webapp/backend
../../env/bin/pytest -v
```

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `VIBESHUB_DATABASE_URL` | `sqlite+aiosqlite:///:memory:` | Use Postgres in production |
| `VIBESHUB_BLOB_DIR` | `/tmp/vibeshub-blobs` | Local-disk blob root; ignored if `VIBESHUB_AZURE_BLOB_CONTAINER` is set |
| `VIBESHUB_AZURE_BLOB_CONTAINER` | _(unset)_ | Azure container name; presence switches blob storage to Azure |
| `VIBESHUB_AZURE_STORAGE_ACCOUNT_URL` | _(unset)_ | e.g. `https://<acct>.blob.core.windows.net`; auths via `DefaultAzureCredential` |
| `VIBESHUB_AZURE_STORAGE_CONNECTION_STRING` | _(unset)_ | Fallback auth (account key or Azurite); ignored if account URL is set |
| `VIBESHUB_GITHUB_API_BASE` | `https://api.github.com` | Override for tests |
| `VIBESHUB_MAX_TRACE_BYTES` | `52428800` (50 MB) | Cap on transcript size |
| `VIBESHUB_PUBLIC_BASE_URL` | `https://vibeshub.ai` | Used in `trace_url` responses |
