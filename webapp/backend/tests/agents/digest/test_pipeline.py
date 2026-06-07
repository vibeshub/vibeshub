import json
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select

from app.agents._usage import Outcome
from app.agents.digest.pipeline import compute_digest
from app.agents.digest.schema import Digest
from app.storage.models import AgentRun, Trace


def _ok_response(payload: dict):
    """Mock the shape of an OpenAI responses.create result."""
    resp = MagicMock()
    resp.output_text = json.dumps(payload)
    resp.usage = MagicMock(input_tokens=42, output_tokens=10)
    return resp


VALID_PAYLOAD = {
    "ask": "Add a /healthcheck route",
    "decisions": "Inline in app/main.py; no separate router",
    "files": "webapp/backend/app/main.py",
    "tests": "test_health.py adds /healthcheck assertion",
    "dead_ends": "Briefly considered a new router; rejected as YAGNI",
    "chapters": [
        {"anchor_uuid": "u1", "title": "Frame the change",
         "caption": "User asks for /healthcheck."},
        {"anchor_uuid": "bogus", "title": "Drop me",
         "caption": "Anchor not in trace."},
    ],
}


@pytest.fixture
def _trace_blob():
    # Reuse the short fixture from the distill tests
    from pathlib import Path
    return (
        Path(__file__).parent / "fixtures" / "short.jsonl"
    ).read_bytes()


@pytest.fixture
async def _seeded_trace(db_session):
    trace = Trace(
        short_id="abc12345",
        owner_login="alice",
        repo_full_name="alice/x",
        pr_number=1, pr_url=None, pr_title=None,
        platform="claude-code", session_id="s1",
        byte_size=100, message_count=5,
        redaction_count_client=0, redaction_count_server=0,
        is_private=False,
        blob_path=None, blob_prefix="traces/abc12345/",
        agents=[], agent_count=0,
    )
    db_session.add(trace)
    await db_session.flush()
    return trace


@pytest.mark.asyncio
async def test_happy_path_persists_digest_and_records_run(
    monkeypatch, db_session, _trace_blob, _seeded_trace,
):
    monkeypatch.setenv("VIBESHUB_OPENAI_API_KEY", "sk-x")
    monkeypatch.setenv("VIBESHUB_OPENAI_ENDPOINT", "https://e")
    monkeypatch.setenv("VIBESHUB_OPENAI_MODEL", "gpt-5.5")
    mock_client = MagicMock()
    mock_client.responses.create.return_value = _ok_response(VALID_PAYLOAD)
    monkeypatch.setattr(
        "app.agents.digest.pipeline.get_client", lambda: mock_client,
    )

    digest = await compute_digest(
        db_session, _seeded_trace,
        blob=_trace_blob, subagent_blobs={},
    )

    assert isinstance(digest, Digest)
    assert digest.ask == "Add a /healthcheck route"
    # The bogus chapter was filtered out; only the valid one survives
    assert [c.anchor_uuid for c in digest.chapters] == ["u1"]

    # Trace row updated
    assert _seeded_trace.digest_json is not None
    assert _seeded_trace.digest_json["ask"] == "Add a /healthcheck route"
    assert _seeded_trace.digest_input_hash is not None
    assert len(_seeded_trace.digest_input_hash) == 64  # sha256 hex

    # AgentRun row written
    rows = (await db_session.execute(
        select(AgentRun).where(AgentRun.agent_name == "digest"),
    )).scalars().all()
    assert len(rows) == 1
    r = rows[0]
    assert r.outcome == Outcome.OK.value
    assert r.input_tokens == 42
    assert r.output_tokens == 10
    assert r.extra == {"chapters_kept": 1, "chapters_total": 2,
                       "distill_truncated": False}


@pytest.mark.asyncio
async def test_call_uses_json_object_format(
    monkeypatch, db_session, _trace_blob, _seeded_trace,
):
    monkeypatch.setenv("VIBESHUB_OPENAI_API_KEY", "sk-x")
    monkeypatch.setenv("VIBESHUB_OPENAI_ENDPOINT", "https://e")
    monkeypatch.setenv("VIBESHUB_OPENAI_MODEL", "gpt-5.5")
    mock_client = MagicMock()
    mock_client.responses.create.return_value = _ok_response(VALID_PAYLOAD)
    monkeypatch.setattr(
        "app.agents.digest.pipeline.get_client", lambda: mock_client,
    )
    await compute_digest(
        db_session, _seeded_trace,
        blob=_trace_blob, subagent_blobs={},
    )
    kwargs = mock_client.responses.create.call_args.kwargs
    assert kwargs["text"] == {"format": {"type": "json_object"}}
    assert kwargs["model"] == "gpt-5.5"
    assert "instructions" in kwargs
    assert "input" in kwargs


