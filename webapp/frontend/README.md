# vibeshub frontend

React 19 + Vite SPA. Serves the trace viewer (public and private, with
private gated on GitHub repo-read access), the marketing/landing page,
user + repo overview pages, GitHub sign-in, and the manual web upload form.

## Routes

| Path | Page |
|---|---|
| `/` | Landing (signed-out) / link to `/home` (signed-in) |
| `/home` | Redirects signed-in users to their profile |
| `/vibeviewer` | Public no-login transcript upload; success card with copy-link + claim-to-profile |
| `/upload` | Redirects to `/vibeviewer` (retired) |
| `/privacy` | Privacy policy |
| `/:owner` | User/org profile (traces + repo breakdown + GitHub stats) |
| `/:owner/:repo` | Repo overview (traces + contributors) |
| `/:owner/:repo/pull/:number` | All traces attached to a PR |
| `/:owner/:repo/pull/:number/:shortId` | Trace viewer (PR context) |
| `/t/:shortId` | Trace viewer (standalone link) |

The viewer (`src/components/trace/`) renders prompt rail, expandable outcome
cards, tool calls (collapsible), nested subagent threads, an activity timeline,
slash-command chips, syntax-highlighted code/diffs, and a light/dark theme
toggle. State that should persist across sessions (e.g. expand-tool-calls,
theme) is stored via `persistedState.ts`.

## Local dev

From this directory:

```bash
npm install
npm run dev          # starts at http://127.0.0.1:5173 with /api proxy → backend:8000
```

The dev server proxies `/api/*` to `http://127.0.0.1:8000`, so a backend running
at `webapp/backend` is implicitly required.

## Tests

```bash
npm run test         # vitest unit tests
npm run test:e2e     # playwright (boots the dev server)
```

## Deploy build

```bash
npm run build:deploy
```

This runs `vite build`, then copies `dist/` into `webapp/backend/frontend_dist/`.
The Azure deploy Dockerfile at [`deploy/azure/Dockerfile`](../../deploy/azure/Dockerfile)
picks up the `frontend_dist/` directory, and FastAPI serves it as the SPA.
