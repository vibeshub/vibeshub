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
