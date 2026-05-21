import pytest
from sqlalchemy import select

from tests.test_traces import make_bundle, _ingest_headers


def _user_resp(respx_mock):
    respx_mock.get("https://api.github.test/user").respond(
        200, json={"login": "alice", "id": 7}
    )


def _pull_resp(respx_mock, *, private: bool):
    respx_mock.get(
        "https://api.github.test/repos/alice/repo/pulls/3"
    ).respond(
        200,
        json={
            "number": 3,
            "title": "Hello",
            "user": {"login": "alice"},
            "html_url": "https://github.com/alice/repo/pull/3",
            "head": {"repo": {"private": private, "full_name": "alice/repo"}},
            "base": {"repo": {"private": private, "full_name": "alice/repo"}},
        },
    )


def _ingest(client, respx_mock, *, private: bool) -> str:
    _user_resp(respx_mock)
    _pull_resp(respx_mock, private=private)
    body = make_bundle({"main.jsonl": b'{"type":"user"}\n'})
    resp = client.post(
        "/api/ingest",
        content=body,
        headers=_ingest_headers("https://github.com/alice/repo/pull/3"),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["short_id"]


@pytest.mark.asyncio
async def test_ingest_private_repo_succeeds_and_flags_trace(client, respx_mock):
    from app.storage.models import Trace

    short_id = _ingest(client, respx_mock, private=True)

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == short_id)
        )).scalar_one()
        assert trace.is_private is True


@pytest.mark.asyncio
async def test_ingest_public_repo_is_not_private(client, respx_mock):
    from app.storage.models import Trace

    short_id = _ingest(client, respx_mock, private=False)

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == short_id)
        )).scalar_one()
        assert trace.is_private is False
