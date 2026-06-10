"""Unit tests for app.api.trace_service.create_or_update_trace."""
import json

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


def _kwargs(**overrides):
    base = dict(
        owner_login="alice", platform="claude-code", plugin_version="0.2.0",
        session_id=None, redaction_count_client=0, repo_full_name=None,
        pr_number=None, pr_url=None, pr_title=None, is_private=False,
    )
    base.update(overrides)
    return base


CODEX_MAIN = (
    b'{"type":"session_meta","payload":{"id":"019e7ed1","cwd":"/x"}}\n'
    b'{"type":"event_msg","payload":{"type":"user_message",'
    b'"message":"Add a greet function"}}\n'
    b'{"type":"response_item","payload":{"type":"message","role":"assistant",'
    b'"content":[{"type":"output_text","text":"on it"}]}}\n'
)

CURSOR_MAIN = (
    b'{"role":"user","message":{"content":[{"type":"text",'
    b'"text":"<user_query>do a sweep</user_query>"}]}}\n'
    b'{"role":"assistant","message":{"content":[{"type":"text",'
    b'"text":"on it"}]}}\n'
)


@pytest.mark.asyncio
async def test_codex_upload_stores_converted_copy_and_source_format(tmp_path):
    SessionLocal = await _fresh_db()
    blob_store = LocalDirBlobStore(tmp_path / "blobs")
    bundle = UnpackedBundle(
        main_bytes=CODEX_MAIN, agents=[], total_redactions=0,
    )

    async with SessionLocal() as session:
        result = await create_or_update_trace(
            session=session, blob_store=blob_store, unpacked=bundle,
            **_kwargs(platform="codex"),
        )
        await session.commit()

    prefix = f"traces/{result.trace.short_id}/"
    assert result.trace.source_format == "codex"
    # The raw original is stored untouched.
    assert await blob_store.get(f"{prefix}main.jsonl") == CODEX_MAIN
    converted = await blob_store.get(f"{prefix}converted.jsonl")
    assert json.loads(converted.splitlines()[0])["type"] == "codex-meta"


@pytest.mark.asyncio
async def test_cursor_upload_stores_converted_copy_and_source_format(tmp_path):
    SessionLocal = await _fresh_db()
    blob_store = LocalDirBlobStore(tmp_path / "blobs")
    bundle = UnpackedBundle(
        main_bytes=CURSOR_MAIN, agents=[], total_redactions=0,
    )

    async with SessionLocal() as session:
        result = await create_or_update_trace(
            session=session, blob_store=blob_store, unpacked=bundle,
            **_kwargs(platform="cursor"),
        )
        await session.commit()

    prefix = f"traces/{result.trace.short_id}/"
    assert result.trace.source_format == "cursor"
    converted = await blob_store.get(f"{prefix}converted.jsonl")
    assert json.loads(converted.splitlines()[0])["type"] == "cursor-meta"


@pytest.mark.asyncio
async def test_claude_upload_gets_no_converted_copy(tmp_path):
    SessionLocal = await _fresh_db()
    blob_store = LocalDirBlobStore(tmp_path / "blobs")

    async with SessionLocal() as session:
        result = await create_or_update_trace(
            session=session, blob_store=blob_store, unpacked=_bundle(),
            **_kwargs(),
        )
        await session.commit()

    prefix = f"traces/{result.trace.short_id}/"
    assert result.trace.source_format is None
    with pytest.raises(FileNotFoundError):
        await blob_store.get(f"{prefix}converted.jsonl")


@pytest.mark.asyncio
async def test_terminal_source_format_is_not_overwritten(tmp_path):
    # Terminal uploads arrive already converted to Claude-shaped jsonl;
    # the sniff must not clobber the caller-provided source_format.
    SessionLocal = await _fresh_db()
    blob_store = LocalDirBlobStore(tmp_path / "blobs")

    async with SessionLocal() as session:
        result = await create_or_update_trace(
            session=session, blob_store=blob_store, unpacked=_bundle(),
            source_format="terminal", **_kwargs(platform="web"),
        )
        await session.commit()

    prefix = f"traces/{result.trace.short_id}/"
    assert result.trace.source_format == "terminal"
    with pytest.raises(FileNotFoundError):
        await blob_store.get(f"{prefix}converted.jsonl")


@pytest.mark.asyncio
async def test_codex_subagent_gets_converted_copy(tmp_path):
    SessionLocal = await _fresh_db()
    blob_store = LocalDirBlobStore(tmp_path / "blobs")
    aid = "019e7f09-bca2-7150-ac2b-54f7b075a2ea"
    bundle = UnpackedBundle(
        main_bytes=CODEX_MAIN,
        agents=[AgentPiece(
            agent_id=aid,
            jsonl_bytes=(
                b'{"type":"session_meta","payload":{"id":"019e7f09"}}\n'
            ),
            meta={
                "agentType": "default", "description": "d",
                "toolUseId": "call_spawn",
            },
        )],
        total_redactions=0,
    )

    async with SessionLocal() as session:
        result = await create_or_update_trace(
            session=session, blob_store=blob_store, unpacked=bundle,
            **_kwargs(platform="codex"),
        )
        await session.commit()

    prefix = f"traces/{result.trace.short_id}/"
    converted = await blob_store.get(
        f"{prefix}agents/{aid}.converted.jsonl"
    )
    assert json.loads(converted.splitlines()[0])["type"] == "codex-meta"


