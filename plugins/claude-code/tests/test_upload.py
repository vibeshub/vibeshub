import pytest
import respx

from vibeshub_client.upload import IngestPayload, UploadError, upload_trace


@pytest.mark.asyncio
async def test_upload_success(respx_mock: respx.MockRouter):
    respx_mock.post("https://vibeshub.test/api/ingest").respond(
        201,
        json={
            "trace_id": "00000000-0000-0000-0000-000000000001",
            "short_id": "abc1234567",
            "trace_url": "https://vibeshub.test/alice/repo/pull/3/abc1234567",
        },
    )
    payload = IngestPayload(
        transcript_jsonl="{}\n",
        pr_url="https://github.com/alice/repo/pull/3",
        platform="claude-code",
        plugin_version="0.1.0",
        session_id="abc",
        redaction_count_client=0,
    )
    result = await upload_trace(
        server_url="https://vibeshub.test",
        token="ghp_test",
        payload=payload,
    )
    assert result.short_id == "abc1234567"
    assert result.trace_url.endswith("abc1234567")


@pytest.mark.asyncio
async def test_upload_401_raises_unauthorized(respx_mock: respx.MockRouter):
    respx_mock.post("https://vibeshub.test/api/ingest").respond(401, json={"detail": "x"})
    payload = IngestPayload(
        transcript_jsonl="{}\n",
        pr_url="https://github.com/alice/repo/pull/3",
        platform="claude-code",
    )
    with pytest.raises(UploadError) as exc:
        await upload_trace(
            server_url="https://vibeshub.test",
            token="bad",
            payload=payload,
        )
    assert "401" in str(exc.value)


@pytest.mark.asyncio
async def test_upload_5xx_raises_server_error(respx_mock: respx.MockRouter):
    respx_mock.post("https://vibeshub.test/api/ingest").respond(503)
    payload = IngestPayload(
        transcript_jsonl="{}\n",
        pr_url="https://github.com/alice/repo/pull/3",
        platform="claude-code",
    )
    with pytest.raises(UploadError):
        await upload_trace(
            server_url="https://vibeshub.test",
            token="ghp_test",
            payload=payload,
        )
