import pytest
import respx

from tests._auth_helpers import authed_cookies


API = "https://api.github.test"


@pytest.mark.asyncio
async def test_my_repos_requires_auth(client):
    r = client.get("/api/github/my-repos")
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_my_repos_lists_user_repos(
    client, respx_mock: respx.MockRouter,
):
    cookies, _ = await authed_cookies(
        client, login="alice", access_token="gho_alice"
    )
    respx_mock.get(f"{API}/user/repos").respond(
        200,
        json=[
            {"full_name": "alice/repo-a", "name": "repo-a",
             "private": False},
            {"full_name": "org/repo-b", "name": "repo-b",
             "private": True},
        ],
    )
    r = client.get("/api/github/my-repos", cookies=cookies)
    assert r.status_code == 200
    repos = r.json()["repos"]
    assert {x["full_name"] for x in repos} == {
        "alice/repo-a", "org/repo-b",
    }
    assert repos[0].keys() == {"full_name", "name", "private"}


@pytest.mark.asyncio
async def test_my_repos_filters_by_query(
    client, respx_mock: respx.MockRouter,
):
    cookies, _ = await authed_cookies(
        client, login="alice", access_token="gho_alice"
    )
    respx_mock.get(f"{API}/user/repos").respond(
        200,
        json=[
            {"full_name": "alice/alpha", "name": "alpha",
             "private": False},
            {"full_name": "alice/beta", "name": "beta",
             "private": False},
        ],
    )
    r = client.get("/api/github/my-repos?q=alph", cookies=cookies)
    assert r.status_code == 200
    assert [x["name"] for x in r.json()["repos"]] == ["alpha"]


@pytest.mark.asyncio
async def test_repo_prs_requires_auth(client):
    r = client.get("/api/github/repo-prs?repo=alice/repo")
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_repo_prs_lists_authored_prs(
    client, respx_mock: respx.MockRouter,
):
    cookies, _ = await authed_cookies(
        client, login="alice", access_token="gho_alice"
    )
    respx_mock.get(f"{API}/repos/alice/repo/pulls").respond(
        200,
        json=[
            {"number": 7, "title": "Mine",
             "html_url": "https://github.com/alice/repo/pull/7",
             "user": {"login": "alice"}},
            {"number": 8, "title": "Theirs",
             "html_url": "https://github.com/alice/repo/pull/8",
             "user": {"login": "bob"}},
        ],
    )
    r = client.get("/api/github/repo-prs?repo=alice/repo", cookies=cookies)
    assert r.status_code == 200
    prs = r.json()["prs"]
    assert [p["number"] for p in prs] == [7]
    assert prs[0].keys() == {"number", "title", "html_url"}


@pytest.mark.asyncio
async def test_repo_prs_404_for_missing_repo(
    client, respx_mock: respx.MockRouter,
):
    cookies, _ = await authed_cookies(
        client, login="alice", access_token="gho_alice"
    )
    respx_mock.get(f"{API}/repos/alice/missing/pulls").respond(404)
    r = client.get(
        "/api/github/repo-prs?repo=alice/missing", cookies=cookies
    )
    assert r.status_code == 404
