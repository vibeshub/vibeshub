import io
import json
import zipfile

import pytest
import respx
from sqlalchemy import select

from app.storage.models import Trace
from tests._auth_helpers import authed_cookies


API = "https://api.github.test"


def _make_zip(members: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w") as zf:
        for name, data in members.items():
            zf.writestr(name, data)
    return buf.getvalue()


@pytest.mark.asyncio
async def test_uploads_requires_auth(client):
    r = client.post(
        "/api/uploads",
        files={"transcript": ("chat.jsonl", b'{"type":"user"}\n')},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_uploads_standalone_happy_path(client):
    cookies, user = await authed_cookies(client, login="alice")
    r = client.post(
        "/api/uploads",
        files={"transcript": ("chat.jsonl", b'{"type":"user"}\n')},
        cookies=cookies,
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["created"] is True
    assert data["trace_url"].endswith(f"/t/{data['short_id']}")

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == data["short_id"])
        )).scalar_one()
    assert trace.owner_login == "alice"
    assert trace.repo_full_name is None
    assert trace.platform == "web"
    assert trace.is_private is False


@pytest.mark.asyncio
async def test_uploads_missing_transcript_is_422(client):
    cookies, _ = await authed_cookies(client, login="alice")
    r = client.post("/api/uploads", data={"is_private": "false"},
                     cookies=cookies)
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_uploads_too_big_is_413(client):
    cookies, _ = await authed_cookies(client, login="alice")
    client.app.state.settings.max_trace_bytes = 100
    r = client.post(
        "/api/uploads",
        files={"transcript": ("chat.jsonl", b"x" * 5000)},
        cookies=cookies,
    )
    assert r.status_code == 413


@pytest.mark.asyncio
async def test_uploads_malformed_zip_is_400(client):
    cookies, _ = await authed_cookies(client, login="alice")
    r = client.post(
        "/api/uploads",
        files={
            "transcript": ("chat.jsonl", b'{"type":"user"}\n'),
            "subagents": ("subs.zip", b"not a zip"),
        },
        cookies=cookies,
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_uploads_with_subagent_zip(client):
    cookies, _ = await authed_cookies(client, login="alice")
    aid = "a0123456789abcdef"
    meta = json.dumps({
        "agentType": "Explore", "description": "d", "toolUseId": "t1",
    }).encode()
    zip_bytes = _make_zip({
        f"agents/{aid}.jsonl": b'{"type":"assistant"}\n',
        f"agents/{aid}.meta.json": meta,
    })
    r = client.post(
        "/api/uploads",
        files={
            "transcript": ("chat.jsonl", b'{"type":"user"}\n'),
            "subagents": ("subs.zip", zip_bytes),
        },
        cookies=cookies,
    )
    assert r.status_code == 201, r.text
    short_id = r.json()["short_id"]

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == short_id)
        )).scalar_one()
    assert trace.agent_count == 1


@pytest.mark.asyncio
async def test_uploads_with_repo_link_for_collaborator(
    client, respx_mock: respx.MockRouter,
):
    cookies, _ = await authed_cookies(
        client, login="alice", access_token="gho_alice"
    )
    respx_mock.get(
        f"{API}/repos/alice/repo/collaborators/alice/permission"
    ).respond(200, json={"permission": "admin"})
    respx_mock.get(f"{API}/repos/alice/repo").respond(
        200, json={"full_name": "alice/repo", "private": True}
    )
    r = client.post(
        "/api/uploads",
        files={"transcript": ("chat.jsonl", b'{"type":"user"}\n')},
        data={"repo_full_name": "alice/repo", "is_private": "false"},
        cookies=cookies,
    )
    assert r.status_code == 201, r.text
    short_id = r.json()["short_id"]

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == short_id)
        )).scalar_one()
    assert trace.repo_full_name == "alice/repo"
    # Repo-associated: is_private mirrors GitHub (private), not the form.
    assert trace.is_private is True


@pytest.mark.asyncio
async def test_uploads_repo_link_rejects_non_collaborator(
    client, respx_mock: respx.MockRouter,
):
    cookies, _ = await authed_cookies(
        client, login="bob", access_token="gho_bob"
    )
    respx_mock.get(
        f"{API}/repos/alice/repo/collaborators/bob/permission"
    ).respond(200, json={"permission": "none"})
    r = client.post(
        "/api/uploads",
        files={"transcript": ("chat.jsonl", b'{"type":"user"}\n')},
        data={"repo_full_name": "alice/repo"},
        cookies=cookies,
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_uploads_stores_redacted_source_export(client):
    cookies, _ = await authed_cookies(client, login="alice")
    raw = b"banner\n\xe2\x9d\xaf do a thing with sk-ant-" + b"A" * 30 + b"\n"
    r = client.post(
        "/api/uploads",
        files={
            "transcript": (
                "chat.jsonl",
                b'{"type":"terminal-meta"}\n'
                b'{"type":"user","message":{"content":"hi"}}\n',
            ),
            "source_export": ("chat.txt", raw),
        },
        cookies=cookies,
    )
    assert r.status_code == 201, r.text
    short_id = r.json()["short_id"]

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == short_id)
        )).scalar_one()
    assert trace.source_format == "terminal"

    blob_dir = client.app.state.settings.blob_dir
    stored = (blob_dir / "traces" / short_id / "source_export.txt").read_bytes()
    assert b"sk-ant-" not in stored
    assert b"[REDACTED:anthropic_key]" in stored


@pytest.mark.asyncio
async def test_uploads_without_source_export_has_null_format(client):
    cookies, _ = await authed_cookies(client, login="alice")
    r = client.post(
        "/api/uploads",
        files={"transcript": ("chat.jsonl", b'{"type":"user"}\n')},
        cookies=cookies,
    )
    assert r.status_code == 201, r.text
    short_id = r.json()["short_id"]
    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == short_id)
        )).scalar_one()
    assert trace.source_format is None
