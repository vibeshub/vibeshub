from pathlib import Path
from unittest.mock import patch

import pytest
import respx

from vibeshub_client.pipeline import RunOptions, run_share_pipeline
from vibeshub_client.reader import TranscriptReader


class FakeReader(TranscriptReader):
    def __init__(self, path: Path):
        self.path = path

    def find_session(self, hook_input):
        return self.path

    def platform_id(self):
        return "fake"


@pytest.mark.asyncio
async def test_pipeline_happy_path(tmp_path: Path, respx_mock: respx.MockRouter):
    transcript = tmp_path / "session.jsonl"
    transcript.write_text(
        '{"type":"user","message":{"role":"user","content":"hi"}}\n'
        '{"type":"assistant","message":{"role":"assistant","content":"hello"}}\n'
    )

    respx_mock.post("https://vibeshub.test/api/ingest").respond(
        201,
        json={
            "trace_id": "00000000-0000-0000-0000-000000000001",
            "short_id": "abc1234567",
            "trace_url": "https://vibeshub.test/alice/repo/pull/3/abc1234567",
        },
    )

    posted: list[tuple[str, str]] = []

    def fake_post(*, pr_url: str, body: str) -> None:
        posted.append((pr_url, body))

    options = RunOptions(
        server_url="https://vibeshub.test",
        token="ghp_test",
        pr_url="https://github.com/alice/repo/pull/3",
        confirm=False,  # bypass /dev/tty in tests
    )
    reader = FakeReader(transcript)

    with patch("vibeshub_client.pipeline.post_pr_comment", side_effect=fake_post):
        result = await run_share_pipeline(reader=reader, hook_input={}, options=options)

    assert result.uploaded is True
    assert result.short_id == "abc1234567"
    assert posted == [(
        "https://github.com/alice/repo/pull/3",
        f"Claude Code trace for this PR: https://vibeshub.test/alice/repo/pull/3/abc1234567\n\nUploaded by the PR author. Traces are public by default.",
    )]


@pytest.mark.asyncio
async def test_pipeline_skips_when_user_declines(tmp_path: Path):
    transcript = tmp_path / "session.jsonl"
    transcript.write_text("{}\n")

    options = RunOptions(
        server_url="https://vibeshub.test",
        token="ghp_test",
        pr_url="https://github.com/alice/repo/pull/3",
        confirm=True,
    )
    reader = FakeReader(transcript)

    with patch(
        "vibeshub_client.pipeline.confirm_via_tty", return_value=False
    ):
        result = await run_share_pipeline(reader=reader, hook_input={}, options=options)

    assert result.uploaded is False
    assert result.skip_reason == "user declined"
