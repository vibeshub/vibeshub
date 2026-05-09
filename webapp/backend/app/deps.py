from __future__ import annotations

from typing import AsyncIterator

from fastapi import Depends, FastAPI, Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.github import GitHubClient
from app.settings import Settings, get_settings
from app.storage.blob import BlobStore, LocalDirBlobStore
from app.storage.db import create_all, engine_for, session_maker_for


async def init_state(app: FastAPI, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    engine = engine_for(settings.database_url)
    # Only auto-bootstrap the schema for in-memory SQLite (tests). Any other
    # backend — including a misconfigured file-based SQLite or Postgres —
    # must be migrated via Alembic.
    if ":memory:" in settings.database_url:
        await create_all(engine)
    app.state.settings = settings
    app.state.db_engine = engine
    app.state.session_maker = session_maker_for(engine)
    app.state.blob_store = LocalDirBlobStore(settings.blob_dir)
    app.state.github = GitHubClient(api_base=settings.github_api_base)


def get_app_settings(request: Request) -> Settings:
    return request.app.state.settings


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    SessionLocal: async_sessionmaker[AsyncSession] = request.app.state.session_maker
    async with SessionLocal() as session:
        yield session


def get_blob_store(request: Request) -> BlobStore:
    return request.app.state.blob_store


def get_github(request: Request) -> GitHubClient:
    return request.app.state.github