@pytest.mark.asyncio
async def test_digest_receives_converted_bytes(tmp_path, monkeypatch):
    captured = {}

    async def fake_digest(session, trace, *, blob, subagent_blobs):
        captured["blob"] = blob
        captured["subagent_blobs"] = subagent_blobs
        return None

    monkeypatch.setattr("app.agents.digest.compute_digest", fake_digest)

    SessionLocal = await _fresh_db()
    blob_store = LocalDirBlobStore(tmp_path / "blobs")
    aid = "019e7f09-bca2-7150-ac2b-54f7b075a2ea"
    bundle = UnpackedBundle(
        main_bytes=CODEX_MAIN,
        agents=[AgentPiece(
            agent_id=aid,
            jsonl_bytes=(
                b'{"type":"session_meta","payload":{"id":"019e7f09"}}\n'
            ),
            meta={
                "agentType": "default", "description": "d",
                "toolUseId": "call_spawn",
            },
        )],
        total_redactions=0,
    )

    async with SessionLocal() as session:
        await create_or_update_trace(
            session=session, blob_store=blob_store, unpacked=bundle,
            **_kwargs(platform="codex"),
        )
        await session.commit()

    main = captured["blob"]
    assert json.loads(main.splitlines()[0])["type"] == "codex-meta"
    child = captured["subagent_blobs"]["call_spawn"]
    assert json.loads(child.splitlines()[0])["type"] == "codex-meta"


# --- resolve_association tests ---
import respx
from fastapi import HTTPException

from app.api.trace_service import resolve_association, ResolvedAssociation
from app.auth.github import GitHubClient


API = "https://api.github.test"


@pytest.mark.asyncio
async def test_resolve_standalone_when_no_pr_or_repo():
    gh = GitHubClient(api_base=API)
    result = await resolve_association(
        github=gh, token="ghp_x", uploader_login="alice",
        pr_url=None, repo_full_name=None,
    )
    assert result == ResolvedAssociation(
        repo_full_name=None, pr_number=None, pr_url=None,
        pr_title=None, is_private=False,
    )


@pytest.mark.asyncio
async def test_resolve_pr_path(respx_mock: respx.MockRouter):
    respx_mock.get(f"{API}/repos/alice/repo/pulls/3").respond(
        200,
        json={
            "number": 3, "title": "Hello", "user": {"login": "alice"},
            "html_url": "https://github.com/alice/repo/pull/3",
            "head": {"repo": {"private": True, "full_name": "alice/repo"}},
            "base": {"repo": {"private": True, "full_name": "alice/repo"}},
        },
    )
    gh = GitHubClient(api_base=API)
    result = await resolve_association(
        github=gh, token="ghp_x", uploader_login="alice",
        pr_url="https://github.com/alice/repo/pull/3", repo_full_name=None,
    )
    assert result.repo_full_name == "alice/repo"
    assert result.pr_number == 3
    assert result.pr_title == "Hello"
    assert result.is_private is True


@pytest.mark.asyncio
async def test_resolve_pr_rejects_author_mismatch(
    respx_mock: respx.MockRouter,
):
    respx_mock.get(f"{API}/repos/alice/repo/pulls/3").respond(
        200,
        json={
            "number": 3, "title": "Hello", "user": {"login": "bob"},
            "html_url": "https://github.com/alice/repo/pull/3",
            "head": {"repo": {"private": False, "full_name": "alice/repo"}},
            "base": {"repo": {"private": False, "full_name": "alice/repo"}},
        },
    )
    gh = GitHubClient(api_base=API)
    with pytest.raises(HTTPException) as exc:
        await resolve_association(
            github=gh, token="ghp_x", uploader_login="alice",
            pr_url="https://github.com/alice/repo/pull/3",
            repo_full_name=None,
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_resolve_repo_only_collaborator(respx_mock: respx.MockRouter):
    respx_mock.get(
        f"{API}/repos/alice/repo/collaborators/alice/permission"
    ).respond(200, json={"permission": "write"})
    respx_mock.get(f"{API}/repos/alice/repo").respond(
        200, json={"full_name": "alice/repo", "private": True}
    )
    gh = GitHubClient(api_base=API)
    result = await resolve_association(
        github=gh, token="ghp_x", uploader_login="alice",
        pr_url=None, repo_full_name="alice/repo",
    )
    assert result.repo_full_name == "alice/repo"
    assert result.pr_number is None
    assert result.is_private is True


@pytest.mark.asyncio
async def test_resolve_repo_only_rejects_non_collaborator(
    respx_mock: respx.MockRouter,
):
    respx_mock.get(
        f"{API}/repos/alice/repo/collaborators/bob/permission"
    ).respond(200, json={"permission": "none"})
    gh = GitHubClient(api_base=API)
    with pytest.raises(HTTPException) as exc:
        await resolve_association(
            github=gh, token="ghp_x", uploader_login="bob",
            pr_url=None, repo_full_name="alice/repo",
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_resolve_repo_only_rejects_bad_repo_string():
    gh = GitHubClient(api_base=API)
    with pytest.raises(HTTPException) as exc:
        await resolve_association(
            github=gh, token="ghp_x", uploader_login="bob",
            pr_url=None, repo_full_name="not-a-repo",
        )
    assert exc.value.status_code == 400
