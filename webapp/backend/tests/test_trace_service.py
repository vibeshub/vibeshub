"""Unit tests for app.api.trace_service.create_or_update_trace."""
import pytest
from sqlalchemy import select

from app.api.trace_service import TraceWriteResult, create_or_update_trace
from app.redact.bundle import UnpackedBundle
from app.storage.blob import LocalDirBlobStore
from app.storage.db import create_all, engine_for, session_maker_for
from app.storage.models import Trace


def _bundle() -> UnpackedBundle:
    return UnpackedBundle(
        main_bytes=b'{"type":"user"}\n',
        agents=[],
        total_redactions=0,
    )


async def _fresh_db():
    engine = engine_for("sqlite+aiosqlite:///:memory:")
    await create_all(engine)
    return session_maker_for(engine)


@pytest.mark.asyncio
async def test_create_standalone_trace(tmp_path):
    SessionLocal = await _fresh_db()
    blob_store = LocalDirBlobStore(tmp_path / "blobs")

    async with SessionLocal() as session:
        result = await create_or_update_trace(
            session=session,
            blob_store=blob_store,
            unpacked=_bundle(),
            owner_login="alice",
            platform="claude-code",
            plugin_version="0.2.0",
            session_id=None,
            redaction_count_client=0,
            repo_full_name=None,
            pr_number=None,
            pr_url=None,
            pr_title=None,
            is_private=False,
        )
        await session.commit()

    assert isinstance(result, TraceWriteResult)
    assert result.created is True
    assert result.trace.repo_full_name is None
    assert result.trace.pr_number is None
    assert result.trace.pr_url is None
    assert result.trace.owner_login == "alice"
    assert result.trace.blob_prefix == f"traces/{result.trace.short_id}/"
    # The main blob was written.
    assert await blob_store.get(
        f"traces/{result.trace.short_id}/main.jsonl"
    ) == b'{"type":"user"}\n'
