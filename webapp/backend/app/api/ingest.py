from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.pr_url import parse_pr_url
from app.api.schemas import IngestRequest, IngestResponse
from app.auth.github import GitHubAuthError, GitHubClient
from app.deps import get_blob_store, get_github, get_app_settings, get_session
from app.redact import redact_jsonl
from app.short_id import generate
from app.storage.blob import BlobStore
from app.storage.models import Trace
from app.settings import Settings


router = APIRouter()


def _bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    return authorization.split(None, 1)[1].strip()


def _trace_url(settings: Settings, owner: str, repo: str, n: int, sid: str) -> str:
    base = settings.public_base_url.rstrip("/")
    return f"{base}/{owner}/{repo}/pull/{n}/{sid}"


@router.post("/api/ingest", status_code=status.HTTP_201_CREATED, response_model=IngestResponse)
async def ingest(
    body: IngestRequest,
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    session: AsyncSession = Depends(get_session),
    blob_store: BlobStore = Depends(get_blob_store),
    github: GitHubClient = Depends(get_github),
    settings: Settings = Depends(get_app_settings),
) -> IngestResponse:
    token = _bearer_token(authorization)

    try:
        user = await github.verify_token(token)
    except GitHubAuthError as e:
        raise HTTPException(status_code=401, detail=str(e))

    try:
        parsed = parse_pr_url(body.pr_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    pr = await github.get_pull(token, parsed.owner, parsed.repo, parsed.number)

    if pr.repo_is_private:
        raise HTTPException(
            status_code=403,
            detail="private repos are not supported in v1; traces are public",
        )
    if pr.author_login != user.login:
        raise HTTPException(
            status_code=403,
            detail=f"PR author ({pr.author_login}) does not match uploader ({user.login})",
        )

    raw_bytes = body.transcript_jsonl.encode("utf-8")
    if len(raw_bytes) > settings.max_trace_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"trace exceeds {settings.max_trace_bytes} bytes",
        )

    redacted, report = redact_jsonl(raw_bytes)
    message_count = redacted.count(b"\n")

    sid = generate()
    blob_path = f"traces/{sid}.jsonl"
    await blob_store.put(blob_path, redacted)

    trace = Trace(
        short_id=sid,
        owner_login=user.login,
        repo_full_name=pr.repo_full_name,
        pr_number=pr.number,
        pr_url=pr.html_url,
        pr_title=pr.title,
        platform=body.platform,
        plugin_version=body.plugin_version,
        session_id=body.session_id,
        byte_size=len(redacted),
        message_count=message_count,
        redaction_count_client=body.redaction_count_client,
        redaction_count_server=report.total(),
        blob_path=blob_path,
    )
    session.add(trace)
    await session.commit()

    return IngestResponse(
        trace_id=str(trace.id),
        short_id=sid,
        trace_url=_trace_url(settings, parsed.owner, parsed.repo, parsed.number, sid),
    )
