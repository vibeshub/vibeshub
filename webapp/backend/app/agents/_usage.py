"""Shared usage / observability helper for the agents subsystem.

Every agent (current: digest; future: search rerank, etc.) records each
run here. The write is fire-and-forget: if the DB rejects the row we
log and move on so a broken metrics table never breaks the upload path.

The structured log line is intentionally redundant with the DB row — the
DB is the durable surface for analytical queries; the log is the running
tape for live debugging.
"""
from __future__ import annotations

import enum
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.storage.models import AgentRun

log = logging.getLogger("vibeshub.agents")


class Outcome(str, enum.Enum):
    OK = "ok"
    SKIP_UNCHANGED = "skip_unchanged"
    SKIP_NO_CONFIG = "skip_no_config"
    SKIP_EMPTY = "skip_empty"
    FAIL_CALL = "fail_call"
    FAIL_SCHEMA = "fail_schema"
    FAIL_ANCHORS = "fail_anchors"


async def record_run(
    session: AsyncSession,
    *,
    agent_name: str,
    trace_id: str | None,
    model: str | None,
    input_tokens: int,
    output_tokens: int,
    latency_ms: int,
    outcome: Outcome,
    error_detail: str | None = None,
    extra: dict | None = None,
) -> None:
    """Insert one row into agent_run. Never raises."""
    log.info(
        "agent_run agent=%s trace=%s model=%s in=%d out=%d ms=%d outcome=%s",
        agent_name, trace_id, model,
        input_tokens, output_tokens, latency_ms, outcome.value,
    )
    try:
        row = AgentRun(
            agent_name=agent_name,
            trace_id=trace_id,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            latency_ms=latency_ms,
            outcome=outcome.value,
            error_detail=error_detail,
            extra=extra,
        )
        session.add(row)
    except Exception as exc:  # noqa: BLE001
        log.warning("record_run failed to persist: %s", exc)
