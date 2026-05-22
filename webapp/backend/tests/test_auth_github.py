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


from app.auth.github import GitHubAPIError


@pytest.mark.asyncio
async def test_get_repo_permission_returns_permission(
    respx_mock: respx.MockRouter,
):
    respx_mock.get(
        "https://api.github.com/repos/alice/repo/collaborators/alice/permission"
    ).respond(200, json={"permission": "admin"})

    client = GitHubClient(api_base="https://api.github.com")
    perm = await client.get_repo_permission("ghp_test", "alice", "repo", "alice")

    assert perm.permission == "admin"
    assert perm.is_collaborator is True


@pytest.mark.asyncio
async def test_get_repo_permission_none_is_not_collaborator(
    respx_mock: respx.MockRouter,
):
    respx_mock.get(
        "https://api.github.com/repos/alice/repo/collaborators/bob/permission"
    ).respond(200, json={"permission": "none"})

    client = GitHubClient(api_base="https://api.github.com")
    perm = await client.get_repo_permission("ghp_test", "alice", "repo", "bob")

    assert perm.permission == "none"
    assert perm.is_collaborator is False


@pytest.mark.asyncio
async def test_get_repo_permission_404_raises(respx_mock: respx.MockRouter):
    respx_mock.get(
        "https://api.github.com/repos/alice/repo/collaborators/bob/permission"
    ).respond(404)

    client = GitHubClient(api_base="https://api.github.com")
    with pytest.raises(GitHubAPIError):
        await client.get_repo_permission("ghp_test", "alice", "repo", "bob")


@pytest.mark.asyncio
async def test_get_repo_returns_visibility(respx_mock: respx.MockRouter):
    respx_mock.get("https://api.github.com/repos/alice/repo").respond(
        200, json={"full_name": "alice/repo", "private": True}
    )

    client = GitHubClient(api_base="https://api.github.com")
    info = await client.get_repo("ghp_test", "alice", "repo")

    assert info.full_name == "alice/repo"
    assert info.is_private is True


@pytest.mark.asyncio
async def test_get_repo_404_raises(respx_mock: respx.MockRouter):
    respx_mock.get("https://api.github.com/repos/alice/repo").respond(404)

    client = GitHubClient(api_base="https://api.github.com")
    with pytest.raises(GitHubAPIError):
        await client.get_repo("ghp_test", "alice", "repo")
