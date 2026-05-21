import uuid

import pytest

from app.github.repo_access import RepoAccessChecker, RepoAccessError

API = "https://api.github.test"


@pytest.mark.asyncio
async def test_can_read_returns_true_on_200(respx_mock):
    respx_mock.get(f"{API}/repos/alice/repo").respond(200, json={"id": 1})
    checker = RepoAccessChecker(API)
    assert await checker.can_read(uuid.uuid4(), "tok", "alice/repo") is True


@pytest.mark.asyncio
async def test_can_read_returns_false_on_404(respx_mock):
    respx_mock.get(f"{API}/repos/alice/secret").respond(404, json={})
    checker = RepoAccessChecker(API)
    assert await checker.can_read(uuid.uuid4(), "tok", "alice/secret") is False


@pytest.mark.asyncio
async def test_can_read_raises_on_unexpected_status(respx_mock):
    respx_mock.get(f"{API}/repos/alice/repo").respond(500, text="boom")
    checker = RepoAccessChecker(API)
    with pytest.raises(RepoAccessError):
        await checker.can_read(uuid.uuid4(), "tok", "alice/repo")


@pytest.mark.asyncio
async def test_result_is_cached_within_ttl(respx_mock):
    route = respx_mock.get(f"{API}/repos/alice/repo").respond(200, json={})
    checker = RepoAccessChecker(API, ttl_seconds=60)
    uid = uuid.uuid4()
    assert await checker.can_read(uid, "tok", "alice/repo") is True
    assert await checker.can_read(uid, "tok", "alice/repo") is True
    assert route.call_count == 1


@pytest.mark.asyncio
async def test_cache_evicts_oldest_when_max_entries_exceeded(respx_mock):
    for i in range(5):
        respx_mock.get(f"{API}/repos/alice/repo{i}").respond(200, json={})
    checker = RepoAccessChecker(API, max_entries=2)
    uid = uuid.uuid4()
    for i in range(5):
        await checker.can_read(uid, "tok", f"alice/repo{i}")
        assert checker.cache_size() <= 2


@pytest.mark.asyncio
async def test_cache_does_not_leak_across_users(respx_mock):
    respx_mock.get(f"{API}/repos/alice/repo").mock(
        side_effect=[
            __import__("httpx").Response(200, json={}),
            __import__("httpx").Response(404, json={}),
        ]
    )
    checker = RepoAccessChecker(API, ttl_seconds=60)
    user_a, user_b = uuid.uuid4(), uuid.uuid4()
    assert await checker.can_read(user_a, "tok-a", "alice/repo") is True
    assert await checker.can_read(user_b, "tok-b", "alice/repo") is False
