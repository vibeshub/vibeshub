"""Access control and schema behavior for standalone (no repo/PR) traces."""
import pytest

from app.api.schemas import TraceSummary


def test_trace_summary_accepts_null_repo_and_pr():
    summary = TraceSummary(
        trace_id="t-1",
        short_id="standalone1",
        owner_login="alice",
        repo_full_name=None,
        pr_number=None,
        pr_url=None,
        pr_title=None,
        platform="claude-code",
        byte_size=10,
        message_count=1,
        created_at="2026-05-22T00:00:00+00:00",
        is_private=False,
    )
    dumped = summary.model_dump()
    assert dumped["repo_full_name"] is None
    assert dumped["pr_number"] is None
    assert dumped["pr_url"] is None


from sqlalchemy import select as _select

from tests._auth_helpers import authed_cookies


async def _seed_standalone_trace(
    client, *, owner_login: str, short_id: str, is_private: bool
):
    """Insert a standalone (no repo/PR) trace directly and write its blob."""
    from app.storage.models import Trace

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = Trace(
            short_id=short_id,
            owner_login=owner_login,
            repo_full_name=None,
            pr_number=None,
            pr_url=None,
            pr_title=None,
            platform="claude-code",
            byte_size=10,
            message_count=1,
            is_private=is_private,
            blob_prefix=f"traces/{short_id}/",
            agents=[],
            agent_count=0,
        )
        session.add(trace)
        await session.commit()
    await client.app.state.blob_store.put(
        f"traces/{short_id}/main.jsonl", b'{"type":"user"}\n'
    )


@pytest.mark.asyncio
async def test_public_standalone_trace_visible_to_anonymous(client):
    await _seed_standalone_trace(
        client, owner_login="alice", short_id="pubstandaa",
        is_private=False,
    )
    resp = client.get("/api/traces/pubstandaa")
    assert resp.status_code == 200
    assert resp.json()["repo_full_name"] is None


@pytest.mark.asyncio
async def test_private_standalone_trace_401_for_anonymous(client):
    await _seed_standalone_trace(
        client, owner_login="alice", short_id="privstanda",
        is_private=True,
    )
    resp = client.get("/api/traces/privstanda")
    assert resp.status_code == 401
    assert resp.json()["detail"] == "auth_required"
    assert resp.headers["Cache-Control"] == "no-store"


@pytest.mark.asyncio
async def test_private_standalone_trace_404_for_non_owner(client):
    await _seed_standalone_trace(
        client, owner_login="alice", short_id="privstandb",
        is_private=True,
    )
    cookies, _ = await authed_cookies(
        client, github_id=200, login="bob",
        token_scopes="repo,read:user,user:email",
    )
    resp = client.get("/api/traces/privstandb", cookies=cookies)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "not_found"
    assert resp.headers["Cache-Control"] == "no-store"


@pytest.mark.asyncio
async def test_private_standalone_trace_200_for_owner(client):
    await _seed_standalone_trace(
        client, owner_login="alice", short_id="privstandc",
        is_private=True,
    )
    cookies, _ = await authed_cookies(
        client, github_id=100, login="alice",
        token_scopes="read:user,user:email",
    )
    resp = client.get("/api/traces/privstandc", cookies=cookies)
    assert resp.status_code == 200
    assert resp.json()["is_private"] is True
    assert resp.headers["Cache-Control"] == "private, no-store"


@pytest.mark.asyncio
async def test_private_standalone_raw_gated_for_non_owner(client):
    await _seed_standalone_trace(
        client, owner_login="alice", short_id="privstandd",
        is_private=True,
    )
    anon = client.get("/api/traces/privstandd/raw")
    assert anon.status_code == 401
    cookies, _ = await authed_cookies(
        client, github_id=200, login="bob",
        token_scopes="read:user,user:email",
    )
    resp = client.get("/api/traces/privstandd/raw", cookies=cookies)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_private_standalone_raw_served_for_owner(client):
    await _seed_standalone_trace(
        client, owner_login="alice", short_id="privstande",
        is_private=True,
    )
    cookies, _ = await authed_cookies(
        client, github_id=100, login="alice",
        token_scopes="read:user,user:email",
    )
    resp = client.get("/api/traces/privstande/raw", cookies=cookies)
    assert resp.status_code == 200
    assert resp.headers["Cache-Control"] == "private, no-store"


@pytest.mark.asyncio
async def test_user_overview_hides_private_standalone_from_anonymous(client):
    await _seed_standalone_trace(
        client, owner_login="alice", short_id="ovstandpub",
        is_private=False,
    )
    await _seed_standalone_trace(
        client, owner_login="alice", short_id="ovstandprv",
        is_private=True,
    )
    resp = client.get("/api/users/alice")
    assert resp.status_code == 200
    ids = {t["short_id"] for t in resp.json()["traces"]}
    assert ids == {"ovstandpub"}


@pytest.mark.asyncio
async def test_user_overview_hides_private_standalone_from_non_owner(client):
    await _seed_standalone_trace(
        client, owner_login="alice", short_id="ovstandprv2",
        is_private=True,
    )
    cookies, _ = await authed_cookies(
        client, github_id=200, login="bob",
        token_scopes="repo,read:user,user:email",
    )
    resp = client.get("/api/users/alice", cookies=cookies)
    assert resp.status_code == 200
    assert resp.json()["traces"] == []


@pytest.mark.asyncio
async def test_user_overview_shows_private_standalone_to_owner(client):
    await _seed_standalone_trace(
        client, owner_login="alice", short_id="ovstandprv3",
        is_private=True,
    )
    cookies, _ = await authed_cookies(
        client, github_id=100, login="alice",
        token_scopes="read:user,user:email",
    )
    resp = client.get("/api/users/alice", cookies=cookies)
    assert resp.status_code == 200
    ids = {t["short_id"] for t in resp.json()["traces"]}
    assert ids == {"ovstandprv3"}
