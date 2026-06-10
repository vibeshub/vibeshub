"""Orchestrate the trace digest call.

The single public entry point is compute_digest. It:
  1. Distills the trace.
  2. Hashes the distilled string; if it matches trace.digest_input_hash,
     skip the LLM call entirely.
  3. Calls OpenAI responses.parse with the Digest schema (Structured
     Outputs); the SDK returns an already-validated Digest.
  4. Drops chapters whose anchor_uuid isn't in the distilled UUID
     surface, strips em-dashes.
  5. Persists digest_json + digest_input_hash on the trace row.
  6. Records the run in agent_run via record_run().

Never raises. Returns the validated Digest on success, None otherwise.
"""
from __future__ import annotations

import hashlib
import logging
import time

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents._client import get_client, get_model
from app.agents._usage import Outcome, record_run
from app.agents.digest.distill import distill_with_uuids
from app.agents.digest.prompt import SYSTEM_PROMPT
from app.agents.digest.schema import Digest, strip_em_dashes
from app.storage.models import Trace

log = logging.getLogger("vibeshub.agents.digest")

_MAX_OUTPUT_TOKENS = 4000
_REASONING_EFFORT = "low"


async def compute_digest(
    session: AsyncSession,
    trace: Trace,
    *,
    blob: bytes,
    subagent_blobs: dict[str, bytes],
) -> Digest | None:
    distilled, uuids = distill_with_uuids(blob, subagent_blobs=subagent_blobs)
    input_hash = hashlib.sha256(distilled.encode("utf-8")).hexdigest()
    truncated = "[… elided" in distilled

    # Idempotency: same distilled input → reuse persisted digest.
    if (
        trace.digest_input_hash == input_hash
        and trace.digest_json is not None
    ):
        await record_run(
            session, agent_name="digest", trace_id=trace.short_id,
            model=get_model(), input_tokens=0, output_tokens=0,
            latency_ms=0, outcome=Outcome.SKIP_UNCHANGED,
        )
        try:
            return Digest.model_validate(trace.digest_json)
        except ValidationError:
            return None

    client = get_client()
    if client is None:
        await record_run(
            session, agent_name="digest", trace_id=trace.short_id,
            model=None, input_tokens=0, output_tokens=0,
            latency_ms=0, outcome=Outcome.SKIP_NO_CONFIG,
        )
        return None

    if not distilled.strip():
        # No digestible content (e.g. a trace of only Tier-4 events, or a
        # format the distiller doesn't recognize). Record the skip so these
        # show up in the agent_run failure-mode queries.
        await record_run(
            session, agent_name="digest", trace_id=trace.short_id,
            model=get_model(), input_tokens=0, output_tokens=0,
            latency_ms=0, outcome=Outcome.SKIP_EMPTY,
        )
        return None

    model = get_model()
    started = time.monotonic()
    try:
        response = client.responses.parse(
            model=model,
            instructions=SYSTEM_PROMPT,
            input=distilled,
            max_output_tokens=_MAX_OUTPUT_TOKENS,
            reasoning={"effort": _REASONING_EFFORT},
            text_format=Digest,
        )
    except Exception as exc:  # noqa: BLE001
        latency_ms = int((time.monotonic() - started) * 1000)
        await record_run(
            session, agent_name="digest", trace_id=trace.short_id,
            model=model, input_tokens=0, output_tokens=0,
            latency_ms=latency_ms, outcome=Outcome.FAIL_CALL,
            error_detail=str(exc)[:500],
        )
        return None
    latency_ms = int((time.monotonic() - started) * 1000)

    in_tok = _safe_int(getattr(response, "usage", None), "input_tokens")
    out_tok = _safe_int(getattr(response, "usage", None), "output_tokens")

    # Structured Outputs guarantees the shape, so output_parsed is a
    # validated Digest. It's None only on a refusal or empty completion.
    candidate = response.output_parsed
    if candidate is None:
        raw = getattr(response, "output_text", "") or ""
        await record_run(
            session, agent_name="digest", trace_id=trace.short_id,
            model=model, input_tokens=in_tok, output_tokens=out_tok,
            latency_ms=latency_ms, outcome=Outcome.FAIL_SCHEMA,
            error_detail=f"output_parsed is None\n--\n{raw[:500]}",
        )
        return None

    # Em-dash sweep + anchor validation
    for field in ("ask", "decisions", "files", "tests", "dead_ends"):
        setattr(candidate, field, strip_em_dashes(getattr(candidate, field)))
    chapters_total = len(candidate.chapters)
    candidate.chapters = [
        c for c in candidate.chapters if c.anchor_uuid in uuids
    ]
    for c in candidate.chapters:
        c.title = strip_em_dashes(c.title)
        c.caption = strip_em_dashes(c.caption)
    chapters_kept = len(candidate.chapters)

    trace.digest_json = candidate.model_dump()
    trace.digest_input_hash = input_hash

    await record_run(
        session, agent_name="digest", trace_id=trace.short_id,
        model=model, input_tokens=in_tok, output_tokens=out_tok,
        latency_ms=latency_ms, outcome=Outcome.OK,
        extra={
            "chapters_kept": chapters_kept,
            "chapters_total": chapters_total,
            "distill_truncated": truncated,
        },
    )
    return candidate


def _safe_int(usage_obj, attr: str) -> int:
    if usage_obj is None:
        return 0
    val = getattr(usage_obj, attr, 0)
    try:
        return int(val or 0)
    except (TypeError, ValueError):
        return 0
