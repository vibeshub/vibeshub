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


def _ingest_for(client, respx_mock, owner: str, repo: str, number: int,
                title: str, uploader: str = "alice"):
    """Helper that ingests one trace under owner/repo#number as `uploader`.

    The PR author must match the uploader (ingest validation), so we mock the
    GitHub PR endpoint accordingly.
    """
    respx_mock.get("https://api.github.test/user").respond(
        200, json={"login": uploader, "id": 1}
    )
    respx_mock.get(
        f"https://api.github.test/repos/{owner}/{repo}/pulls/{number}"
    ).respond(
        200,
        json={
            "number": number, "title": title, "user": {"login": uploader},
            "html_url": f"https://github.com/{owner}/{repo}/pull/{number}",
            "head": {"repo": {"private": False, "full_name": f"{owner}/{repo}"}},
            "base": {"repo": {"private": False, "full_name": f"{owner}/{repo}"}},
        },
    )
    r = client.post(
        "/api/ingest",
        json={
            "transcript_jsonl": '{"type":"user"}\n',
            "pr_url": f"https://github.com/{owner}/{repo}/pull/{number}",
        },
        headers={"Authorization": "Bearer ghp_test"},
    )
    assert r.status_code == 201, r.text
    return r.json()["short_id"]


@pytest.mark.asyncio
async def test_user_overview_empty(client):
    resp = client.get("/api/users/nobody")
    assert resp.status_code == 200
    body = resp.json()
    assert body["login"] == "nobody"
    assert body["traces"] == []
    assert body["repos"] == []
    assert body["stats"]["trace_count"] == 0
    assert body["stats"]["repo_count"] == 0
    assert body["stats"]["last_trace_at"] is None


@pytest.mark.asyncio
async def test_user_overview_aggregates_across_repos(client, respx_mock):
    _ingest_for(client, respx_mock, "alice", "repo-a", 1, "First")
    _ingest_for(client, respx_mock, "alice", "repo-a", 2, "Second")
    _ingest_for(client, respx_mock, "alice", "repo-b", 1, "Third")
    # A trace owned by another user shouldn't bleed in.
    _ingest_for(client, respx_mock, "bob", "elsewhere", 1, "Bob's")

    resp = client.get("/api/users/alice")
    assert resp.status_code == 200
    body = resp.json()
    assert body["stats"]["trace_count"] == 3
    assert body["stats"]["repo_count"] == 2
    repo_names = {r["repo_full_name"]: r["trace_count"] for r in body["repos"]}
    assert repo_names == {"alice/repo-a": 2, "alice/repo-b": 1}
    titles = {t["pr_title"] for t in body["traces"]}
    assert titles == {"First", "Second", "Third"}


@pytest.mark.asyncio
async def test_repo_overview_empty(client):
    resp = client.get("/api/repos/none/such")
    assert resp.status_code == 200
    body = resp.json()
    assert body["owner"] == "none"
    assert body["repo"] == "such"
    assert body["repo_full_name"] == "none/such"
    assert body["traces"] == []
    assert body["contributors"] == []
    assert body["stats"]["trace_count"] == 0


@pytest.mark.asyncio
async def test_repo_overview_aggregates_contributors(client, respx_mock):
    _ingest_for(client, respx_mock, "alice", "repo", 1, "T1", uploader="alice")
    _ingest_for(client, respx_mock, "alice", "repo", 2, "T2", uploader="alice")
    _ingest_for(client, respx_mock, "alice", "repo", 3, "T3", uploader="bob")
    # A different repo shouldn't bleed in.
    _ingest_for(client, respx_mock, "alice", "other", 1, "X", uploader="alice")

    resp = client.get("/api/repos/alice/repo")
    assert resp.status_code == 200
    body = resp.json()
    assert body["stats"]["trace_count"] == 3
    assert body["stats"]["pr_count"] == 3
    assert body["stats"]["contributor_count"] == 2
    contribs = {c["login"]: c["trace_count"] for c in body["contributors"]}
    assert contribs == {"alice": 2, "bob": 1}
