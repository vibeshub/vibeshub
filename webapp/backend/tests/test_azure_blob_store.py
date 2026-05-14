from unittest.mock import AsyncMock, MagicMock

import pytest

pytest.importorskip("azure.storage.blob")

from azure.core.exceptions import ResourceNotFoundError

from app.settings import Settings
from app.storage.blob import AzureBlobStore, make_azure_blob_store


@pytest.fixture
def container_client() -> MagicMock:
    return MagicMock()


@pytest.fixture
def store(container_client: MagicMock) -> AzureBlobStore:
    return AzureBlobStore(container_client)


@pytest.mark.asyncio
async def test_put_uploads_blob_with_overwrite(store, container_client):
    container_client.upload_blob = AsyncMock()
    await store.put("traces/abc.jsonl", b"hello\nworld\n")
    container_client.upload_blob.assert_awaited_once_with(
        name="traces/abc.jsonl", data=b"hello\nworld\n", overwrite=True
    )


@pytest.mark.asyncio
async def test_get_returns_downloaded_bytes(store, container_client):
    stream = MagicMock()
    stream.readall = AsyncMock(return_value=b"hello\nworld\n")
    container_client.download_blob = AsyncMock(return_value=stream)
    data = await store.get("traces/abc.jsonl")
    assert data == b"hello\nworld\n"
    container_client.download_blob.assert_awaited_once_with("traces/abc.jsonl")


@pytest.mark.asyncio
async def test_get_missing_raises_file_not_found(store, container_client):
    container_client.download_blob = AsyncMock(
        side_effect=ResourceNotFoundError("nope")
    )
    with pytest.raises(FileNotFoundError) as exc_info:
        await store.get("traces/missing.jsonl")
    assert "traces/missing.jsonl" in str(exc_info.value)


@pytest.mark.asyncio
async def test_delete_removes_blob(store, container_client):
    container_client.delete_blob = AsyncMock()
    await store.delete("traces/abc.jsonl")
    container_client.delete_blob.assert_awaited_once_with("traces/abc.jsonl")


@pytest.mark.asyncio
async def test_delete_missing_is_noop(store, container_client):
    container_client.delete_blob = AsyncMock(
        side_effect=ResourceNotFoundError("nope")
    )
    await store.delete("traces/missing.jsonl")


def test_factory_requires_container_name():
    settings = Settings(azure_storage_connection_string="x")
    with pytest.raises(ValueError, match="AZURE_BLOB_CONTAINER"):
        make_azure_blob_store(settings)


def test_factory_requires_auth_method():
    settings = Settings(azure_blob_container="traces")
    with pytest.raises(ValueError, match="ACCOUNT_URL.*CONNECTION_STRING"):
        make_azure_blob_store(settings)
