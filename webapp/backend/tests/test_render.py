from pathlib import Path

import pytest

from app.render.claude_code_log import render_jsonl_to_html


FIXTURES = Path(__file__).parent / "fixtures"


def test_render_returns_html_with_message_text():
    data = (FIXTURES / "sample-session.jsonl").read_bytes()
    html = render_jsonl_to_html(data)
    assert html.lstrip().startswith("<")
    assert "startup credential smoke-check" in html


def test_render_injects_storage_shim_before_any_script():
    """
    The trace HTML is rendered inside a sandboxed iframe (sandbox="allow-scripts",
    no allow-same-origin), so window.localStorage throws SecurityError on access.
    claude-code-log's search code touches localStorage unguarded, which kills
    initSearch and breaks every toggle that depends on it.

    We inject a tiny shim that installs an in-memory localStorage/sessionStorage
    when the real ones are unreachable. To be effective, it must run before any
    other script on the page.
    """
    data = (FIXTURES / "sample-session.jsonl").read_bytes()
    html = render_jsonl_to_html(data)

    shim_marker = 'id="vibeshub-storage-shim"'
    assert shim_marker in html, "expected storage shim to be injected"

    # The shim must be the very first <script> in the document so it runs
    # before any other script touches localStorage.
    first_script_pos = html.lower().find("<script")
    assert first_script_pos != -1
    shim_pos = html.find(shim_marker)
    next_script_pos = html.lower().find("<script", first_script_pos + 1)
    assert first_script_pos < shim_pos < next_script_pos, (
        "first <script> tag in the document must be the shim"
    )


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
