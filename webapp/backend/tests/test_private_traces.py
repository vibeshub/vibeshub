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


def _ingest_repo(
    client, respx_mock, *, repo: str, pr: int, private: bool
) -> str:
    """Ingest a trace for an arbitrary alice-owned repo / PR number."""
    _user_resp(respx_mock)
    full_name = f"alice/{repo}"
    respx_mock.get(
        f"https://api.github.test/repos/{full_name}/pulls/{pr}"
    ).respond(
        200,
        json={
            "number": pr,
            "title": "Hello",
            "user": {"login": "alice"},
            "html_url": f"https://github.com/{full_name}/pull/{pr}",
            "head": {"repo": {"private": private, "full_name": full_name}},
            "base": {"repo": {"private": private, "full_name": full_name}},
        },
    )
    body = make_bundle({"main.jsonl": b'{"type":"user"}\n'})
    resp = client.post(
        "/api/ingest",
        content=body,
        headers=_ingest_headers(
            f"https://github.com/{full_name}/pull/{pr}"
        ),
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


@pytest.mark.asyncio
async def test_get_trace_summary_includes_is_private_false_for_public(
    client, respx_mock
):
    short_id = _ingest(client, respx_mock, private=False)
    resp = client.get(f"/api/traces/{short_id}")
    assert resp.status_code == 200
    assert resp.json()["is_private"] is False


from tests._auth_helpers import authed_cookies

REPO_URL = "https://api.github.test/repos/alice/repo"


@pytest.mark.asyncio
async def test_private_trace_401_for_anonymous(client, respx_mock):
    short_id = _ingest(client, respx_mock, private=True)
    resp = client.get(f"/api/traces/{short_id}")
    assert resp.status_code == 401
    assert resp.json()["detail"] == "auth_required"
    assert resp.headers["Cache-Control"] == "no-store"


@pytest.mark.asyncio
async def test_private_trace_403_when_token_lacks_repo_scope(
    client, respx_mock
):
    short_id = _ingest(client, respx_mock, private=True)
    cookies, _ = await authed_cookies(
        client, token_scopes="read:user,user:email"
    )
    resp = client.get(f"/api/traces/{short_id}", cookies=cookies)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "private_scope_required"


@pytest.mark.asyncio
async def test_private_trace_404_when_github_denies(client, respx_mock):
    short_id = _ingest(client, respx_mock, private=True)
    cookies, _ = await authed_cookies(
        client, token_scopes="repo,read:user,user:email"
    )
    respx_mock.get(REPO_URL).respond(404, json={})
    resp = client.get(f"/api/traces/{short_id}", cookies=cookies)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_private_trace_200_when_github_allows(client, respx_mock):
    short_id = _ingest(client, respx_mock, private=True)
    cookies, _ = await authed_cookies(
        client, token_scopes="repo,read:user,user:email"
    )
    respx_mock.get(REPO_URL).respond(200, json={"id": 1})
    resp = client.get(f"/api/traces/{short_id}", cookies=cookies)
    assert resp.status_code == 200
    assert resp.json()["is_private"] is True
    assert resp.headers["Cache-Control"] == "private, no-store"


@pytest.mark.asyncio
async def test_private_trace_raw_gated_for_anonymous(client, respx_mock):
    short_id = _ingest(client, respx_mock, private=True)
    resp = client.get(f"/api/traces/{short_id}/raw")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_private_trace_raw_served_when_allowed(client, respx_mock):
    short_id = _ingest(client, respx_mock, private=True)
    cookies, _ = await authed_cookies(
        client, token_scopes="repo,read:user,user:email"
    )
    respx_mock.get(REPO_URL).respond(200, json={"id": 1})
    resp = client.get(f"/api/traces/{short_id}/raw", cookies=cookies)
    assert resp.status_code == 200
    assert resp.headers["Cache-Control"] == "private, no-store"


@pytest.mark.asyncio
async def test_pr_list_hides_private_from_anonymous(client, respx_mock):
    _ingest(client, respx_mock, private=True)
    resp = client.get("/api/traces/alice/repo/pull/3")
    assert resp.status_code == 200
    assert resp.json()["traces"] == []


@pytest.mark.asyncio
async def test_pr_list_shows_private_to_authorized_viewer(
    client, respx_mock
):
    _ingest(client, respx_mock, private=True)
    cookies, _ = await authed_cookies(
        client, token_scopes="repo,read:user,user:email"
    )
    respx_mock.get(REPO_URL).respond(200, json={"id": 1})
    resp = client.get("/api/traces/alice/repo/pull/3", cookies=cookies)
    assert resp.status_code == 200
    assert len(resp.json()["traces"]) == 1


@pytest.mark.asyncio
async def test_repo_overview_hides_private_from_anonymous(
    client, respx_mock
):
    _ingest(client, respx_mock, private=True)
    resp = client.get("/api/repos/alice/repo")
    assert resp.status_code == 200
    assert resp.json()["traces"] == []
    assert resp.json()["stats"]["trace_count"] == 0


@pytest.mark.asyncio
async def test_user_overview_hides_private_from_anonymous(
    client, respx_mock
):
    _ingest(client, respx_mock, private=True)
    resp = client.get("/api/users/alice")
    assert resp.status_code == 200
    assert resp.json()["traces"] == []
    assert resp.json()["repos"] == []


@pytest.mark.asyncio
async def test_user_overview_mixed_public_private_for_anonymous(
    client, respx_mock
):
    public_id = _ingest_repo(
        client, respx_mock, repo="public-repo", pr=1, private=False
    )
    _ingest_repo(
        client, respx_mock, repo="private-repo", pr=2, private=True
    )

    resp = client.get("/api/users/alice")
    assert resp.status_code == 200
    body = resp.json()

    # Only the public trace is visible to an anonymous viewer.
    trace_ids = {t["short_id"] for t in body["traces"]}
    assert trace_ids == {public_id}

    # The private repo is absent from the repo breakdown.
    repo_names = {r["repo_full_name"] for r in body["repos"]}
    assert repo_names == {"alice/public-repo"}

    # Stats reflect only the visible public subset.
    assert body["stats"]["trace_count"] == 1
    assert body["stats"]["repo_count"] == 1
