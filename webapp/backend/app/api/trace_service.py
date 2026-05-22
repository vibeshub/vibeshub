"""Shared trace-creation service.

`create_or_update_trace` is the single place that writes trace blobs and
performs the session-id upsert. Both ingest paths — `/api/ingest` (CLI tar
uploads) and the future `/api/uploads` (web multipart uploads) — call it so
the storage layout, the redaction-count bookkeeping, and the upsert rule
stay identical across paths.

Upsert rule: a re-upload carrying the same `session_id` refreshes that
session's existing trace (stable short_id / URL) instead of inserting a new
row. For a repo-associated upload the match is scoped to
`(repo_full_name, pr_number, session_id)`; for a standalone upload (repo and
PR both None) the match is `session_id` alone among the uploader's own
standalone, non-deleted traces. A null `session_id` always creates a fresh
trace. A soft-deleted trace (`deleted_at` set) is never resurrected.

This is a best-effort select-then-update — there is no unique constraint —
but `session_id` is unique per Claude Code session and its upload hook is
synchronous, so concurrent same-session uploads do not occur in practice.
"""
from __future__ import annotations

import json
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.message_count import count_messages
from app.redact.bundle import UnpackedBundle
from app.short_id import generate
from app.storage.blob import BlobStore
from app.storage.models import Trace


@dataclass
class TraceWriteResult:
    trace: Trace
    created: bool


async def _find_existing(
    session: AsyncSession,
    *,
    owner_login: str,
    repo_full_name: str | None,
    pr_number: int | None,
    session_id: str | None,
) -> Trace | None:
    """Return the trace this upload should refresh, or None to create one."""
    if not session_id:
        return None
    stmt = select(Trace).where(
        Trace.session_id == session_id,
        Trace.deleted_at.is_(None),
    )
    if repo_full_name is not None and pr_number is not None:
        # Repo-associated: scope the match to this exact PR (today's rule).
        stmt = stmt.where(
            Trace.repo_full_name == repo_full_name,
            Trace.pr_number == pr_number,
        )
    else:
        # Standalone: match this uploader's own standalone traces only.
        stmt = stmt.where(
            Trace.owner_login == owner_login,
            Trace.repo_full_name.is_(None),
        )
    stmt = stmt.order_by(Trace.created_at.desc())
    return (await session.execute(stmt)).scalars().first()


async def create_or_update_trace(
    *,
    session: AsyncSession,
    blob_store: BlobStore,
    unpacked: UnpackedBundle,
    owner_login: str,
    platform: str,
    plugin_version: str | None,
    session_id: str | None,
    redaction_count_client: int,
    repo_full_name: str | None,
    pr_number: int | None,
    pr_url: str | None,
    pr_title: str | None,
    is_private: bool,
) -> TraceWriteResult:
    """Write the bundle's blobs and create or refresh the matching Trace row.

    The caller owns the transaction — this function adds/mutates the row and
    writes blobs but does NOT commit.
    """
    existing = await _find_existing(
        session,
        owner_login=owner_login,
        repo_full_name=repo_full_name,
        pr_number=pr_number,
        session_id=session_id,
    )

    created = existing is None
    sid = existing.short_id if existing is not None else generate()
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
    byte_size = len(unpacked.main_bytes) + sum(
        len(a.jsonl_bytes) for a in unpacked.agents
    )

    if existing is not None:
        trace = existing
        trace.repo_full_name = repo_full_name
        trace.pr_number = pr_number
        trace.pr_url = pr_url
        trace.pr_title = pr_title
        trace.platform = platform
        trace.plugin_version = plugin_version
        trace.byte_size = byte_size
        trace.message_count = message_count_main
        trace.redaction_count_client = redaction_count_client
        trace.redaction_count_server = unpacked.total_redactions
        trace.is_private = is_private
        trace.blob_path = None
        trace.blob_prefix = blob_prefix
        trace.agents = agent_summaries
        trace.agent_count = len(agent_summaries)
    else:
        trace = Trace(
            short_id=sid,
            owner_login=owner_login,
            repo_full_name=repo_full_name,
            pr_number=pr_number,
            pr_url=pr_url,
            pr_title=pr_title,
            platform=platform,
            plugin_version=plugin_version,
            session_id=session_id,
            byte_size=byte_size,
            message_count=message_count_main,
            redaction_count_client=redaction_count_client,
            redaction_count_server=unpacked.total_redactions,
            is_private=is_private,
            blob_path=None,
            blob_prefix=blob_prefix,
            agents=agent_summaries,
            agent_count=len(agent_summaries),
        )
        session.add(trace)

    return TraceWriteResult(trace=trace, created=created)
