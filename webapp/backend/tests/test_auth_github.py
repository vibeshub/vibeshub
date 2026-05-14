import httpx
import pytest
import respx

from app.auth.github import GitHubClient, GitHubAuthError


@pytest.mark.asyncio
async def test_verify_token_returns_user(respx_mock: respx.MockRouter):
    respx_mock.get("https://api.github.com/user").respond(
        200, json={"login": "alice", "id": 7}
    )

    client = GitHubClient(api_base="https://api.github.com")
    user = await client.verify_token("ghp_test")

    assert user.login == "alice"
    assert user.id == 7


@pytest.mark.asyncio
async def test_verify_token_invalid_raises(respx_mock: respx.MockRouter):
    respx_mock.get("https://api.github.com/user").respond(401)

    client = GitHubClient(api_base="https://api.github.com")
    with pytest.raises(GitHubAuthError):
        await client.verify_token("bad")


@pytest.mark.asyncio
async def test_get_pull_returns_pr_info(respx_mock: respx.MockRouter):
    respx_mock.get(
        "https://api.github.com/repos/alice/repo/pulls/3"
    ).respond(
        200,
        json={
            "number": 3,
            "title": "Add the thing",
            "user": {"login": "alice"},
            "html_url": "https://github.com/alice/repo/pull/3",
            "head": {"repo": {"private": False, "full_name": "alice/repo"}},
            "base": {"repo": {"private": False, "full_name": "alice/repo"}},
        },
    )

    client = GitHubClient(api_base="https://api.github.com")
    pr = await client.get_pull("ghp_test", "alice", "repo", 3)

    assert pr.number == 3
    assert pr.title == "Add the thing"
    assert pr.author_login == "alice"
    assert pr.repo_is_private is False
