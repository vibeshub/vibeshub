from __future__ import annotations

from typing import AsyncIterator

from fastapi import Depends, FastAPI, Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.github import GitHubClient
from app.auth.oauth import build_oauth
from app.github.public_client import PublicGitHubClient
from app.github.repo_access import RepoAccessChecker
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
    app.state.repo_access = RepoAccessChecker(
        settings.github_api_base,
        ttl_seconds=60,
    )
    _validate_auth_config(settings)
    await smoke_check(settings, engine, app.state.blob_store)


def _validate_auth_config(settings: Settings) -> None:
    """Fail fast in prod-like environments when auth secrets are unset.

    With `cookie_secure=False` (local dev), we allow missing secrets so
    contributors can run the app without OAuth set up; auth routes still
    return 503 oauth_not_configured at request time. With cookie_secure=True
    (any HTTPS deployment), we refuse to boot — better to fail the revision
    than serve traffic with a publicly-known fallback session-signing key.
    """
    import logging
    log = logging.getLogger(__name__)
    missing = []
    if not settings.session_secret:
        missing.append("VIBESHUB_SESSION_SECRET")
    if not settings.token_encryption_key:
        missing.append("VIBESHUB_TOKEN_ENCRYPTION_KEY")
    if not missing:
        return
    if settings.cookie_secure:
        raise RuntimeError(
            f"Missing required auth secrets in production: {', '.join(missing)}"
        )
    log.warning(
        "auth secrets unset (cookie_secure=False, assumed dev): %s",
        ", ".join(missing),
    )


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


def get_repo_access(request: Request) -> RepoAccessChecker:
    return request.app.state.repo_access
