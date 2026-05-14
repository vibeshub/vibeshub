import pytest
from pathlib import Path


FIXTURES = Path(__file__).parent / "fixtures"


@pytest.mark.asyncio
async def test_full_pipeline(client, respx_mock):
    """
    Walks through the full pipeline:
      1. POST /api/ingest
      2. GET /api/traces/<owner>/<repo>/pull/<n>
      3. GET /api/traces/{short_id}
      4. GET /api/traces/{short_id}/raw
      5. GET /api/traces/{short_id}/rendered
      6. DELETE /api/traces/{short_id}
      7. GET /api/traces/{short_id}  -> 404
    """
    respx_mock.get("https://api.github.test/user").respond(
        200, json={"login": "alice", "id": 7}
    )
    respx_mock.get(
        "https://api.github.test/repos/alice/repo/pulls/3"
    ).respond(
        200,
        json={
            "number": 3, "title": "End-to-end", "user": {"login": "alice"},
            "html_url": "https://github.com/alice/repo/pull/3",
            "head": {"repo": {"private": False, "full_name": "alice/repo"}},
            "base": {"repo": {"private": False, "full_name": "alice/repo"}},
        },
    )

    transcript = (FIXTURES / "sample-session.jsonl").read_text()
    auth = {"Authorization": "Bearer ghp_test"}

    r = client.post(
        "/api/ingest",
        json={"transcript_jsonl": transcript,
              "pr_url": "https://github.com/alice/repo/pull/3"},
        headers=auth,
    )
    assert r.status_code == 201
    sid = r.json()["short_id"]

    assert client.get("/api/traces/alice/repo/pull/3").status_code == 200
    assert client.get(f"/api/traces/{sid}").status_code == 200
    assert client.get(f"/api/traces/{sid}/raw").status_code == 200
    assert client.get(f"/api/traces/{sid}/rendered").status_code == 200
    assert client.delete(f"/api/traces/{sid}", headers=auth).status_code == 204
    assert client.get(f"/api/traces/{sid}").status_code == 404
