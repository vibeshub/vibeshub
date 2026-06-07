from __future__ import annotations

import hashlib
import secrets

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import IngestResponse
from app.api.trace_service import create_or_update_trace, resolve_association
from app.auth.crypto import TokenCipher
from app.auth.github import GitHubClient
from app.auth.sessions import get_current_user
from app.deps import get_blob_store, get_github, get_app_settings, get_session
from app.redact.bundle import BundleError, BundleSizeError, unpack_loose_files
from app.redact.patterns import redact_jsonl
from app.settings import Settings
from app.storage.blob import BlobStore
from app.storage.models import User


router = APIRouter()


def _trace_url(settings: Settings, sid: str) -> str:
    base = settings.public_base_url.rstrip("/")
    return f"{base}/t/{sid}"


@router.post(
    "/api/uploads",
    status_code=status.HTTP_201_CREATED,
    response_model=IngestResponse,
)
async def create_upload(
    transcript: UploadFile = File(...),
    subagents: UploadFile | None = File(default=None),
    source_export: UploadFile | None = File(default=None),
    is_private: bool = Form(default=False),
    pr_url: str | None = Form(default=None),
    repo_full_name: str | None = Form(default=None),
    session: AsyncSession = Depends(get_session),
    blob_store: BlobStore = Depends(get_blob_store),
    github: GitHubClient = Depends(get_github),
    settings: Settings = Depends(get_app_settings),
    user: User | None = Depends(get_current_user),
) -> IngestResponse:
    main_bytes = await transcript.read()
    if len(main_bytes) > settings.max_trace_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"upload exceeds {settings.max_trace_bytes} bytes",
        )
    zip_bytes: bytes | None = None
    if subagents is not None:
        zip_bytes = await subagents.read()
        if len(main_bytes) + len(zip_bytes) > settings.max_trace_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"upload exceeds {settings.max_trace_bytes} bytes",
            )

    # A .txt terminal export is converted to a synthetic .jsonl (the transcript)
    # client-side; the raw export rides along here so we can re-convert later.
    # Redact it with the same patterns before storing — it can contain secrets.
    source_export_bytes: bytes | None = None
    source_format: str | None = None
    if source_export is not None:
        raw = await source_export.read()
        if (
            len(main_bytes) + len(zip_bytes or b"") + len(raw)
            > settings.max_trace_bytes
        ):
            raise HTTPException(
                status_code=413,
                detail=f"upload exceeds {settings.max_trace_bytes} bytes",
            )
        source_export_bytes, _ = redact_jsonl(raw)
        source_format = "terminal"

    try:
        unpacked = unpack_loose_files(
            main_bytes, zip_bytes, max_total_bytes=settings.max_trace_bytes
        )
    except BundleSizeError as e:
        raise HTTPException(status_code=413, detail=str(e))
    except BundleError as e:
        raise HTTPException(status_code=400, detail=str(e))

    owner_login: str | None = user.github_login if user is not None else None
    repo_name: str | None = None
    pr_number: int | None = None
    resolved_pr_url: str | None = None
    pr_title: str | None = None
    claim_token: str | None = None
    claim_token_hash: str | None = None

    if user is None:
        # Anonymous uploads are always standalone public: ignore any pr_url /
        # repo_full_name form fields (no GitHub association) and force is
        # private off. A one-time claim token lets the uploader attach it to
        # their account later; only the sha256 hash is persisted.
        assoc_private = False
        claim_token = secrets.token_urlsafe(32)
        claim_token_hash = hashlib.sha256(
            claim_token.encode()
        ).hexdigest()
    else:
        assoc_private = is_private
        if pr_url or repo_full_name:
            cipher = TokenCipher(settings.token_encryption_key)
            try:
                token = cipher.decrypt(user.encrypted_access_token)
            except Exception:
                raise HTTPException(
                    status_code=403, detail="github_token_unavailable"
                )
            assoc = await resolve_association(
                github=github,
                token=token,
                uploader_login=user.github_login,
                pr_url=pr_url,
                repo_full_name=repo_full_name,
            )
            repo_name = assoc.repo_full_name
            pr_number = assoc.pr_number
            resolved_pr_url = assoc.pr_url
            pr_title = assoc.pr_title
            # Repo-associated: privacy mirrors GitHub, not the form field.
            assoc_private = assoc.is_private

    result = await create_or_update_trace(
        session=session,
        blob_store=blob_store,
        unpacked=unpacked,
        owner_login=owner_login,
        platform="web",
        plugin_version=None,
        session_id=None,
        redaction_count_client=0,
        repo_full_name=repo_name,
        pr_number=pr_number,
        pr_url=resolved_pr_url,
        pr_title=pr_title,
        is_private=assoc_private,
        source_export_bytes=source_export_bytes,
        source_format=source_format,
        claim_token_hash=claim_token_hash,
    )
    await session.commit()

    return IngestResponse(
        trace_id=str(result.trace.id),
        short_id=result.trace.short_id,
        trace_url=_trace_url(settings, result.trace.short_id),
        created=result.created,
        claim_token=claim_token,
        ai_digest=result.trace.digest_json,
    )
