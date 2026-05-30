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
async def test_uploads_anonymous_creates_ownerless_public_trace(client):
    r = client.post(
        "/api/uploads",
        files={"transcript": ("chat.jsonl", b'{"type":"user"}\n')},
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["created"] is True
    assert data["claim_token"]  # non-empty

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == data["short_id"])
        )).scalar_one()
    assert trace.owner_login is None
    assert trace.is_private is False
    assert trace.claim_token_hash is not None

    # Served publicly with owner_login null.
    g = client.get(f"/api/traces/{data['short_id']}")
    assert g.status_code == 200, g.text
    assert g.json()["owner_login"] is None


@pytest.mark.asyncio
async def test_uploads_anonymous_creates_distinct_traces(client):
    r1 = client.post(
        "/api/uploads",
        files={"transcript": ("chat.jsonl", b'{"type":"user"}\n')},
    )
    r2 = client.post(
        "/api/uploads",
        files={"transcript": ("chat.jsonl", b'{"type":"user"}\n')},
    )
    assert r1.status_code == 201 and r2.status_code == 201
    assert r1.json()["short_id"] != r2.json()["short_id"]


@pytest.mark.asyncio
async def test_uploads_anonymous_ignores_repo_association(client):
    # Anonymous upload that also sends pr/repo fields: ignored, still 201,
    # ownerless public standalone — no GitHub call, no 403.
    r = client.post(
        "/api/uploads",
        files={"transcript": ("chat.jsonl", b'{"type":"user"}\n')},
        data={
            "pr_url": "https://github.com/alice/repo/pull/1",
            "repo_full_name": "alice/repo",
            "is_private": "true",
        },
    )
    assert r.status_code == 201, r.text
    short_id = r.json()["short_id"]

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == short_id)
        )).scalar_one()
    assert trace.owner_login is None
    assert trace.repo_full_name is None
    assert trace.pr_number is None
    assert trace.is_private is False


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
    # Signed-in uploads never get a claim token.
    assert data["claim_token"] is None

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == data["short_id"])
        )).scalar_one()
    assert trace.owner_login == "alice"
    assert trace.repo_full_name is None
    assert trace.platform == "web"
    assert trace.is_private is False
    assert trace.claim_token_hash is None


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


async def _anon_upload(client) -> tuple[str, str]:
    """Anonymous upload; return (short_id, claim_token)."""
    r = client.post(
        "/api/uploads",
        files={"transcript": ("chat.jsonl", b'{"type":"user"}\n')},
    )
    assert r.status_code == 201, r.text
    data = r.json()
    return data["short_id"], data["claim_token"]


@pytest.mark.asyncio
async def test_claim_happy_path_then_already_claimed(client):
    short_id, token = await _anon_upload(client)
    cookies, _ = await authed_cookies(client, login="alice")

    r = client.post(
        f"/api/traces/{short_id}/claim",
        json={"claim_token": token},
        cookies=cookies,
    )
    assert r.status_code == 200, r.text
    assert r.json()["owner_login"] == "alice"

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == short_id)
        )).scalar_one()
    assert trace.owner_login == "alice"
    assert trace.claim_token_hash is None

    # A second claim attempt fails — the trace already has an owner.
    r2 = client.post(
        f"/api/traces/{short_id}/claim",
        json={"claim_token": token},
        cookies=cookies,
    )
    assert r2.status_code == 409
    assert r2.json()["detail"] == "already_claimed"


@pytest.mark.asyncio
async def test_claim_wrong_token_is_403(client):
    short_id, _ = await _anon_upload(client)
    cookies, _ = await authed_cookies(client, login="alice")
    r = client.post(
        f"/api/traces/{short_id}/claim",
        json={"claim_token": "wrong-token"},
        cookies=cookies,
    )
    assert r.status_code == 403
    assert r.json()["detail"] == "invalid_claim_token"


@pytest.mark.asyncio
async def test_claim_without_auth_is_401(client):
    short_id, token = await _anon_upload(client)
    r = client.post(
        f"/api/traces/{short_id}/claim",
        json={"claim_token": token},
    )
    assert r.status_code == 401
    assert r.json()["detail"] == "auth_required"


@pytest.mark.asyncio
async def test_claim_missing_trace_is_404(client):
    from app.short_id import generate
    cookies, _ = await authed_cookies(client, login="alice")
    r = client.post(
        f"/api/traces/{generate()}/claim",
        json={"claim_token": "anything"},
        cookies=cookies,
    )
    assert r.status_code == 404
