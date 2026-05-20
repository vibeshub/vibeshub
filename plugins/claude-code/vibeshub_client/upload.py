from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from urllib import error as urllib_error
from urllib import request as urllib_request


class UploadError(Exception):
    pass


@dataclass
class UploadResult:
    trace_id: str
    short_id: str
    trace_url: str


def _post_bytes(
    url: str, *, headers: dict, body: bytes, timeout: float,
) -> tuple[int, bytes]:
    req = urllib_request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib_request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib_error.HTTPError as e:
        # Non-2xx response: surface status + body so the caller can format an error.
        return e.code, e.read()
    except (urllib_error.URLError, TimeoutError, OSError) as e:
        raise UploadError(f"network error: {e}") from e


async def upload_bundle(
    *,
    server_url: str,
    token: str,
    tar_bytes: bytes,
    pr_url: str,
    plugin_version: str,
    session_id: str | None,
    redaction_count_client: int,
    timeout: float = 60.0,
) -> UploadResult:
    url = f"{server_url.rstrip('/')}/api/ingest"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/x-tar",
        "X-Vibeshub-Pr-Url": pr_url,
        "X-Vibeshub-Platform": "claude-code",
        "X-Vibeshub-Plugin-Version": plugin_version,
        "X-Vibeshub-Client-Redactions": str(redaction_count_client),
    }
    if session_id:
        headers["X-Vibeshub-Session-Id"] = session_id

    status, raw = await asyncio.to_thread(
        _post_bytes, url, headers=headers, body=tar_bytes, timeout=timeout,
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
