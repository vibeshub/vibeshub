import pytest
import respx
from sqlalchemy import select

from app.storage.models import Trace
from tests._auth_helpers import authed_cookies


API = "https://api.github.test"


async def _seed_standalone_trace(client, *, owner_login: str) -> str:
    """Insert a standalone trace owned by owner_login; return its short_id."""
    from app.short_id import generate
    SessionLocal = client.app.state.session_maker
    sid = generate()
    async with SessionLocal() as session:
        session.add(Trace(
            short_id=sid,
            owner_login=owner_login,
            repo_full_name=None,
            pr_number=None,
            pr_url=None,
            pr_title=None,
            platform="web",
            plugin_version=None,
            session_id=None,
            byte_size=10,
            message_count=1,
            is_private=False,
            blob_path=None,
            blob_prefix=f"traces/{sid}/",
            agents=[],
            agent_count=0,
        ))
        await session.commit()
    return sid


@pytest.mark.asyncio
async def test_patch_requires_auth(client):
    sid = await _seed_standalone_trace(client, owner_login="alice")
    r = client.patch(f"/api/traces/{sid}", json={"is_private": True})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_patch_404_when_missing(client):
    cookies, _ = await authed_cookies(client, login="alice")
    r = client.patch("/api/traces/zzzzzzzzzz", json={"is_private": True},
                      cookies=cookies)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_patch_403_for_non_owner(client):
    sid = await _seed_standalone_trace(client, owner_login="alice")
    cookies, _ = await authed_cookies(client, login="bob", github_id=200)
    r = client.patch(f"/api/traces/{sid}", json={"is_private": True},
                      cookies=cookies)
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_patch_toggles_privacy_on_standalone(client):
    sid = await _seed_standalone_trace(client, owner_login="alice")
    cookies, _ = await authed_cookies(client, login="alice")
    r = client.patch(f"/api/traces/{sid}", json={"is_private": True},
                      cookies=cookies)
    assert r.status_code == 200
    assert r.json()["is_private"] is True

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == sid)
        )).scalar_one()
    assert trace.is_private is True


@pytest.mark.asyncio
async def test_patch_links_repo_and_syncs_privacy(
    client, respx_mock: respx.MockRouter,
):
    sid = await _seed_standalone_trace(client, owner_login="alice")
    cookies, _ = await authed_cookies(
        client, login="alice", access_token="gho_alice"
    )
    respx_mock.get(
        f"{API}/repos/alice/repo/collaborators/alice/permission"
    ).respond(200, json={"permission": "write"})
    respx_mock.get(f"{API}/repos/alice/repo").respond(
        200, json={"full_name": "alice/repo", "private": True}
    )
    # is_private in the body is ignored once a repo is linked.
    r = client.patch(
        f"/api/traces/{sid}",
        json={"repo_full_name": "alice/repo", "is_private": False},
        cookies=cookies,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["repo_full_name"] == "alice/repo"
    assert body["is_private"] is True


@pytest.mark.asyncio
async def test_patch_rejects_repo_for_non_collaborator(
    client, respx_mock: respx.MockRouter,
):
    sid = await _seed_standalone_trace(client, owner_login="alice")
    cookies, _ = await authed_cookies(
        client, login="alice", access_token="gho_alice"
    )
    respx_mock.get(
        f"{API}/repos/other/repo/collaborators/alice/permission"
    ).respond(200, json={"permission": "none"})
    r = client.patch(
        f"/api/traces/{sid}",
        json={"repo_full_name": "other/repo"},
        cookies=cookies,
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_patch_clears_association_to_standalone(
    client, respx_mock: respx.MockRouter,
):
    sid = await _seed_standalone_trace(client, owner_login="alice")
    cookies, _ = await authed_cookies(
        client, login="alice", access_token="gho_alice"
    )
    # First link a repo.
    respx_mock.get(
        f"{API}/repos/alice/repo/collaborators/alice/permission"
    ).respond(200, json={"permission": "write"})
    respx_mock.get(f"{API}/repos/alice/repo").respond(
        200, json={"full_name": "alice/repo", "private": False}
    )
    client.patch(f"/api/traces/{sid}",
                 json={"repo_full_name": "alice/repo"}, cookies=cookies)
    # Now clear it.
    r = client.patch(f"/api/traces/{sid}",
                     json={"repo_full_name": None}, cookies=cookies)
    assert r.status_code == 200
    assert r.json()["repo_full_name"] is None

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == sid)
        )).scalar_one()
    assert trace.repo_full_name is None
    assert trace.pr_number is None


@pytest.mark.asyncio
async def test_patch_sets_title(client):
    sid = await _seed_standalone_trace(client, owner_login="alice")
    cookies, _ = await authed_cookies(client, login="alice")
    r = client.patch(f"/api/traces/{sid}", json={"title": "  My session  "},
                     cookies=cookies)
    assert r.status_code == 200
    assert r.json()["title"] == "My session"

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == sid)
        )).scalar_one()
    assert trace.title == "My session"


@pytest.mark.asyncio
async def test_patch_empty_title_resets_to_null(client):
    sid = await _seed_standalone_trace(client, owner_login="alice")
    cookies, _ = await authed_cookies(client, login="alice")
    client.patch(f"/api/traces/{sid}", json={"title": "Something"},
                 cookies=cookies)
    r = client.patch(f"/api/traces/{sid}", json={"title": "   "},
                     cookies=cookies)
    assert r.status_code == 200
    assert r.json()["title"] is None

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == sid)
        )).scalar_one()
    assert trace.title is None


@pytest.mark.asyncio
async def test_patch_title_too_long_rejected(client):
    sid = await _seed_standalone_trace(client, owner_login="alice")
    cookies, _ = await authed_cookies(client, login="alice")
    r = client.patch(f"/api/traces/{sid}", json={"title": "x" * 201},
                     cookies=cookies)
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_patch_title_non_owner_forbidden(client):
    sid = await _seed_standalone_trace(client, owner_login="alice")
    cookies, _ = await authed_cookies(client, login="bob", github_id=200)
    r = client.patch(f"/api/traces/{sid}", json={"title": "hijack"},
                     cookies=cookies)
    assert r.status_code == 403
