import asyncio

import pytest
import respx

from app.auth.github import GitHubPull, GitHubUser
from app.short_id import looks_like_short_id


@pytest.mark.asyncio
async def test_ingest_happy_path(client, respx_mock: respx.MockRouter):
    respx_mock.get("https://api.github.test/user").respond(
        200, json={"login": "alice", "id": 7}
    )
    respx_mock.get(
        "https://api.github.test/repos/alice/repo/pulls/3"
    ).respond(
        200,
        json={
            "number": 3,
            "title": "Add a feature",
            "user": {"login": "alice"},
            "html_url": "https://github.com/alice/repo/pull/3",
            "head": {"repo": {"private": False, "full_name": "alice/repo"}},
            "base": {"repo": {"private": False, "full_name": "alice/repo"}},
        },
    )

    payload = {
        "transcript_jsonl": '{"type":"user","message":{"role":"user","content":"hi"}}\n'
                            '{"type":"assistant","message":{"role":"assistant","content":"hello"}}\n',
        "pr_url": "https://github.com/alice/repo/pull/3",
        "platform": "claude-code",
        "plugin_version": "0.1.0",
        "session_id": "abc",
        "redaction_count_client": 0,
    }

    response = client.post(
        "/api/ingest",
        json=payload,
        headers={"Authorization": "Bearer ghp_test"},
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert looks_like_short_id(body["short_id"])
    assert body["trace_url"].endswith(f"/alice/repo/pull/3/{body['short_id']}")


@pytest.mark.asyncio
async def test_ingest_missing_bearer(client):
    response = client.post("/api/ingest", json={
        "transcript_jsonl": "x\n",
        "pr_url": "https://github.com/a/b/pull/1",
    })
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_ingest_invalid_token(client, respx_mock):
    respx_mock.get("https://api.github.test/user").respond(401)
    response = client.post(
        "/api/ingest",
        json={"transcript_jsonl": "x\n", "pr_url": "https://github.com/a/b/pull/1"},
        headers={"Authorization": "Bearer bad"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_ingest_rejects_private_repo(client, respx_mock):
    respx_mock.get("https://api.github.test/user").respond(
        200, json={"login": "alice", "id": 7}
    )
    respx_mock.get(
        "https://api.github.test/repos/alice/repo/pulls/3"
    ).respond(
        200,
        json={
            "number": 3, "title": "x", "user": {"login": "alice"},
            "html_url": "https://github.com/alice/repo/pull/3",
            "head": {"repo": {"private": True, "full_name": "alice/repo"}},
            "base": {"repo": {"private": True, "full_name": "alice/repo"}},
        },
    )
    response = client.post(
        "/api/ingest",
        json={"transcript_jsonl": "x\n", "pr_url": "https://github.com/alice/repo/pull/3"},
        headers={"Authorization": "Bearer ghp_test"},
    )
    assert response.status_code == 403
    assert "private" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_ingest_rejects_pr_author_mismatch(client, respx_mock):
    respx_mock.get("https://api.github.test/user").respond(
        200, json={"login": "alice", "id": 7}
    )
    respx_mock.get(
        "https://api.github.test/repos/alice/repo/pulls/3"
    ).respond(
        200,
        json={
            "number": 3, "title": "x", "user": {"login": "bob"},
            "html_url": "https://github.com/alice/repo/pull/3",
            "head": {"repo": {"private": False, "full_name": "alice/repo"}},
            "base": {"repo": {"private": False, "full_name": "alice/repo"}},
        },
    )
    response = client.post(
        "/api/ingest",
        json={"transcript_jsonl": "x\n", "pr_url": "https://github.com/alice/repo/pull/3"},
        headers={"Authorization": "Bearer ghp_test"},
    )
    assert response.status_code == 403
    assert "author" in response.json()["detail"].lower()


class _ConcurrencyProbeGitHub:
    """Stand-in for GitHubClient that detects whether verify_token and
    get_pull are awaited concurrently. Each call signals it started, then
    waits for the other to also signal. If they're called sequentially,
    the second call never starts within the timeout window and the test
    surfaces a non-201 response."""

    def __init__(self):
        self.verify_started = asyncio.Event()
        self.pull_started = asyncio.Event()

    async def verify_token(self, token):
        self.verify_started.set()
        await asyncio.wait_for(self.pull_started.wait(), timeout=1.0)
        return GitHubUser(login="alice", id=7)

    async def get_pull(self, token, owner, repo, number):
        self.pull_started.set()
        await asyncio.wait_for(self.verify_started.wait(), timeout=1.0)
        return GitHubPull(
            number=number,
            title="t",
            author_login="alice",
            html_url=f"https://github.com/{owner}/{repo}/pull/{number}",
            repo_is_private=False,
            repo_full_name=f"{owner}/{repo}",
        )


@pytest.mark.asyncio
async def test_ingest_runs_github_calls_in_parallel(client):
    probe = _ConcurrencyProbeGitHub()
    client.app.state.github = probe

    response = client.post(
        "/api/ingest",
        json={
            "transcript_jsonl": '{"type":"user"}\n',
            "pr_url": "https://github.com/alice/repo/pull/3",
        },
        headers={"Authorization": "Bearer ghp_test"},
    )

    assert response.status_code == 201, response.text
    assert probe.verify_started.is_set()
    assert probe.pull_started.is_set()


@pytest.mark.asyncio
async def test_ingest_rejects_oversize(client, respx_mock):
    # Override max via the running app's settings (lifespan-loaded)
    client.app.state.settings.max_trace_bytes = 100
    respx_mock.get("https://api.github.test/user").respond(
        200, json={"login": "alice", "id": 7}
    )
    respx_mock.get(
        "https://api.github.test/repos/alice/repo/pulls/3"
    ).respond(
        200,
        json={
            "number": 3, "title": "x", "user": {"login": "alice"},
            "html_url": "https://github.com/alice/repo/pull/3",
            "head": {"repo": {"private": False, "full_name": "alice/repo"}},
            "base": {"repo": {"private": False, "full_name": "alice/repo"}},
        },
    )
    big = "x" * 200
    response = client.post(
        "/api/ingest",
        json={"transcript_jsonl": big, "pr_url": "https://github.com/alice/repo/pull/3"},
        headers={"Authorization": "Bearer ghp_test"},
    )
    assert response.status_code == 413
