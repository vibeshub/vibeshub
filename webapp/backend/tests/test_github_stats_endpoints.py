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
