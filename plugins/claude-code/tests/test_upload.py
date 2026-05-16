import io
import json
from unittest.mock import patch
from urllib import error as urllib_error

import pytest

from vibeshub_client.upload import IngestPayload, UploadError, upload_trace


class _FakeResponse:
    def __init__(self, *, status: int, body: bytes):
        self.status = status
        self._body = body

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _ok_response() -> _FakeResponse:
    return _FakeResponse(
        status=201,
        body=json.dumps(
            {
                "trace_id": "00000000-0000-0000-0000-000000000001",
                "short_id": "abc1234567",
                "trace_url": "https://vibeshub.test/alice/repo/pull/3/abc1234567",
            }
        ).encode("utf-8"),
    )


def _http_error(code: int, body: bytes = b"") -> urllib_error.HTTPError:
    return urllib_error.HTTPError(
        url="https://vibeshub.test/api/ingest",
        code=code,
        msg="error",
        hdrs=None,
        fp=io.BytesIO(body),
    )


@pytest.mark.asyncio
async def test_upload_success():
    payload = IngestPayload(
        transcript_jsonl="{}\n",
        pr_url="https://github.com/alice/repo/pull/3",
        platform="claude-code",
        plugin_version="0.1.0",
        session_id="abc",
        redaction_count_client=0,
    )

    captured: dict = {}

    def fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["headers"] = dict(req.header_items())
        captured["body"] = req.data
        captured["timeout"] = timeout
        return _ok_response()

    with patch("vibeshub_client.upload.urllib_request.urlopen", side_effect=fake_urlopen):
        result = await upload_trace(
            server_url="https://vibeshub.test",
            token="ghp_test",
            payload=payload,
        )

    assert result.short_id == "abc1234567"
    assert result.trace_url.endswith("abc1234567")
    assert captured["url"] == "https://vibeshub.test/api/ingest"
    # urllib title-cases header names
    assert captured["headers"]["Authorization"] == "Bearer ghp_test"
    assert json.loads(captured["body"])["pr_url"] == "https://github.com/alice/repo/pull/3"


@pytest.mark.asyncio
async def test_upload_default_timeout_is_60s():
    """Default socket-read timeout must be 60s so it doesn't starve the
    server's worst-case happy path (two sequential GitHub calls @ 10s
    each + blob put + DB commit). See plugins/claude-code investigation
    of the 30s read-timeout incident."""
    payload = IngestPayload(
        transcript_jsonl="{}\n",
        pr_url="https://github.com/alice/repo/pull/3",
        platform="claude-code",
    )

    captured: dict = {}

    def fake_urlopen(req, timeout=None):
        captured["timeout"] = timeout
        return _ok_response()

    with patch("vibeshub_client.upload.urllib_request.urlopen", side_effect=fake_urlopen):
        await upload_trace(
            server_url="https://vibeshub.test",
            token="ghp_test",
            payload=payload,
        )

    assert captured["timeout"] == 60.0


@pytest.mark.asyncio
async def test_upload_401_raises_unauthorized():
    payload = IngestPayload(
        transcript_jsonl="{}\n",
        pr_url="https://github.com/alice/repo/pull/3",
        platform="claude-code",
    )

    with patch(
        "vibeshub_client.upload.urllib_request.urlopen",
        side_effect=_http_error(401, b'{"detail":"x"}'),
    ):
        with pytest.raises(UploadError) as exc:
            await upload_trace(
                server_url="https://vibeshub.test",
                token="bad",
                payload=payload,
            )

    assert "401" in str(exc.value)


@pytest.mark.asyncio
async def test_upload_5xx_raises_server_error():
    payload = IngestPayload(
        transcript_jsonl="{}\n",
        pr_url="https://github.com/alice/repo/pull/3",
        platform="claude-code",
    )

    with patch(
        "vibeshub_client.upload.urllib_request.urlopen",
        side_effect=_http_error(503),
    ):
        with pytest.raises(UploadError):
            await upload_trace(
                server_url="https://vibeshub.test",
                token="ghp_test",
                payload=payload,
            )
