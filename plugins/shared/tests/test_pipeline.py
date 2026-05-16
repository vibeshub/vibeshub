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
async def test_pipeline_skips_when_user_declines(tmp_path: Path, monkeypatch):
    transcript = tmp_path / "session.jsonl"
    transcript.write_text("{}\n")
    monkeypatch.delenv("VIBESHUB_AUTO_YES", raising=False)
    monkeypatch.delenv("VIBESHUB_AUTO_NO", raising=False)

    options = RunOptions(
        server_url="https://vibeshub.test",
        token="ghp_test",
        pr_url="https://github.com/alice/repo/pull/3",
        confirm=True,
    )
    reader = FakeReader(transcript)

    with patch(
        "vibeshub_client.pipeline.has_interactive_tty", return_value=True
    ), patch(
        "vibeshub_client.pipeline.confirm_via_tty", return_value=False
    ):
        result = await run_share_pipeline(reader=reader, hook_input={}, options=options)

    assert result.uploaded is False
    assert result.skip_reason == "user declined"


@pytest.mark.asyncio
async def test_pipeline_auto_shares_when_no_tty(
    tmp_path: Path, respx_mock: respx.MockRouter, monkeypatch
):
    """When /dev/tty is unavailable, the pipeline should auto-share and note it
    in the success result rather than falsely reporting 'user declined'."""
    transcript = tmp_path / "session.jsonl"
    transcript.write_text(
        '{"type":"user","message":{"role":"user","content":"hi"}}\n'
    )
    monkeypatch.delenv("VIBESHUB_AUTO_YES", raising=False)
    monkeypatch.delenv("VIBESHUB_AUTO_NO", raising=False)

    respx_mock.post("https://vibeshub.test/api/ingest").respond(
        201,
        json={
            "trace_id": "00000000-0000-0000-0000-000000000002",
            "short_id": "def4567890",
            "trace_url": "https://vibeshub.test/alice/repo/pull/3/def4567890",
        },
    )

    options = RunOptions(
        server_url="https://vibeshub.test",
        token="ghp_test",
        pr_url="https://github.com/alice/repo/pull/3",
        confirm=True,
    )
    reader = FakeReader(transcript)

    with patch(
        "vibeshub_client.pipeline.has_interactive_tty", return_value=False
    ), patch(
        "vibeshub_client.pipeline.post_pr_comment"
    ):
        result = await run_share_pipeline(reader=reader, hook_input={}, options=options)

    assert result.uploaded is True
    assert result.skip_reason == "no interactive terminal, auto-shared"


@pytest.mark.asyncio
async def test_pipeline_skips_when_auto_no_env_set(
    tmp_path: Path, monkeypatch
):
    transcript = tmp_path / "session.jsonl"
    transcript.write_text("{}\n")
    monkeypatch.setenv("VIBESHUB_AUTO_NO", "1")

    options = RunOptions(
        server_url="https://vibeshub.test",
        token="ghp_test",
        pr_url="https://github.com/alice/repo/pull/3",
        confirm=True,
    )
    reader = FakeReader(transcript)

    # has_interactive_tty must not be consulted — auto-no wins.
    with patch(
        "vibeshub_client.pipeline.has_interactive_tty"
    ) as mock_has_tty, patch(
        "vibeshub_client.pipeline.confirm_via_tty"
    ) as mock_confirm:
        result = await run_share_pipeline(reader=reader, hook_input={}, options=options)

    assert result.uploaded is False
    assert result.skip_reason == "VIBESHUB_AUTO_NO=1"
    mock_has_tty.assert_not_called()
    mock_confirm.assert_not_called()


@pytest.mark.asyncio
async def test_pipeline_skips_prompt_when_auto_yes_env_set(
    tmp_path: Path, respx_mock: respx.MockRouter, monkeypatch
):
    """VIBESHUB_AUTO_YES=1 should proceed without prompting even when caller
    passed confirm=True (defense-in-depth — the hook also sets confirm=False
    in this case, but the pipeline should honor the env independently)."""
    transcript = tmp_path / "session.jsonl"
    transcript.write_text(
        '{"type":"user","message":{"role":"user","content":"hi"}}\n'
    )
    monkeypatch.setenv("VIBESHUB_AUTO_YES", "1")
    monkeypatch.delenv("VIBESHUB_AUTO_NO", raising=False)

    respx_mock.post("https://vibeshub.test/api/ingest").respond(
        201,
        json={
            "trace_id": "00000000-0000-0000-0000-000000000003",
            "short_id": "ghi7890123",
            "trace_url": "https://vibeshub.test/alice/repo/pull/3/ghi7890123",
        },
    )

    options = RunOptions(
        server_url="https://vibeshub.test",
        token="ghp_test",
        pr_url="https://github.com/alice/repo/pull/3",
        confirm=True,
    )
    reader = FakeReader(transcript)

    with patch(
        "vibeshub_client.pipeline.confirm_via_tty"
    ) as mock_confirm, patch(
        "vibeshub_client.pipeline.post_pr_comment"
    ):
        result = await run_share_pipeline(reader=reader, hook_input={}, options=options)

    assert result.uploaded is True
    assert result.skip_reason is None
    mock_confirm.assert_not_called()
