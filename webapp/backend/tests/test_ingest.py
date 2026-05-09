import pytest
import respx

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
