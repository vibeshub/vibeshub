"""End-to-end-ish test: upload a trace and verify the digest pipeline ran.

The OpenAI client is patched at the seam so this never hits the network.
The rest (redaction, blob store, DB persistence, response serialization)
is real.
"""
import io
import json
import tarfile
from unittest.mock import MagicMock

import pytest


SAMPLE_JSONL = (
    b'{"type":"user","uuid":"u1","message":{"content":"Test"}}\n'
    b'{"type":"assistant","uuid":"a1","message":'
    b'{"content":[{"type":"text","text":"Done."}]}}\n'
)


def _make_bundle(members: dict[str, bytes]) -> bytes:
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
        200, json={"login": "alice", "id": 7},
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


@pytest.fixture
def _digest_env(monkeypatch):
    monkeypatch.setenv("VIBESHUB_OPENAI_API_KEY", "sk-x")
    monkeypatch.setenv("VIBESHUB_OPENAI_ENDPOINT", "https://e")
    monkeypatch.setenv("VIBESHUB_OPENAI_MODEL", "gpt-5.5")


@pytest.fixture
def _patch_llm(monkeypatch):
    from app.agents.digest.schema import Digest

    mock = MagicMock()
    payload = {
        "ask": "test ask", "decisions": "test decisions",
        "files": "test files", "tests": "test tests",
        "dead_ends": "test dead_ends", "chapters": [],
    }
    resp = MagicMock()
    # The pipeline uses responses.parse (Structured Outputs), which
    # returns an already-validated Digest on output_parsed.
    resp.output_parsed = Digest.model_validate(payload)
    resp.output_text = json.dumps(payload)
    resp.usage = MagicMock(input_tokens=5, output_tokens=3)
    mock.responses.parse.return_value = resp
    monkeypatch.setattr(
        "app.agents.digest.pipeline.get_client", lambda: mock,
    )
    return mock


@pytest.mark.asyncio
async def test_upload_runs_digest_and_returns_it(
    client, respx_mock, _digest_env, _patch_llm,
):
    """POST a trace via /api/ingest. Assert the response contains a
    digest, the trace row stores it, and the LLM was called once.
    """
    _mock_alice_pr(respx_mock, "alice", "repo", 7)
    r = client.post(
        "/api/ingest",
        content=_make_bundle({"main.jsonl": SAMPLE_JSONL}),
        headers=_ingest_headers("https://github.com/alice/repo/pull/7"),
    )
    assert r.status_code == 201, r.text
    body = r.json()
    short_id = body["short_id"]
    assert body.get("ai_digest") is not None
    assert body["ai_digest"]["ask"] == "test ask"

    summary = client.get(f"/api/traces/{short_id}")
    assert summary.status_code == 200
    sbody = summary.json()
    assert sbody["ai_digest"]["ask"] == "test ask"
    assert _patch_llm.responses.parse.call_count == 1


@pytest.mark.asyncio
async def test_upload_without_env_persists_no_digest(client, respx_mock):
    """No OpenAI env vars set → digest is None on the response.
    Upload still succeeds (digest is best-effort)."""
    _mock_alice_pr(respx_mock, "alice", "repo", 8)
    r = client.post(
        "/api/ingest",
        content=_make_bundle({"main.jsonl": SAMPLE_JSONL}),
        headers=_ingest_headers("https://github.com/alice/repo/pull/8"),
    )
    assert r.status_code == 201, r.text
    body = r.json()
    short_id = body["short_id"]
    assert body.get("ai_digest") is None

    summary = client.get(f"/api/traces/{short_id}")
    assert summary.status_code == 200
    assert summary.json().get("ai_digest") is None
