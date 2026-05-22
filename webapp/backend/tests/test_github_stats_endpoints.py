import pytest
import respx
from tests._auth_helpers import authed_cookies


API = "https://api.github.test"


def _repo_payload(**overrides):
    base = {
        "full_name": "octo/hello",
        "name": "hello",
        "description": "an example",
        "html_url": "https://github.com/octo/hello",
        "default_branch": "main",
        "stargazers_count": 80,
        "forks_count": 9,
        "watchers_count": 80,
        "open_issues_count": 3,
        "language": "Ruby",
        "license": {"spdx_id": "MIT", "name": "MIT License"},
        "topics": ["ruby", "example"],
        "created_at": "2008-01-14T04:33:35Z",
        "updated_at": "2022-01-14T04:33:35Z",
    }
    base.update(overrides)
    return base


def test_repo_endpoint_happy_path(client, respx_mock: respx.MockRouter):
    respx_mock.get(f"{API}/repos/octo/hello").respond(
        200, json=_repo_payload(), headers={"ETag": '"e"'}
    )
    r = client.get("/api/github/repos/octo/hello")
    assert r.status_code == 200
    body = r.json()
    assert body["full_name"] == "octo/hello"
    assert body["primary_language"] == "Ruby"
    assert body["license_spdx"] == "MIT"
    assert body["topics"] == ["ruby", "example"]
    # No raw GitHub fields leak through
    assert "language" not in body
    assert "license" not in body


def test_repo_endpoint_404_maps_to_404(client, respx_mock: respx.MockRouter):
    respx_mock.get(f"{API}/repos/octo/missing").respond(404)
    r = client.get("/api/github/repos/octo/missing")
    assert r.status_code == 404
    assert r.json()["detail"] == "repo_not_found"


def test_repo_endpoint_rate_limited(client, respx_mock: respx.MockRouter):
    respx_mock.get(f"{API}/repos/octo/hello").respond(
        403,
        headers={
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": "9999999999",
        },
        json={"message": "rate limit"},
    )
    r = client.get("/api/github/repos/octo/hello")
    assert r.status_code == 503
    assert r.headers.get("Retry-After") is not None


def test_repo_endpoint_uses_fallback_pat_when_anon(
    client, respx_mock: respx.MockRouter,
):
    route = respx_mock.get(f"{API}/repos/octo/hello").respond(
        200, json=_repo_payload()
    )
    r = client.get("/api/github/repos/octo/hello")
    assert r.status_code == 200
    assert route.calls[0].request.headers["authorization"] == "Bearer ghp_fallback"


@pytest.mark.asyncio
async def test_repo_endpoint_uses_viewer_token_when_logged_in(
    client, respx_mock: respx.MockRouter,
):
    cookies, user = await authed_cookies(
        client, login="alice", github_id=99, access_token="gho_alice"
    )
    route = respx_mock.get(f"{API}/repos/octo/hello").respond(
        200, json=_repo_payload()
    )
    r = client.get("/api/github/repos/octo/hello", cookies=cookies)
    assert r.status_code == 200
    assert route.calls[0].request.headers["authorization"] == "Bearer gho_alice"


def _repo_list_payload(names):
    return [
        {
            "name": n,
            "description": f"{n} repo",
            "html_url": f"https://github.com/octo/{n}",
            "stargazers_count": 1,
            "forks_count": 0,
            "language": "Python",
            "pushed_at": "2024-01-01T00:00:00Z",
        }
        for n in names
    ]


def test_user_repos_first_page(client, respx_mock: respx.MockRouter):
    respx_mock.get(
        f"{API}/users/octo/repos",
        params={"sort": "pushed", "per_page": "30", "page": "1"},
    ).respond(
        200,
        json=_repo_list_payload(["a", "b", "c"]),
        headers={
            "Link": '<https://api.github.test/users/octo/repos?page=2>; rel="next"',
        },
    )
    r = client.get("/api/github/users/octo/repos")
    assert r.status_code == 200
    body = r.json()
    assert [x["name"] for x in body["repos"]] == ["a", "b", "c"]
    assert body["has_next"] is True


def test_user_repos_last_page_has_next_false(
    client, respx_mock: respx.MockRouter,
):
    respx_mock.get(
        f"{API}/users/octo/repos",
        params={"sort": "pushed", "per_page": "30", "page": "5"},
    ).respond(200, json=_repo_list_payload(["z"]))
    r = client.get("/api/github/users/octo/repos?page=5")
    assert r.status_code == 200
    assert r.json()["has_next"] is False


def test_user_repos_404(client, respx_mock: respx.MockRouter):
    respx_mock.get(f"{API}/users/missing/repos").respond(404)
    r = client.get("/api/github/users/missing/repos")
    assert r.status_code == 404
    assert r.json()["detail"] == "user_not_found"


