from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.settings import Settings


class _MissingAzureSDK(Exception):
    """Sentinel used when azure-storage-blob isn't installed."""


try:
    from azure.core.exceptions import ResourceNotFoundError as _AzureNotFound
except ImportError:
    _AzureNotFound = _MissingAzureSDK  # type: ignore[misc,assignment]


class BlobStore(ABC):
    @abstractmethod
    async def put(self, key: str, data: bytes) -> None: ...

    @abstractmethod
    async def get(self, key: str) -> bytes: ...

    @abstractmethod
    async def delete(self, key: str) -> None: ...

    async def smoke_check(self) -> None:
        """Verify the backend is reachable. Default is a no-op; backends
        backed by external services (e.g. Azure Blob) override this to issue
        a cheap reachability call so misconfigurations surface at startup."""
        return


def _safe_join(root: Path, key: str) -> Path:
    target = (root / key).resolve()
    root_resolved = root.resolve()
    if root_resolved not in target.parents and target != root_resolved:
        raise ValueError(f"key {key!r} escapes blob root")
    return target


class LocalDirBlobStore(BlobStore):
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    async def put(self, key: str, data: bytes) -> None:
        target = _safe_join(self.root, key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    async def get(self, key: str) -> bytes:
        target = _safe_join(self.root, key)
        if not target.exists():
            raise FileNotFoundError(key)
        return target.read_bytes()

    async def delete(self, key: str) -> None:
        target = _safe_join(self.root, key)
        if target.exists():
            target.unlink()


class AzureBlobStore(BlobStore):
    def __init__(self, container_client: Any):
        self._container = container_client

    async def put(self, key: str, data: bytes) -> None:
        await self._container.upload_blob(name=key, data=data, overwrite=True)

    async def get(self, key: str) -> bytes:
        try:
            stream = await self._container.download_blob(key)
        except _AzureNotFound as e:
            raise FileNotFoundError(key) from e
        return await stream.readall()

    async def delete(self, key: str) -> None:
        try:
            await self._container.delete_blob(key)
        except _AzureNotFound:
            return

    async def smoke_check(self) -> None:
        await self._container.get_container_properties()


def make_azure_blob_store(settings: "Settings") -> AzureBlobStore:
    if not settings.azure_blob_container:
        raise ValueError("VIBESHUB_AZURE_BLOB_CONTAINER must be set")
    from azure.storage.blob.aio import BlobServiceClient

    if settings.azure_storage_account_url:
        from azure.identity.aio import DefaultAzureCredential

        service = BlobServiceClient(
            account_url=settings.azure_storage_account_url,
            credential=DefaultAzureCredential(),
        )
    elif settings.azure_storage_connection_string:
        service = BlobServiceClient.from_connection_string(
            settings.azure_storage_connection_string
        )
    else:
        raise ValueError(
            "Set VIBESHUB_AZURE_STORAGE_ACCOUNT_URL (managed identity) or "
            "VIBESHUB_AZURE_STORAGE_CONNECTION_STRING (local/dev) to use Azure Blob storage"
        )
    return AzureBlobStore(service.get_container_client(settings.azure_blob_container))
