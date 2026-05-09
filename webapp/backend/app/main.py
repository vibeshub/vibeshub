from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.api import health, ingest as ingest_api, traces as traces_api, render as render_api
from app.deps import init_state


_PLACEHOLDER_HTML = """<!doctype html>
<html><head><title>vibeshub</title></head>
<body>
<h1>vibeshub</h1>
<p>Frontend build not present. Run <code>npm run build</code> in
<code>webapp/frontend</code> to populate <code>dist/</code>, then redeploy.</p>
</body></html>"""


# Test override hook — set via monkeypatch in tests to point at a known dir.
_frontend_dist_override: Path | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_state(app)
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="vibeshub", version="0.1.0", lifespan=lifespan)
    app.include_router(health.router)
    app.include_router(ingest_api.router)
    app.include_router(traces_api.router)
    app.include_router(render_api.router)

    frontend_dist = _frontend_dist_override or (
        Path(__file__).resolve().parent.parent / "frontend_dist"
    )
    if (frontend_dist / "index.html").is_file():
        app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="spa")
    else:
        @app.get("/", response_class=HTMLResponse)
        async def _root() -> str:
            return _PLACEHOLDER_HTML

    return app


app = create_app()
