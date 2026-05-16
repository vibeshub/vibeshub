import json
from pathlib import Path
from unittest.mock import patch

import pytest

from vibeshub_client.pipeline import RunOptions, run_share_pipeline
from vibeshub_client.reader import TranscriptReader


class FakeReader(TranscriptReader):
    def __init__(self, path: Path):
        self.path = path

    def find_session(self, hook_input):
        return self.path

    def platform_id(self):
        return "fake"


class _FakeResponse:
    def __init__(self, status: int, body: bytes):
        self.status = status
        self._body = body

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.mark.asyncio
async def test_pipeline_happy_path(tmp_path: Path):
    transcript = tmp_path / "session.jsonl"
    transcript.write_text(
        '{"type":"user","message":{"role":"user","content":"hi"}}\n'
        '{"type":"assistant","message":{"role":"assistant","content":"hello"}}\n'
    )

    response = _FakeResponse(
        201,
        json.dumps(
            {
                "trace_id": "00000000-0000-0000-0000-000000000001",
                "short_id": "abc1234567",
                "trace_url": "https://vibeshub.test/alice/repo/pull/3/abc1234567",
            }
        ).encode("utf-8"),
    )

    posted: list[tuple[str, str]] = []

    def fake_post(*, pr_url: str, body: str) -> None:
        posted.append((pr_url, body))

    options = RunOptions(
        server_url="https://vibeshub.test",
        token="ghp_test",
        pr_url="https://github.com/alice/repo/pull/3",
    )
    reader = FakeReader(transcript)

    with patch("vibeshub_client.upload.urllib_request.urlopen", return_value=response), \
         patch("vibeshub_client.pipeline.post_pr_comment", side_effect=fake_post):
        result = await run_share_pipeline(reader=reader, hook_input={}, options=options)

    assert result.uploaded is True
    assert result.short_id == "abc1234567"
    assert result.skip_reason is None
    assert posted == [(
        "https://github.com/alice/repo/pull/3",
        f"Claude Code trace for this PR: https://vibeshub.test/alice/repo/pull/3/abc1234567\n\nUploaded by the PR author.",
    )]
    # Diagnostic fields surfaced so the hook can log them.
    assert result.payload_bytes is not None and result.payload_bytes > 0
    assert result.upload_elapsed_seconds is not None
    assert result.upload_elapsed_seconds >= 0


@pytest.mark.asyncio
async def test_pipeline_reports_diagnostics_on_upload_failure(tmp_path: Path):
    """Even when upload fails, payload_bytes and upload_elapsed_seconds
    should be populated so we can diagnose timeouts after the fact."""
    from urllib import error as urllib_error
    transcript = tmp_path / "session.jsonl"
    transcript.write_text('{"type":"user","message":{"role":"user","content":"hi"}}\n')

    def raise_timeout(req, timeout=None):
        raise urllib_error.URLError("timed out")

    options = RunOptions(
        server_url="https://vibeshub.test",
        token="ghp_test",
        pr_url="https://github.com/alice/repo/pull/3",
    )
    reader = FakeReader(transcript)

    with patch("vibeshub_client.upload.urllib_request.urlopen", side_effect=raise_timeout):
        result = await run_share_pipeline(reader=reader, hook_input={}, options=options)

    assert result.uploaded is False
    assert "upload failed" in (result.skip_reason or "")
    assert result.payload_bytes is not None and result.payload_bytes > 0
    assert result.upload_elapsed_seconds is not None
    assert result.upload_elapsed_seconds >= 0
