import pytest


@pytest.mark.asyncio
async def test_list_pr_traces_empty(client):
    response = client.get("/api/traces/alice/repo/pull/3")
    assert response.status_code == 200
    assert response.json() == {"traces": []}


@pytest.mark.asyncio
async def test_list_pr_traces_after_ingest(client, respx_mock):
    respx_mock.get("https://api.github.test/user").respond(
        200, json={"login": "alice", "id": 7}
    )
    respx_mock.get(
        "https://api.github.test/repos/alice/repo/pulls/3"
    ).respond(
        200,
        json={
            "number": 3, "title": "Hello", "user": {"login": "alice"},
            "html_url": "https://github.com/alice/repo/pull/3",
            "head": {"repo": {"private": False, "full_name": "alice/repo"}},
            "base": {"repo": {"private": False, "full_name": "alice/repo"}},
        },
    )
    payload = {
        "transcript_jsonl": '{"type":"user"}\n',
        "pr_url": "https://github.com/alice/repo/pull/3",
    }
    ingest_resp = client.post(
        "/api/ingest",
        json=payload,
        headers={"Authorization": "Bearer ghp_test"},
    )
    assert ingest_resp.status_code == 201
    short_id = ingest_resp.json()["short_id"]

    response = client.get("/api/traces/alice/repo/pull/3")
    assert response.status_code == 200
    body = response.json()
    assert len(body["traces"]) == 1
    assert body["traces"][0]["short_id"] == short_id
    assert body["traces"][0]["pr_title"] == "Hello"


@pytest.mark.asyncio
async def test_get_trace_by_short_id(client, respx_mock):
    respx_mock.get("https://api.github.test/user").respond(
        200, json={"login": "alice", "id": 7}
    )
    respx_mock.get(
        "https://api.github.test/repos/alice/repo/pulls/3"
    ).respond(
        200,
        json={
            "number": 3, "title": "Hello", "user": {"login": "alice"},
            "html_url": "https://github.com/alice/repo/pull/3",
            "head": {"repo": {"private": False, "full_name": "alice/repo"}},
            "base": {"repo": {"private": False, "full_name": "alice/repo"}},
        },
    )
    ingest_resp = client.post(
        "/api/ingest",
        json={"transcript_jsonl": "{}\n",
              "pr_url": "https://github.com/alice/repo/pull/3"},
        headers={"Authorization": "Bearer ghp_test"},
    )
    short_id = ingest_resp.json()["short_id"]

    response = client.get(f"/api/traces/{short_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["short_id"] == short_id
    assert body["repo_full_name"] == "alice/repo"


@pytest.mark.asyncio
async def test_get_trace_404(client):
    response = client.get("/api/traces/notfound99")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_delete_trace_by_owner(client, respx_mock):
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
    short_id = client.post(
        "/api/ingest",
        json={"transcript_jsonl": "{}\n",
              "pr_url": "https://github.com/alice/repo/pull/3"},
        headers={"Authorization": "Bearer ghp_test"},
    ).json()["short_id"]

    resp = client.delete(
        f"/api/traces/{short_id}",
        headers={"Authorization": "Bearer ghp_test"},
    )
    assert resp.status_code == 204

    assert client.get(f"/api/traces/{short_id}").status_code == 404


@pytest.mark.asyncio
async def test_delete_trace_rejects_other_user(client, respx_mock):
    # First user (alice) creates the trace
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
    short_id = client.post(
        "/api/ingest",
        json={"transcript_jsonl": "{}\n",
              "pr_url": "https://github.com/alice/repo/pull/3"},
        headers={"Authorization": "Bearer ghp_test"},
    ).json()["short_id"]

    # bob attempts to delete
    respx_mock.get("https://api.github.test/user").respond(
        200, json={"login": "bob", "id": 8}
    )
    resp = client.delete(
        f"/api/traces/{short_id}",
        headers={"Authorization": "Bearer ghp_test_bob"},
    )
    assert resp.status_code == 403
