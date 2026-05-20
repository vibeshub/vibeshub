from __future__ import annotations

import asyncio
import json
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.pr_url import parse_pr_url
from app.api.schemas import IngestResponse
from app.auth.github import GitHubAPIError, GitHubAuthError, GitHubClient
from app.deps import get_blob_store, get_github, get_app_settings, get_session
from app.message_count import count_messages
from app.redact.bundle import BundleError, BundleSizeError, unpack_and_redact
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

    sid = generate()
    blob_prefix = f"traces/{sid}/"
    await blob_store.put(f"{blob_prefix}main.jsonl", unpacked.main_bytes)

    agent_summaries: list[dict] = []
    for agent in unpacked.agents:
        await blob_store.put(
            f"{blob_prefix}agents/{agent.agent_id}.jsonl",
            agent.jsonl_bytes,
        )
        await blob_store.put(
            f"{blob_prefix}agents/{agent.agent_id}.meta.json",
            json.dumps(agent.meta, ensure_ascii=False).encode("utf-8"),
        )
        agent_summaries.append({
            "agent_id": agent.agent_id,
            "tool_use_id": agent.meta.get("toolUseId"),
            "agent_type": agent.meta["agentType"],
            "description": agent.meta["description"],
            "message_count": count_messages(agent.jsonl_bytes),
        })

    message_count_main = count_messages(unpacked.main_bytes)

    trace = Trace(
        short_id=sid,
        owner_login=user.login,
        repo_full_name=pr.repo_full_name,
        pr_number=pr.number,
        pr_url=pr.html_url,
        pr_title=pr.title,
        platform=platform,
        plugin_version=plugin_version,
        session_id=x_vibeshub_session_id,
        byte_size=len(unpacked.main_bytes) + sum(len(a.jsonl_bytes) for a in unpacked.agents),
        message_count=message_count_main,
        redaction_count_client=redaction_count_client,
        redaction_count_server=unpacked.total_redactions,
        blob_path=None,
        blob_prefix=blob_prefix,
        agents=agent_summaries,
        agent_count=len(agent_summaries),
    )
    session.add(trace)
    await session.commit()

    return IngestResponse(
        trace_id=str(trace.id),
        short_id=sid,
        trace_url=_trace_url(settings, parsed.owner, parsed.repo, parsed.number, sid),
    )
