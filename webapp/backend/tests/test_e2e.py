import io
import tarfile
from pathlib import Path

import pytest


FIXTURES = Path(__file__).parent / "fixtures"


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


def _ingest_headers(pr_url: str) -> dict[str, str]:
    return {
        "X-Vibeshub-Pr-Url": pr_url,
        "X-Vibeshub-Platform": "claude-code",
        "X-Vibeshub-Plugin-Version": "0.2.0",
        "X-Vibeshub-Client-Redactions": "0",
        "Content-Type": "application/x-tar",
        "Authorization": "Bearer ghp_test",
    }


def _mock_alice_pr(respx_mock, owner: str, repo: str, number: int) -> None:
    respx_mock.get("https://api.github.test/user").respond(
        200, json={"login": "alice", "id": 7}
    )
    respx_mock.get(
        f"https://api.github.test/repos/{owner}/{repo}/pulls/{number}"
    ).respond(
        200,
        json={
            "number": number, "title": "End-to-end", "user": {"login": "alice"},
            "html_url": f"https://github.com/{owner}/{repo}/pull/{number}",
            "head": {"repo": {"private": False, "full_name": f"{owner}/{repo}"}},
            "base": {"repo": {"private": False, "full_name": f"{owner}/{repo}"}},
        },
    )


@pytest.mark.asyncio
async def test_full_pipeline(client, respx_mock):
    """
    Walks through the full pipeline:
      1. POST /api/ingest
      2. GET /api/traces/<owner>/<repo>/pull/<n>
      3. GET /api/traces/{short_id}
      4. GET /api/traces/{short_id}/raw
      5. DELETE /api/traces/{short_id}
      6. GET /api/traces/{short_id}  -> 404
    """
    _mock_alice_pr(respx_mock, "alice", "repo", 3)

    transcript = (FIXTURES / "sample-session.jsonl").read_bytes()
    auth = {"Authorization": "Bearer ghp_test"}

    r = client.post(
        "/api/ingest",
        content=make_bundle({"main.jsonl": transcript}),
        headers=_ingest_headers("https://github.com/alice/repo/pull/3"),
    )
    assert r.status_code == 201, r.text
    sid = r.json()["short_id"]

    assert client.get("/api/traces/alice/repo/pull/3").status_code == 200
    assert client.get(f"/api/traces/{sid}").status_code == 200
    assert client.get(f"/api/traces/{sid}/raw").status_code == 200
    assert client.delete(f"/api/traces/{sid}", headers=auth).status_code == 204
    assert client.get(f"/api/traces/{sid}").status_code == 404


def _bundle_with_agent(agent_id: str) -> bytes:
    return make_bundle({
        "main.jsonl": b'{"type":"user"}\n{"type":"assistant"}\n',
        f"agents/{agent_id}.jsonl": b'{"type":"user"}\n{"type":"assistant"}\n',
        f"agents/{agent_id}.meta.json": (
            b'{"agentType":"Explore","description":"d","toolUseId":"toolu_01x"}'
        ),
    })


@pytest.mark.asyncio
async def test_e2e_bundle_round_trip(client, respx_mock):
    _mock_alice_pr(respx_mock, "alice", "repo", 1)
    aid = "a0123456789abcdef"
    r = client.post(
        "/api/ingest",
        content=_bundle_with_agent(aid),
        headers=_ingest_headers("https://github.com/alice/repo/pull/1"),
    )
    assert r.status_code == 201, r.text
    sid = r.json()["short_id"]

    summary = client.get(f"/api/traces/{sid}").json()
    assert summary["agent_count"] == 1
    assert summary["agents"][0]["agent_id"] == aid

    raw = client.get(f"/api/traces/{sid}/raw")
    assert raw.status_code == 200
    assert b'"assistant"' in raw.content

    agent_resp = client.get(f"/api/traces/{sid}/agents/{aid}")
    assert agent_resp.status_code == 200
    assert b'"assistant"' in agent_resp.content

    bad = client.get(f"/api/traces/{sid}/agents/a9999999999999999")
    assert bad.status_code == 404


@pytest.mark.asyncio
async def test_e2e_delete_cleans_all_blobs(client, respx_mock):
    _mock_alice_pr(respx_mock, "alice", "repo", 1)
    aid = "a0123456789abcdef"
    r = client.post(
        "/api/ingest",
        content=_bundle_with_agent(aid),
        headers=_ingest_headers("https://github.com/alice/repo/pull/1"),
    )
    assert r.status_code == 201, r.text
    sid = r.json()["short_id"]

    d = client.delete(
        f"/api/traces/{sid}",
        headers={"Authorization": "Bearer ghp_test"},
    )
    assert d.status_code == 204

    blob_store = client.app.state.blob_store
    for key in (
        f"traces/{sid}/main.jsonl",
        f"traces/{sid}/agents/{aid}.jsonl",
        f"traces/{sid}/agents/{aid}.meta.json",
    ):
        with pytest.raises(FileNotFoundError):
            await blob_store.get(key)
