from __future__ import annotations

from dataclasses import asdict, dataclass

import httpx


class UploadError(Exception):
    pass


@dataclass
class IngestPayload:
    transcript_jsonl: str
    pr_url: str
    platform: str = "claude-code"
    plugin_version: str | None = None
    session_id: str | None = None
    redaction_count_client: int = 0


@dataclass
class UploadResult:
    trace_id: str
    short_id: str
    trace_url: str


async def upload_trace(
    *,
    server_url: str,
    token: str,
    payload: IngestPayload,
    timeout: float = 30.0,
) -> UploadResult:
    url = f"{server_url.rstrip('/')}/api/ingest"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.post(url, json=asdict(payload), headers=headers)
        except httpx.HTTPError as e:
            raise UploadError(f"network error: {e}") from e

    if response.status_code != 201:
        raise UploadError(
            f"upload failed: {response.status_code} {response.text}"
        )

    body = response.json()
    return UploadResult(
        trace_id=body["trace_id"],
        short_id=body["short_id"],
        trace_url=body["trace_url"],
    )
