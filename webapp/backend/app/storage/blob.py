from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path


class BlobStore(ABC):
    @abstractmethod
    async def put(self, key: str, data: bytes) -> None: ...

    @abstractmethod
    async def get(self, key: str) -> bytes: ...

    @abstractmethod
    async def delete(self, key: str) -> None: ...


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
