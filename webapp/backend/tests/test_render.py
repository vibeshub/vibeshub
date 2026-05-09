from pathlib import Path

import pytest

from app.render.claude_code_log import render_jsonl_to_html


FIXTURES = Path(__file__).parent / "fixtures"


def test_render_returns_html_with_message_text():
    data = (FIXTURES / "sample-session.jsonl").read_bytes()
    html = render_jsonl_to_html(data)
    assert html.lstrip().startswith("<")
    assert "2 + 2" in html or "It's 4" in html


@pytest.mark.asyncio
async def test_rendered_endpoint_returns_html_then_caches(client, respx_mock):
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
    # Use the realistic fixture content for ingest so claude-code-log can render it
    fixture_path = (FIXTURES / "sample-session.jsonl")
    transcript_jsonl = fixture_path.read_text()
    payload = {
        "transcript_jsonl": transcript_jsonl,
        "pr_url": "https://github.com/alice/repo/pull/3",
    }
    sid = client.post(
        "/api/ingest",
        json=payload,
        headers={"Authorization": "Bearer ghp_test"},
    ).json()["short_id"]

    r1 = client.get(f"/api/traces/{sid}/rendered")
    assert r1.status_code == 200
    assert r1.headers["content-type"].startswith("text/html")
    assert r1.text.lstrip().startswith("<")

    # Second call should hit the cache; verify idempotence.
    r2 = client.get(f"/api/traces/{sid}/rendered")
    assert r2.status_code == 200
    assert r2.text == r1.text


@pytest.mark.asyncio
async def test_rendered_endpoint_returns_render_failed_on_renderer_error(
    client, respx_mock, monkeypatch
):
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
    sid = client.post(
        "/api/ingest",
        json={"transcript_jsonl": "{}\n",
              "pr_url": "https://github.com/alice/repo/pull/3"},
        headers={"Authorization": "Bearer ghp_test"},
    ).json()["short_id"]

    # Force the renderer to fail by patching the function used inside the API
    from app.render import claude_code_log as ccl
    def boom(_data: bytes) -> str:
        raise ccl.RenderError("synthetic failure")
    monkeypatch.setattr("app.api.render.render_jsonl_to_html", boom)

    r = client.get(f"/api/traces/{sid}/rendered")
    assert r.status_code == 502
    body = r.json()
    assert body["detail"]["error"] == "render_failed"
    assert body["detail"]["fallback"] == "raw"
