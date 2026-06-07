import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents._usage import Outcome, record_run
from app.storage.models import AgentRun


@pytest.mark.asyncio
async def test_record_run_persists_a_row(db_session: AsyncSession):
    await record_run(
        db_session,
        agent_name="digest",
        trace_id="abc123",
        model="gpt-5.5",
        input_tokens=1234,
        output_tokens=567,
        latency_ms=2100,
        outcome=Outcome.OK,
        extra={"chapters_kept": 4, "chapters_total": 4},
    )
    await db_session.commit()
    rows = (await db_session.execute(select(AgentRun))).scalars().all()
    assert len(rows) == 1
    r = rows[0]
    assert r.agent_name == "digest"
    assert r.trace_id == "abc123"
    assert r.outcome == "ok"
    assert r.input_tokens == 1234
    assert r.extra == {"chapters_kept": 4, "chapters_total": 4}


@pytest.mark.asyncio
async def test_record_run_swallows_db_errors(monkeypatch, db_session):
    # Force the session.add to throw — the helper must swallow the error
    # so a broken metrics table never breaks the upload path.
    class _Boom(Exception):
        pass
    def _raise(*_a, **_kw):
        raise _Boom("db is sad")
    monkeypatch.setattr(db_session, "add", _raise)
    # Should not raise — just logs and returns
    await record_run(
        db_session,
        agent_name="digest",
        trace_id=None,
        model="gpt-5.5",
        input_tokens=0,
        output_tokens=0,
        latency_ms=0,
        outcome=Outcome.SKIP_NO_CONFIG,
    )


def test_outcome_values_match_spec():
    assert Outcome.OK.value == "ok"
    assert Outcome.SKIP_UNCHANGED.value == "skip_unchanged"
    assert Outcome.SKIP_NO_CONFIG.value == "skip_no_config"
    assert Outcome.FAIL_CALL.value == "fail_call"
    assert Outcome.FAIL_SCHEMA.value == "fail_schema"
    assert Outcome.FAIL_ANCHORS.value == "fail_anchors"