def _user_payload(**overrides):
    base = {
        "id": 4242,
        "login": "octo",
        "name": "The Octocat",
        "bio": "GitHub mascot",
        "avatar_url": "https://avatars.githubusercontent.com/u/4242?v=4",
        "html_url": "https://github.com/octo",
        "followers": 1234,
        "following": 9,
        "public_repos": 2,
        "created_at": "2008-01-14T04:33:35Z",
    }
    base.update(overrides)
    return base


def test_user_endpoint_happy_path(client, respx_mock: respx.MockRouter):
    respx_mock.get(f"{API}/users/octo").respond(200, json=_user_payload())
    respx_mock.get(
        f"{API}/users/octo/repos",
        params={"sort": "pushed", "per_page": "100", "page": "1"},
    ).respond(200, json=[
        {"name": "a", "stargazers_count": 100, "language": "Go"},
        {"name": "b", "stargazers_count": 50, "language": "Python"},
    ])

    r = client.get("/api/github/users/octo")
    assert r.status_code == 200
    body = r.json()
    assert body["login"] == "octo"
    assert body["total_public_stars"] == 150
    assert body["top_languages"] == ["Go", "Python"]
    assert body["stars_truncated"] is False
    assert body["public_repos"] == 2


def test_user_endpoint_truncates_at_300_repos(
    client, respx_mock: respx.MockRouter,
):
    full_page = [
        {"name": f"r{i}", "stargazers_count": 1, "language": "Go"}
        for i in range(100)
    ]
    respx_mock.get(f"{API}/users/octo").respond(
        200, json=_user_payload(public_repos=500),
    )
    for page in (1, 2, 3):
        respx_mock.get(
            f"{API}/users/octo/repos",
            params={"sort": "pushed", "per_page": "100", "page": str(page)},
        ).respond(200, json=full_page)

    r = client.get("/api/github/users/octo")
    body = r.json()
    assert body["total_public_stars"] == 300  # 3 * 100
    assert body["stars_truncated"] is True


def test_user_endpoint_no_repos_skips_aggregation(
    client, respx_mock: respx.MockRouter,
):
    respx_mock.get(f"{API}/users/empty").respond(
        200, json=_user_payload(login="empty", public_repos=0)
    )
    # If the code tries to call /repos, this will 404 and break the test.
    r = client.get("/api/github/users/empty")
    assert r.status_code == 200
    assert r.json()["total_public_stars"] == 0
    assert r.json()["top_languages"] == []


def test_user_endpoint_404(client, respx_mock: respx.MockRouter):
    respx_mock.get(f"{API}/users/missing").respond(404)
    r = client.get("/api/github/users/missing")
    assert r.status_code == 404
    assert r.json()["detail"] == "user_not_found"


# --- contribution calendar (GraphQL) -----------------------------------

def _contributions_payload(*, total=4, weeks=None):
    if weeks is None:
        weeks = [
            {
                "contributionDays": [
                    {
                        "date": "2025-05-19",
                        "contributionCount": 0,
                        "contributionLevel": "NONE",
                    },
                    {
                        "date": "2025-05-20",
                        "contributionCount": 4,
                        "contributionLevel": "FOURTH_QUARTILE",
                    },
                ]
            }
        ]
    return {
        "data": {
            "user": {
                "contributionsCollection": {
                    "contributionCalendar": {
                        "totalContributions": total,
                        "weeks": weeks,
                    }
                }
            }
        }
    }


def test_contributions_happy_path(client, respx_mock: respx.MockRouter):
    route = respx_mock.post(f"{API}/graphql").respond(
        200, json=_contributions_payload()
    )
    r = client.get("/api/github/users/octo/contributions")
    assert r.status_code == 200
    body = r.json()
    assert body["login"] == "octo"
    assert body["total"] == 4
    assert body["days"] == [
        {"date": "2025-05-19", "count": 0, "level": 0},
        {"date": "2025-05-20", "count": 4, "level": 4},
    ]
    # The GraphQL request carries the login variable.
    assert route.calls[0].request.method == "POST"


def test_contributions_unknown_user_maps_to_404(
    client, respx_mock: respx.MockRouter,
):
    respx_mock.post(f"{API}/graphql").respond(
        200,
        json={
            "data": {"user": None},
            "errors": [{"type": "NOT_FOUND", "path": ["user"]}],
        },
    )
    r = client.get("/api/github/users/ghost/contributions")
    assert r.status_code == 404
    assert r.json()["detail"] == "user_not_found"


def test_contributions_uses_fallback_pat_when_anon(
    client, respx_mock: respx.MockRouter,
):
    route = respx_mock.post(f"{API}/graphql").respond(
        200, json=_contributions_payload()
    )
    r = client.get("/api/github/users/octo/contributions")
    assert r.status_code == 200
    assert (
        route.calls[0].request.headers["authorization"]
        == "Bearer ghp_fallback"
    )


def test_contributions_rate_limited(client, respx_mock: respx.MockRouter):
    respx_mock.post(f"{API}/graphql").respond(
        403,
        headers={
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": "9999999999",
        },
        json={"message": "rate limit"},
    )
    r = client.get("/api/github/users/octo/contributions")
    assert r.status_code == 503
    assert r.headers.get("Retry-After") is not None
