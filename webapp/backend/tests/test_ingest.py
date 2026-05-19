import asyncio
import io
import tarfile

import pytest
import respx
from sqlalchemy import select

from app.auth.github import GitHubPull, GitHubUser
from app.short_id import looks_like_short_id
from app.storage.models import Trace


def make_bundle(members: dict[str, bytes]) -> bytes:
    """Build a gzipped tar bundle from {name: bytes} members, in the same
    shape produced by the plugin and consumed by `unpack_and_redact`."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, data in members.items():
            info = tarfile.TarInfo(name=name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


COMMON_HEADERS = {
    "X-Vibeshub-Pr-Url": "https://github.com/alice/repo/pull/1",
    "X-Vibeshub-Platform": "claude-code",
    "X-Vibeshub-Plugin-Version": "0.2.0",
    "X-Vibeshub-Client-Redactions": "0",
    "Content-Type": "application/x-tar",
    "Authorization": "Bearer ghp_test",
}


def _mock_alice_pr1(respx_mock: respx.MockRouter, *, private: bool = False, author: str = "alice") -> None:
    """Stand up the two GitHub responses the ingest handler needs."""
    respx_mock.get("https://api.github.test/user").respond(
        200, json={"login": "alice", "id": 7}
    )
    respx_mock.get(
        "https://api.github.test/repos/alice/repo/pulls/1"
    ).respond(
        200,
        json={
            "number": 1,
            "title": "Add a feature",
            "user": {"login": author},
            "html_url": "https://github.com/alice/repo/pull/1",
            "head": {"repo": {"private": private, "full_name": "alice/repo"}},
            "base": {"repo": {"private": private, "full_name": "alice/repo"}},
        },
    )


@pytest.mark.asyncio
async def test_ingest_accepts_tar_bundle(client, respx_mock):
    _mock_alice_pr1(respx_mock)

    body = make_bundle({"main.jsonl": b'{"type":"user","message":{}}\n'})
    r = client.post("/api/ingest", content=body, headers=COMMON_HEADERS)
    assert r.status_code == 201, r.text
    data = r.json()
    assert "trace_id" in data and "short_id" in data and "trace_url" in data
    assert looks_like_short_id(data["short_id"])
    assert data["trace_url"].endswith(f"/alice/repo/pull/1/{data['short_id']}")


@pytest.mark.asyncio
async def test_ingest_persists_agents(client, respx_mock):
    _mock_alice_pr1(respx_mock)

    aid = "a0123456789abcdef"
    body = make_bundle({
        "main.jsonl": b'{"type":"user"}\n',
        f"agents/{aid}.jsonl": b'{"type":"assistant"}\n{"type":"user"}\n',
        f"agents/{aid}.meta.json": (
            b'{"agentType":"Explore","description":"d","toolUseId":"toolu_01x"}'
        ),
    })
    r = client.post("/api/ingest", content=body, headers=COMMON_HEADERS)
    assert r.status_code == 201, r.text
    short_id = r.json()["short_id"]

    # Query the trace row via the app's session_maker (same engine the
    # handler used, since this is an in-memory SQLite shared across the app).
    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (
            await session.execute(select(Trace).where(Trace.short_id == short_id))
        ).scalar_one()

    assert trace.blob_prefix == f"traces/{trace.short_id}/"
    assert trace.blob_path is None
    assert trace.agent_count == 1
    assert trace.agents == [{
        "agent_id": aid,
        "tool_use_id": "toolu_01x",
        "agent_type": "Explore",
        "description": "d",
        "message_count": 2,
    }]


@pytest.mark.asyncio
async def test_ingest_rejects_oversize_bundle(client, respx_mock):
    _mock_alice_pr1(respx_mock)
    # Cap the in-process settings so we don't have to actually produce a
    # 50 MiB tar to trigger the limit.
    client.app.state.settings.max_trace_bytes = 100

    body = make_bundle({"main.jsonl": b"x" * 5000})
    r = client.post("/api/ingest", content=body, headers=COMMON_HEADERS)
    assert r.status_code == 413


@pytest.mark.asyncio
async def test_ingest_rejects_malformed_tar(client, respx_mock):
    _mock_alice_pr1(respx_mock)
    r = client.post(
        "/api/ingest", content=b"not a tar", headers=COMMON_HEADERS,
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_ingest_requires_pr_url_header(client, respx_mock):
    _mock_alice_pr1(respx_mock)
    body = make_bundle({"main.jsonl": b"{}\n"})
    headers = {k: v for k, v in COMMON_HEADERS.items() if k != "X-Vibeshub-Pr-Url"}
    r = client.post("/api/ingest", content=body, headers=headers)
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_ingest_missing_bearer(client):
    body = make_bundle({"main.jsonl": b"{}\n"})
    headers = {k: v for k, v in COMMON_HEADERS.items() if k != "Authorization"}
    r = client.post("/api/ingest", content=body, headers=headers)
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_ingest_invalid_token(client, respx_mock):
    respx_mock.get("https://api.github.test/user").respond(401)
    respx_mock.get(
        "https://api.github.test/repos/alice/repo/pulls/1"
    ).respond(
        200,
        json={
            "number": 1, "title": "x", "user": {"login": "alice"},
            "html_url": "https://github.com/alice/repo/pull/1",
            "head": {"repo": {"private": False, "full_name": "alice/repo"}},
            "base": {"repo": {"private": False, "full_name": "alice/repo"}},
        },
    )
    body = make_bundle({"main.jsonl": b"{}\n"})
    r = client.post(
        "/api/ingest",
        content=body,
        headers={**COMMON_HEADERS, "Authorization": "Bearer bad"},
    )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_ingest_rejects_private_repo(client, respx_mock):
    _mock_alice_pr1(respx_mock, private=True)
    body = make_bundle({"main.jsonl": b"{}\n"})
    r = client.post("/api/ingest", content=body, headers=COMMON_HEADERS)
    assert r.status_code == 403
    assert "private" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_ingest_rejects_pr_author_mismatch(client, respx_mock):
    _mock_alice_pr1(respx_mock, author="bob")
    body = make_bundle({"main.jsonl": b"{}\n"})
    r = client.post("/api/ingest", content=body, headers=COMMON_HEADERS)
    assert r.status_code == 403
    assert "author" in r.json()["detail"].lower()


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

    body = make_bundle({"main.jsonl": b'{"type":"user"}\n'})
    r = client.post("/api/ingest", content=body, headers=COMMON_HEADERS)

    assert r.status_code == 201, r.text
    assert probe.verify_started.is_set()
    assert probe.pull_started.is_set()
