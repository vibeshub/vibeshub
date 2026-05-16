from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from vibeshub_client.post_comment import build_comment_body, post_pr_comment
from vibeshub_client.reader import TranscriptReader
from vibeshub_client.redact import redact_jsonl
from vibeshub_client.upload import IngestPayload, UploadError, upload_trace
from vibeshub_client.version import PLUGIN_VERSION


@dataclass
class RunOptions:
    server_url: str
    token: str
    pr_url: str
    session_id: Optional[str] = None


@dataclass
class RunResult:
    uploaded: bool
    short_id: str | None = None
    trace_url: str | None = None
    skip_reason: str | None = None
    payload_bytes: int | None = None
    upload_elapsed_seconds: float | None = None


async def run_share_pipeline(
    *,
    reader: TranscriptReader,
    hook_input: dict,
    options: RunOptions,
) -> RunResult:
    transcript_path: Path = reader.find_session(hook_input)
    raw = transcript_path.read_bytes()
    redacted, report = redact_jsonl(raw)

    payload = IngestPayload(
        transcript_jsonl=redacted.decode("utf-8", errors="replace"),
        pr_url=options.pr_url,
        platform=reader.platform_id(),
        plugin_version=PLUGIN_VERSION,
        session_id=options.session_id,
        redaction_count_client=report.total(),
    )
    payload_bytes = len(redacted)

    started = time.monotonic()
    try:
        result = await upload_trace(
            server_url=options.server_url,
            token=options.token,
            payload=payload,
        )
    except UploadError as e:
        return RunResult(
            uploaded=False,
            skip_reason=f"upload failed: {e}",
            payload_bytes=payload_bytes,
            upload_elapsed_seconds=time.monotonic() - started,
        )
    upload_elapsed = time.monotonic() - started

    try:
        post_pr_comment(
            pr_url=options.pr_url,
            body=build_comment_body(result.trace_url),
        )
    except RuntimeError as e:
        return RunResult(
            uploaded=True,
            short_id=result.short_id,
            trace_url=result.trace_url,
            skip_reason=f"comment failed: {e}",
            payload_bytes=payload_bytes,
            upload_elapsed_seconds=upload_elapsed,
        )

    return RunResult(
        uploaded=True,
        short_id=result.short_id,
        trace_url=result.trace_url,
        payload_bytes=payload_bytes,
        upload_elapsed_seconds=upload_elapsed,
    )
