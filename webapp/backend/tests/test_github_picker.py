import httpx
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


@pytest.mark.asyncio
async def test_my_repos_cache_is_per_user(
    client, respx_mock: respx.MockRouter,
):
    """Two users hitting the same path within the cache TTL must each get
    their own GitHub data; the cache must be keyed on the viewer token."""
    alice, _ = await authed_cookies(
        client, login="alice", access_token="gho_alice"
    )
    bob, _ = await authed_cookies(
        client, github_id=101, login="bob", access_token="gho_bob"
    )

    def by_token(request):
        auth = request.headers.get("Authorization", "")
        who = "alice" if auth.endswith("gho_alice") else "bob"
        return httpx.Response(200, json=[
            {"full_name": f"{who}/secret", "name": "secret",
             "private": True},
        ])

    respx_mock.get(f"{API}/user/repos").mock(side_effect=by_token)

    r = client.get("/api/github/my-repos", cookies=alice)
    assert r.status_code == 200
    assert [x["full_name"] for x in r.json()["repos"]] == ["alice/secret"]

    r = client.get("/api/github/my-repos", cookies=bob)
    assert r.status_code == 200
    assert [x["full_name"] for x in r.json()["repos"]] == ["bob/secret"]
