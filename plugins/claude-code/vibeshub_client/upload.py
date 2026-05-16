from __future__ import annotations

import asyncio
import json
from dataclasses import asdict, dataclass
from urllib import error as urllib_error
from urllib import request as urllib_request


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


def _post_json(url: str, *, headers: dict, body: bytes, timeout: float) -> tuple[int, bytes]:
    req = urllib_request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib_request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib_error.HTTPError as e:
        # Non-2xx response: surface status + body so the caller can format an error.
        return e.code, e.read()
    except (urllib_error.URLError, TimeoutError, OSError) as e:
        raise UploadError(f"network error: {e}") from e


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
    body = json.dumps(asdict(payload)).encode("utf-8")

    status, raw = await asyncio.to_thread(
        _post_json, url, headers=headers, body=body, timeout=timeout
    )

    if status != 201:
        text = raw.decode("utf-8", errors="replace")
        raise UploadError(f"upload failed: {status} {text}")

    data = json.loads(raw.decode("utf-8"))
    return UploadResult(
        trace_id=data["trace_id"],
        short_id=data["short_id"],
        trace_url=data["trace_url"],
    )
