"""Unit tests for app.api.trace_service.create_or_update_trace."""
import pytest
from sqlalchemy import select

from app.api.trace_service import TraceWriteResult, create_or_update_trace
from app.redact.bundle import AgentPiece, UnpackedBundle
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


@pytest.mark.asyncio
async def test_create_repo_associated_trace_with_agent(tmp_path):
    SessionLocal = await _fresh_db()
    blob_store = LocalDirBlobStore(tmp_path / "blobs")
    aid = "a0123456789abcdef"
    bundle = UnpackedBundle(
        main_bytes=b'{"type":"user"}\n',
        agents=[AgentPiece(
            agent_id=aid,
            jsonl_bytes=b'{"type":"assistant"}\n',
            meta={
                "agentType": "Explore",
                "description": "d",
                "toolUseId": "toolu_01x",
            },
        )],
        total_redactions=3,
    )

    async with SessionLocal() as session:
        result = await create_or_update_trace(
            session=session,
            blob_store=blob_store,
            unpacked=bundle,
            owner_login="alice",
            platform="claude-code",
            plugin_version="0.2.0",
            session_id=None,
            redaction_count_client=2,
            repo_full_name="alice/repo",
            pr_number=7,
            pr_url="https://github.com/alice/repo/pull/7",
            pr_title="Add a feature",
            is_private=True,
        )
        await session.commit()
        sid = result.trace.short_id

    assert result.created is True
    assert result.trace.repo_full_name == "alice/repo"
    assert result.trace.pr_number == 7
    assert result.trace.is_private is True
    assert result.trace.redaction_count_server == 3
    assert result.trace.agent_count == 1
    assert result.trace.agents == [{
        "agent_id": aid,
        "tool_use_id": "toolu_01x",
        "agent_type": "Explore",
        "description": "d",
        "message_count": 0,
    }]
    assert await blob_store.get(f"traces/{sid}/agents/{aid}.jsonl") == (
        b'{"type":"assistant"}\n'
    )


@pytest.mark.asyncio
async def test_repo_upsert_refreshes_same_session(tmp_path):
    SessionLocal = await _fresh_db()
    blob_store = LocalDirBlobStore(tmp_path / "blobs")

    async def _write(main: bytes):
        async with SessionLocal() as session:
            result = await create_or_update_trace(
                session=session,
                blob_store=blob_store,
                unpacked=UnpackedBundle(
                    main_bytes=main, agents=[], total_redactions=0
                ),
                owner_login="alice",
                platform="claude-code",
                plugin_version="0.2.0",
                session_id="sess-R",
                redaction_count_client=0,
                repo_full_name="alice/repo",
                pr_number=1,
                pr_url="https://github.com/alice/repo/pull/1",
                pr_title="t",
                is_private=False,
            )
            await session.commit()
            return result

    first = await _write(b'{"type":"user"}\n')
    second = await _write(b'{"type":"user"}\n{"type":"assistant"}\n')

    assert first.created is True
    assert second.created is False
    assert second.trace.short_id == first.trace.short_id

    async with SessionLocal() as session:
        rows = (await session.execute(
            select(Trace).where(Trace.session_id == "sess-R")
        )).scalars().all()
    assert len(rows) == 1
    assert rows[0].byte_size > len(b'{"type":"user"}\n')


@pytest.mark.asyncio
async def test_standalone_upsert_keys_on_session_id_alone(tmp_path):
    SessionLocal = await _fresh_db()
    blob_store = LocalDirBlobStore(tmp_path / "blobs")

    async def _write_standalone():
        async with SessionLocal() as session:
            result = await create_or_update_trace(
                session=session,
                blob_store=blob_store,
                unpacked=UnpackedBundle(
                    main_bytes=b'{"type":"user"}\n',
                    agents=[],
                    total_redactions=0,
                ),
                owner_login="alice",
                platform="claude-code",
                plugin_version="0.2.0",
                session_id="sess-S",
                redaction_count_client=0,
                repo_full_name=None,
                pr_number=None,
                pr_url=None,
                pr_title=None,
                is_private=False,
            )
            await session.commit()
            return result

    first = await _write_standalone()
    second = await _write_standalone()

    assert first.created is True
    assert second.created is False
    assert second.trace.short_id == first.trace.short_id

    async with SessionLocal() as session:
        rows = (await session.execute(
            select(Trace).where(Trace.session_id == "sess-S")
        )).scalars().all()
    assert len(rows) == 1
    assert rows[0].repo_full_name is None