@pytest.mark.asyncio
async def test_no_config_skips_call_and_returns_none(
    monkeypatch, db_session, _trace_blob, _seeded_trace,
):
    monkeypatch.delenv("VIBESHUB_OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("VIBESHUB_OPENAI_ENDPOINT", raising=False)
    monkeypatch.delenv("VIBESHUB_OPENAI_MODEL", raising=False)
    result = await compute_digest(
        db_session, _seeded_trace,
        blob=_trace_blob, subagent_blobs={},
    )
    assert result is None
    rows = (await db_session.execute(select(AgentRun))).scalars().all()
    assert len(rows) == 1
    assert rows[0].outcome == Outcome.SKIP_NO_CONFIG.value
    assert _seeded_trace.digest_json is None


@pytest.mark.asyncio
async def test_call_failure_records_fail_call(
    monkeypatch, db_session, _trace_blob, _seeded_trace,
):
    monkeypatch.setenv("VIBESHUB_OPENAI_API_KEY", "sk-x")
    monkeypatch.setenv("VIBESHUB_OPENAI_ENDPOINT", "https://e")
    monkeypatch.setenv("VIBESHUB_OPENAI_MODEL", "gpt-5.5")
    mock_client = MagicMock()
    mock_client.responses.create.side_effect = RuntimeError("502")
    monkeypatch.setattr(
        "app.agents.digest.pipeline.get_client", lambda: mock_client,
    )
    result = await compute_digest(
        db_session, _seeded_trace,
        blob=_trace_blob, subagent_blobs={},
    )
    assert result is None
    rows = (await db_session.execute(select(AgentRun))).scalars().all()
    assert rows[0].outcome == Outcome.FAIL_CALL.value
    assert "502" in (rows[0].error_detail or "")


@pytest.mark.asyncio
async def test_invalid_json_records_fail_schema(
    monkeypatch, db_session, _trace_blob, _seeded_trace,
):
    monkeypatch.setenv("VIBESHUB_OPENAI_API_KEY", "sk-x")
    monkeypatch.setenv("VIBESHUB_OPENAI_ENDPOINT", "https://e")
    monkeypatch.setenv("VIBESHUB_OPENAI_MODEL", "gpt-5.5")
    mock_client = MagicMock()
    bad = MagicMock()
    bad.output_text = "this is not json"
    bad.usage = MagicMock(input_tokens=10, output_tokens=2)
    mock_client.responses.create.return_value = bad
    monkeypatch.setattr(
        "app.agents.digest.pipeline.get_client", lambda: mock_client,
    )
    result = await compute_digest(
        db_session, _seeded_trace,
        blob=_trace_blob, subagent_blobs={},
    )
    assert result is None
    rows = (await db_session.execute(select(AgentRun))).scalars().all()
    assert rows[0].outcome == Outcome.FAIL_SCHEMA.value
    assert "this is not json" in (rows[0].error_detail or "")


@pytest.mark.asyncio
async def test_em_dash_is_stripped_before_persist(
    monkeypatch, db_session, _trace_blob, _seeded_trace,
):
    monkeypatch.setenv("VIBESHUB_OPENAI_API_KEY", "sk-x")
    monkeypatch.setenv("VIBESHUB_OPENAI_ENDPOINT", "https://e")
    monkeypatch.setenv("VIBESHUB_OPENAI_MODEL", "gpt-5.5")
    payload = dict(VALID_PAYLOAD)
    payload["ask"] = "fix oauth — clean up scopes"
    mock_client = MagicMock()
    mock_client.responses.create.return_value = _ok_response(payload)
    monkeypatch.setattr(
        "app.agents.digest.pipeline.get_client", lambda: mock_client,
    )
    digest = await compute_digest(
        db_session, _seeded_trace,
        blob=_trace_blob, subagent_blobs={},
    )
    assert "—" not in digest.ask
    assert "fix oauth, clean up scopes" == digest.ask


@pytest.mark.asyncio
async def test_idempotency_skips_call_on_unchanged_input(
    monkeypatch, db_session, _trace_blob, _seeded_trace,
):
    monkeypatch.setenv("VIBESHUB_OPENAI_API_KEY", "sk-x")
    monkeypatch.setenv("VIBESHUB_OPENAI_ENDPOINT", "https://e")
    monkeypatch.setenv("VIBESHUB_OPENAI_MODEL", "gpt-5.5")
    mock_client = MagicMock()
    mock_client.responses.create.return_value = _ok_response(VALID_PAYLOAD)
    monkeypatch.setattr(
        "app.agents.digest.pipeline.get_client", lambda: mock_client,
    )
    # First call: live LLM
    first = await compute_digest(
        db_session, _seeded_trace,
        blob=_trace_blob, subagent_blobs={},
    )
    assert mock_client.responses.create.call_count == 1
    assert first is not None
    # Second call with same blob: skipped
    second = await compute_digest(
        db_session, _seeded_trace,
        blob=_trace_blob, subagent_blobs={},
    )
    assert mock_client.responses.create.call_count == 1  # no extra call
    assert second is not None
    assert second.ask == first.ask
    rows = (await db_session.execute(
        select(AgentRun).order_by(AgentRun.created_at),
    )).scalars().all()
    assert [r.outcome for r in rows] == [
        Outcome.OK.value, Outcome.SKIP_UNCHANGED.value,
    ]
