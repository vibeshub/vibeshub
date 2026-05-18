import asyncio

import httpx
import pytest
import respx

from app.github.public_client import (
    GitHubAuthError,
    GitHubNotFound,
    GitHubRateLimited,
    GitHubUpstreamError,
    PublicGitHubClient,
)


API = "https://api.github.test"


@pytest.mark.asyncio
async def test_uses_viewer_token_when_present(respx_mock: respx.MockRouter):
    route = respx_mock.get(f"{API}/users/octo").respond(
        200, json={"login": "octo"},
        headers={"ETag": '"e1"'},
    )
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=60)
    await c.get_json("/users/octo", viewer_token="gho_user")
    assert route.calls[0].request.headers["authorization"] == "Bearer gho_user"


@pytest.mark.asyncio
async def test_falls_back_to_pat_when_viewer_token_none(
    respx_mock: respx.MockRouter,
):
    route = respx_mock.get(f"{API}/users/octo").respond(
        200, json={"login": "octo"}
    )
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=60)
    await c.get_json("/users/octo", viewer_token=None)
    assert route.calls[0].request.headers["authorization"] == "Bearer fb"


@pytest.mark.asyncio
async def test_raises_when_no_tokens_configured():
    c = PublicGitHubClient(API, fallback_token="", ttl_seconds=60)
    with pytest.raises(GitHubAuthError):
        await c.get_json("/users/octo", viewer_token=None)


@pytest.mark.asyncio
async def test_cache_hit_within_ttl_skips_network(respx_mock: respx.MockRouter):
    route = respx_mock.get(f"{API}/users/octo").respond(
        200, json={"login": "octo"}, headers={"ETag": '"e1"'}
    )
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=60)
    for _ in range(5):
        body = await c.get_json("/users/octo", viewer_token=None)
        assert body == {"login": "octo"}
    assert route.call_count == 1


@pytest.mark.asyncio
async def test_stale_revalidates_with_etag_returns_304(
    respx_mock: respx.MockRouter,
):
    respx_mock.get(f"{API}/users/octo").mock(side_effect=[
        httpx.Response(200, json={"login": "octo"}, headers={"ETag": '"e1"'}),
        httpx.Response(304),
    ])
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=0)
    body1 = await c.get_json("/users/octo", viewer_token=None)
    body2 = await c.get_json("/users/octo", viewer_token=None)
    assert body1 == body2 == {"login": "octo"}
    second = respx_mock.calls[1].request
    assert second.headers["if-none-match"] == '"e1"'


@pytest.mark.asyncio
async def test_stale_revalidates_with_etag_returns_200(
    respx_mock: respx.MockRouter,
):
    respx_mock.get(f"{API}/users/octo").mock(side_effect=[
        httpx.Response(200, json={"login": "v1"}, headers={"ETag": '"e1"'}),
        httpx.Response(200, json={"login": "v2"}, headers={"ETag": '"e2"'}),
    ])
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=0)
    await c.get_json("/users/octo", viewer_token=None)
    body2 = await c.get_json("/users/octo", viewer_token=None)
    assert body2 == {"login": "v2"}


@pytest.mark.asyncio
async def test_single_flight_under_concurrency(respx_mock: respx.MockRouter):
    started = asyncio.Event()
    proceed = asyncio.Event()

    async def slow_handler(request):
        started.set()
        await proceed.wait()
        return httpx.Response(200, json={"login": "octo"}, headers={"ETag": '"e"'})

    respx_mock.get(f"{API}/users/octo").mock(side_effect=slow_handler)

    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=60)
    tasks = [
        asyncio.create_task(c.get_json("/users/octo", viewer_token=None))
        for _ in range(10)
    ]
    await started.wait()
    proceed.set()
    results = await asyncio.gather(*tasks)
    assert all(r == {"login": "octo"} for r in results)
    assert respx_mock.calls.call_count == 1


@pytest.mark.asyncio
async def test_404_raises_not_found_and_is_not_cached(
    respx_mock: respx.MockRouter,
):
    route = respx_mock.get(f"{API}/users/missing").respond(404)
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=60)
    with pytest.raises(GitHubNotFound):
        await c.get_json("/users/missing", viewer_token=None)
    with pytest.raises(GitHubNotFound):
        await c.get_json("/users/missing", viewer_token=None)
    assert route.call_count == 2


@pytest.mark.asyncio
async def test_401_raises_auth_error_and_is_not_cached(
    respx_mock: respx.MockRouter,
):
    route = respx_mock.get(f"{API}/users/missing").respond(401)
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=60)
    with pytest.raises(GitHubAuthError):
        await c.get_json("/users/missing", viewer_token=None)
    assert route.call_count == 1


@pytest.mark.asyncio
async def test_403_rate_limited_raises_typed_error(respx_mock: respx.MockRouter):
    respx_mock.get(f"{API}/users/x").respond(
        403,
        headers={
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": "1735689600",
        },
        json={"message": "rate limit"},
    )
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=60)
    with pytest.raises(GitHubRateLimited) as ei:
        await c.get_json("/users/x", viewer_token=None)
    assert ei.value.reset_at_epoch == 1735689600


@pytest.mark.asyncio
async def test_403_without_rate_limit_header_is_upstream_error(
    respx_mock: respx.MockRouter,
):
    respx_mock.get(f"{API}/users/x").respond(403, json={"message": "abuse"})
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=60)
    with pytest.raises(GitHubUpstreamError):
        await c.get_json("/users/x", viewer_token=None)


@pytest.mark.asyncio
async def test_5xx_raises_upstream_error_and_is_not_cached(
    respx_mock: respx.MockRouter,
):
    route = respx_mock.get(f"{API}/users/x").respond(503)
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=60)
    with pytest.raises(GitHubUpstreamError):
        await c.get_json("/users/x", viewer_token=None)
    with pytest.raises(GitHubUpstreamError):
        await c.get_json("/users/x", viewer_token=None)
    assert route.call_count == 2


@pytest.mark.asyncio
async def test_lru_eviction_at_cap(respx_mock: respx.MockRouter):
    respx_mock.get(url__regex=rf"{API}/users/.*").respond(
        200, json={"ok": True}, headers={"ETag": '"e"'}
    )
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=60, max_entries=3)
    await c.get_json("/users/a", viewer_token=None)
    await c.get_json("/users/b", viewer_token=None)
    await c.get_json("/users/c", viewer_token=None)
    await c.get_json("/users/d", viewer_token=None)  # evicts /users/a
    assert c.cache_size() == 3
    n_before = respx_mock.calls.call_count
    await c.get_json("/users/a", viewer_token=None)
    assert respx_mock.calls.call_count == n_before + 1


@pytest.mark.asyncio
async def test_returns_link_header_when_requested(respx_mock: respx.MockRouter):
    respx_mock.get(f"{API}/users/x/repos").respond(
        200,
        json=[{"name": "r1"}],
        headers={
            "Link": '<https://api.github.test/users/x/repos?page=2>; rel="next"'
        },
    )
    c = PublicGitHubClient(API, fallback_token="fb", ttl_seconds=60)
    body, link = await c.get_json_with_link(
        "/users/x/repos", viewer_token=None
    )
    assert body == [{"name": "r1"}]
    assert link is not None and "rel=\"next\"" in link
