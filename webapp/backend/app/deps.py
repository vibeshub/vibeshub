from __future__ import annotations

from typing import AsyncIterator

from fastapi import Depends, FastAPI, Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.github import GitHubClient
from app.auth.oauth import build_oauth
from app.github.public_client import PublicGitHubClient
from app.settings import Settings, get_settings
from app.smoke_check import smoke_check
from app.storage.blob import BlobStore, LocalDirBlobStore, make_azure_blob_store
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
    if settings.azure_blob_container:
        app.state.blob_store = make_azure_blob_store(settings)
    else:
        app.state.blob_store = LocalDirBlobStore(settings.blob_dir)
    app.state.github = GitHubClient(api_base=settings.github_api_base)
    app.state.oauth = build_oauth(settings)
    app.state.public_github = PublicGitHubClient(
        settings.github_api_base,
        fallback_token=settings.github_fallback_token,
        ttl_seconds=60,
    )
    await smoke_check(settings, engine, app.state.blob_store)


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


def get_public_github(request: Request) -> PublicGitHubClient:
    return request.app.state.public_github
