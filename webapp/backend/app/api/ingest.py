from __future__ import annotations

import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.pr_url import parse_pr_url
from app.api.schemas import IngestResponse
from app.api.trace_service import create_or_update_trace
from app.auth.github import GitHubAPIError, GitHubAuthError, GitHubClient
from app.deps import get_blob_store, get_github, get_app_settings, get_session
from app.redact.bundle import BundleError, BundleSizeError, unpack_and_redact
from app.storage.blob import BlobStore
from app.settings import Settings


router = APIRouter()


def _bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    return authorization.split(None, 1)[1].strip()


def _trace_url(settings: Settings, owner: str, repo: str, n: int, sid: str) -> str:
    base = settings.public_base_url.rstrip("/")
    return f"{base}/{owner}/{repo}/pull/{n}/{sid}"


def _require_header(value: str | None, name: str) -> str:
    if not value:
        raise HTTPException(status_code=400, detail=f"missing required header: {name}")
    return value


@router.post("/api/ingest", status_code=status.HTTP_201_CREATED, response_model=IngestResponse)
async def ingest(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    x_vibeshub_pr_url: Annotated[str | None, Header()] = None,
    x_vibeshub_platform: Annotated[str | None, Header()] = None,
    x_vibeshub_plugin_version: Annotated[str | None, Header()] = None,
    x_vibeshub_session_id: Annotated[str | None, Header()] = None,
    x_vibeshub_client_redactions: Annotated[str | None, Header()] = None,
    session: AsyncSession = Depends(get_session),
    blob_store: BlobStore = Depends(get_blob_store),
    github: GitHubClient = Depends(get_github),
    settings: Settings = Depends(get_app_settings),
) -> IngestResponse:
    token = _bearer_token(authorization)
    pr_url = _require_header(x_vibeshub_pr_url, "X-Vibeshub-Pr-Url")
    platform = _require_header(x_vibeshub_platform, "X-Vibeshub-Platform")
    plugin_version = _require_header(x_vibeshub_plugin_version, "X-Vibeshub-Plugin-Version")
    try:
        redaction_count_client = int(x_vibeshub_client_redactions or "0")
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid X-Vibeshub-Client-Redactions")

    try:
        parsed = parse_pr_url(pr_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Fire both GitHub calls concurrently — they're independent and
    # together account for most of the request's wall-clock time.
    user_result, pull_result = await asyncio.gather(
        github.verify_token(token),
        github.get_pull(token, parsed.owner, parsed.repo, parsed.number),
        return_exceptions=True,
    )

    if isinstance(user_result, GitHubAuthError):
        raise HTTPException(status_code=401, detail=str(user_result))
    if isinstance(pull_result, GitHubAPIError):
        msg = str(pull_result)
        if "not found" in msg.lower():
            raise HTTPException(status_code=404, detail=f"PR not found: {pr_url}")
        raise HTTPException(status_code=502, detail=f"github upstream error: {msg}")
    if isinstance(user_result, BaseException):
        raise user_result
    if isinstance(pull_result, BaseException):
        raise pull_result

    user = user_result
    pr = pull_result

    if pr.author_login != user.login:
        raise HTTPException(
            status_code=403,
            detail=f"PR author ({pr.author_login}) does not match uploader ({user.login})",
        )

    tar_bytes = await request.body()
    if len(tar_bytes) > settings.max_trace_bytes:
        # Cheap pre-check on compressed size. Final cap on decompressed bytes
        # is enforced inside unpack_and_redact.
        raise HTTPException(
            status_code=413,
            detail=f"upload exceeds {settings.max_trace_bytes} compressed bytes",
        )

    try:
        unpacked = unpack_and_redact(tar_bytes, max_total_bytes=settings.max_trace_bytes)
    except BundleSizeError as e:
        raise HTTPException(status_code=413, detail=str(e))
    except BundleError as e:
        raise HTTPException(status_code=400, detail=str(e))

    result = await create_or_update_trace(
        session=session,
        blob_store=blob_store,
        unpacked=unpacked,
        owner_login=user.login,
        platform=platform,
        plugin_version=plugin_version,
        session_id=x_vibeshub_session_id,
        redaction_count_client=redaction_count_client,
        repo_full_name=pr.repo_full_name,
        pr_number=pr.number,
        pr_url=pr.html_url,
        pr_title=pr.title,
        is_private=pr.repo_is_private,
    )
    await session.commit()
    trace = result.trace
    created = result.created

    return IngestResponse(
        trace_id=str(trace.id),
        short_id=trace.short_id,
        trace_url=_trace_url(
            settings, parsed.owner, parsed.repo, parsed.number, trace.short_id
        ),
        created=created,
    )
