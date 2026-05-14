from pathlib import Path

import pytest

from app.storage.blob import LocalDirBlobStore


@pytest.fixture
def blob_store(tmp_path: Path) -> LocalDirBlobStore:
    return LocalDirBlobStore(root=tmp_path)


@pytest.mark.asyncio
async def test_put_and_get_roundtrip(blob_store: LocalDirBlobStore):
    await blob_store.put("traces/abc.jsonl", b"hello\nworld\n")
    data = await blob_store.get("traces/abc.jsonl")
    assert data == b"hello\nworld\n"


@pytest.mark.asyncio
async def test_get_missing_raises(blob_store: LocalDirBlobStore):
    with pytest.raises(FileNotFoundError):
        await blob_store.get("traces/missing.jsonl")


@pytest.mark.asyncio
async def test_put_rejects_path_traversal(blob_store: LocalDirBlobStore):
    with pytest.raises(ValueError):
        await blob_store.put("../escape.jsonl", b"x")


@pytest.mark.asyncio
async def test_delete(blob_store: LocalDirBlobStore):
    await blob_store.put("traces/abc.jsonl", b"x")
    await blob_store.delete("traces/abc.jsonl")
    with pytest.raises(FileNotFoundError):
        await blob_store.get("traces/abc.jsonl")
