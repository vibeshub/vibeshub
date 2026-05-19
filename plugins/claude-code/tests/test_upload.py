import io
import json
from unittest.mock import patch
from urllib import error as urllib_error

import pytest

from vibeshub_client.upload import UploadError, upload_bundle


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
async def test_upload_success_sends_tar_and_headers():
    captured: dict = {}

    def fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["headers"] = dict(req.header_items())
        captured["body"] = req.data
        captured["timeout"] = timeout
        return _ok_response()

    with patch("vibeshub_client.upload.urllib_request.urlopen", side_effect=fake_urlopen):
        result = await upload_bundle(
            server_url="https://vibeshub.test",
            token="ghp_test",
            tar_bytes=b"\x1f\x8b\x08\x00fake-tar-bytes",
            pr_url="https://github.com/alice/repo/pull/3",
            plugin_version="0.2.0",
            session_id="abc",
            redaction_count_client=2,
        )

    assert result.short_id == "abc1234567"
    assert result.trace_url.endswith("abc1234567")
    assert captured["url"] == "https://vibeshub.test/api/ingest"
    # urllib title-cases header names
    headers = captured["headers"]
    assert headers["Authorization"] == "Bearer ghp_test"
    assert headers["Content-type"] == "application/x-tar"
    assert headers["X-vibeshub-pr-url"] == "https://github.com/alice/repo/pull/3"
    assert headers["X-vibeshub-platform"] == "claude-code"
    assert headers["X-vibeshub-plugin-version"] == "0.2.0"
    assert headers["X-vibeshub-client-redactions"] == "2"
    assert headers["X-vibeshub-session-id"] == "abc"
    # Body is the tar bytes verbatim.
    assert captured["body"] == b"\x1f\x8b\x08\x00fake-tar-bytes"


@pytest.mark.asyncio
async def test_upload_omits_session_header_when_none():
    captured: dict = {}

    def fake_urlopen(req, timeout=None):
        captured["headers"] = dict(req.header_items())
        return _ok_response()

    with patch("vibeshub_client.upload.urllib_request.urlopen", side_effect=fake_urlopen):
        await upload_bundle(
            server_url="https://vibeshub.test",
            token="ghp_test",
            tar_bytes=b"tar",
            pr_url="https://github.com/alice/repo/pull/3",
            plugin_version="0.2.0",
            session_id=None,
            redaction_count_client=0,
        )

    assert "X-vibeshub-session-id" not in captured["headers"]


@pytest.mark.asyncio
async def test_upload_default_timeout_is_60s():
    """Default socket-read timeout must be 60s so it doesn't starve the
    server's worst-case happy path (two sequential GitHub calls @ 10s
    each + blob put + DB commit). See plugins/claude-code investigation
    of the 30s read-timeout incident."""
    captured: dict = {}

    def fake_urlopen(req, timeout=None):
        captured["timeout"] = timeout
        return _ok_response()

    with patch("vibeshub_client.upload.urllib_request.urlopen", side_effect=fake_urlopen):
        await upload_bundle(
            server_url="https://vibeshub.test",
            token="ghp_test",
            tar_bytes=b"tar",
            pr_url="https://github.com/alice/repo/pull/3",
            plugin_version="0.2.0",
            session_id=None,
            redaction_count_client=0,
        )

    assert captured["timeout"] == 60.0


@pytest.mark.asyncio
async def test_upload_401_raises_unauthorized():
    with patch(
        "vibeshub_client.upload.urllib_request.urlopen",
        side_effect=_http_error(401, b'{"detail":"x"}'),
    ):
        with pytest.raises(UploadError) as exc:
            await upload_bundle(
                server_url="https://vibeshub.test",
                token="bad",
                tar_bytes=b"tar",
                pr_url="https://github.com/alice/repo/pull/3",
                plugin_version="0.2.0",
                session_id=None,
                redaction_count_client=0,
            )

    assert "401" in str(exc.value)


@pytest.mark.asyncio
async def test_upload_5xx_raises_server_error():
    with patch(
        "vibeshub_client.upload.urllib_request.urlopen",
        side_effect=_http_error(503),
    ):
        with pytest.raises(UploadError):
            await upload_bundle(
                server_url="https://vibeshub.test",
                token="ghp_test",
                tar_bytes=b"tar",
                pr_url="https://github.com/alice/repo/pull/3",
                plugin_version="0.2.0",
                session_id=None,
                redaction_count_client=0,
            )
