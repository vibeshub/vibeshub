# vibeshub frontend

React + Vite SPA that serves the public trace viewer.

## Local dev

From this directory:

```bash
npm install
npm run dev          # starts at http://127.0.0.1:5173 with /api proxy → backend:8000
```

The dev server proxies `/api/*` to `http://127.0.0.1:8000`, so a backend running at `webapp/backend` is implicitly required.

## Tests

```bash
npm run test         # vitest unit tests
npm run test:e2e     # playwright (boots the dev server)
```

## Deploy build

```bash
npm run build:deploy
```

This runs `vite build`, then copies `dist/` into `webapp/backend/frontend_dist/`. The Azure deploy Dockerfile at [`deploy/azure/Dockerfile`](../../deploy/azure/Dockerfile) picks up the `frontend_dist/` directory, and FastAPI serves it as the SPA.
