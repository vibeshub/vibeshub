"""API tests for GET /api/traces/{id}/session (the viewer's converted
jsonl) and the converted-copy lifecycle (agent serving, deletion,
legacy fallbacks). /raw must keep returning the native original."""
import json
from pathlib import Path

import pytest
from sqlalchemy import select

from app.storage.models import Trace
from tests.test_ingest import COMMON_HEADERS, _mock_alice_pr1, make_bundle

CODEX_MAIN = (
    b'{"type":"session_meta","payload":{"id":"019e7ed1","cwd":"/x"}}\n'
    b'{"type":"event_msg","payload":{"type":"user_message",'
    b'"message":"Add a greet function"}}\n'
    b'{"type":"response_item","payload":{"type":"message","role":"assistant",'
    b'"content":[{"type":"output_text","text":"on it"}]}}\n'
)

CURSOR_MAIN = (
    b'{"role":"user","message":{"content":[{"type":"text",'
    b'"text":"<user_query>do a sweep</user_query>"}]}}\n'
    b'{"role":"assistant","message":{"content":[{"type":"text",'
    b'"text":"on it"}]}}\n'
)


def _ingest(client, main, platform, members=None):
    body = make_bundle({"main.jsonl": main, **(members or {})})
    headers = {**COMMON_HEADERS, "X-Vibeshub-Platform": platform}
    r = client.post("/api/ingest", content=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["short_id"]


def _first_record(text):
    return json.loads(text.splitlines()[0])


def test_session_serves_converted_codex_and_raw_stays_native(
    client, respx_mock,
):
    _mock_alice_pr1(respx_mock)
    sid = _ingest(client, CODEX_MAIN, "codex")

    session_r = client.get(f"/api/traces/{sid}/session")
    assert session_r.status_code == 200
    assert _first_record(session_r.text)["type"] == "codex-meta"

    raw_r = client.get(f"/api/traces/{sid}/raw")
    assert raw_r.status_code == 200
    assert _first_record(raw_r.text)["type"] == "session_meta"


def test_session_serves_converted_cursor(client, respx_mock):
    _mock_alice_pr1(respx_mock)
    sid = _ingest(client, CURSOR_MAIN, "cursor")

    r = client.get(f"/api/traces/{sid}/session")
    assert r.status_code == 200
    assert _first_record(r.text)["type"] == "cursor-meta"
    raw_r = client.get(f"/api/traces/{sid}/raw")
    assert "role" in _first_record(raw_r.text)


def test_session_serves_raw_for_claude(client, respx_mock):
    _mock_alice_pr1(respx_mock)
    main = b'{"type":"user","uuid":"u1","message":{"content":"hi"}}\n'
    sid = _ingest(client, main, "claude-code")

    r = client.get(f"/api/traces/{sid}/session")
    assert r.status_code == 200
    assert r.content == main


def test_session_converts_in_memory_when_converted_blob_missing(
    client, respx_mock,
):
    # source_format says codex but the converted blob is gone: serve-time
    # fallback converts in memory, no storage writes.
    _mock_alice_pr1(respx_mock)
    sid = _ingest(client, CODEX_MAIN, "codex")
    blob_dir = Path(client.app.state.settings.blob_dir)
    converted_path = blob_dir / "traces" / sid / "converted.jsonl"
    converted_path.unlink()

    r = client.get(f"/api/traces/{sid}/session")
    assert r.status_code == 200
    assert _first_record(r.text)["type"] == "codex-meta"
    assert not converted_path.exists()  # no backfill write


@pytest.mark.asyncio
async def test_session_sniffs_legacy_rows_without_source_format(
    client, respx_mock,
):
    # Traces uploaded before this feature: no converted blob AND
    # source_format NULL (it was never populated for codex/cursor).
    _mock_alice_pr1(respx_mock)
    sid = _ingest(client, CODEX_MAIN, "codex")
    blob_dir = Path(client.app.state.settings.blob_dir)
    (blob_dir / "traces" / sid / "converted.jsonl").unlink()
    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == sid)
        )).scalar_one()
        trace.source_format = None
        await session.commit()

    r = client.get(f"/api/traces/{sid}/session")
    assert r.status_code == 200
    assert _first_record(r.text)["type"] == "codex-meta"


def test_agent_endpoint_serves_converted_for_uuid_agent(
    client, respx_mock,
):
    _mock_alice_pr1(respx_mock)
    aid = "019e7f09-bca2-7150-ac2b-54f7b075a2ea"
    members = {
        f"agents/{aid}.jsonl": (
            b'{"type":"session_meta","payload":{"id":"019e7f09"}}\n'
        ),
        f"agents/{aid}.meta.json": (
            b'{"agentType":"default","description":"d",'
            b'"toolUseId":"call_spawn"}'
        ),
    }
    sid = _ingest(client, CODEX_MAIN, "codex", members)

    # UUID-shaped agent ids used to 404 at the route regex even though
    # ingest accepts them (bundle.AGENT_ID_RE allows both forms).
    r = client.get(f"/api/traces/{sid}/agents/{aid}")
    assert r.status_code == 200
    assert _first_record(r.text)["type"] == "codex-meta"


def test_agent_endpoint_serves_raw_for_claude_agent(client, respx_mock):
    _mock_alice_pr1(respx_mock)
    aid = "a0123456789abcdef"
    agent_jsonl = b'{"type":"assistant","uuid":"x1"}\n'
    members = {
        f"agents/{aid}.jsonl": agent_jsonl,
        f"agents/{aid}.meta.json": (
            b'{"agentType":"Explore","description":"d",'
            b'"toolUseId":"toolu_01x"}'
        ),
    }
    main = b'{"type":"user","uuid":"u1","message":{"content":"hi"}}\n'
    sid = _ingest(client, main, "claude-code", members)

    r = client.get(f"/api/traces/{sid}/agents/{aid}")
    assert r.status_code == 200
    assert r.content == agent_jsonl


def test_delete_removes_converted_blobs(client, respx_mock):
    _mock_alice_pr1(respx_mock)
    aid = "019e7f09-bca2-7150-ac2b-54f7b075a2ea"
    members = {
        f"agents/{aid}.jsonl": (
            b'{"type":"session_meta","payload":{"id":"019e7f09"}}\n'
        ),
        f"agents/{aid}.meta.json": (
            b'{"agentType":"default","description":"d",'
            b'"toolUseId":"call_spawn"}'
        ),
    }
    sid = _ingest(client, CODEX_MAIN, "codex", members)
    trace_dir = Path(client.app.state.settings.blob_dir) / "traces" / sid
    assert (trace_dir / "converted.jsonl").exists()
    assert (trace_dir / "agents" / f"{aid}.converted.jsonl").exists()

    r = client.delete(
        f"/api/traces/{sid}",
        headers={"Authorization": "Bearer ghp_test"},
    )
    assert r.status_code == 204
    assert not (trace_dir / "main.jsonl").exists()
    assert not (trace_dir / "converted.jsonl").exists()
    assert not (trace_dir / "agents" / f"{aid}.converted.jsonl").exists()
