from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import health, ingest as ingest_api
from app.deps import init_state


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_state(app)
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="vibeshub", version="0.1.0", lifespan=lifespan)
    app.include_router(health.router)
    app.include_router(ingest_api.router)
    return app


app = create_app()
