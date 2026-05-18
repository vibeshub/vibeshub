from __future__ import annotations

import asyncio
import logging
from collections import OrderedDict
from dataclasses import dataclass
from time import monotonic
from typing import Any, FrozenSet, Optional, Tuple

import httpx


log = logging.getLogger(__name__)


class GitHubAuthError(Exception):
    """No token configured, or upstream returned 401."""


class GitHubNotFound(Exception):
    pass


class GitHubRateLimited(Exception):
    def __init__(self, *, reset_at_epoch: int):
        super().__init__("rate limited")
        self.reset_at_epoch = reset_at_epoch


class GitHubUpstreamError(Exception):
    def __init__(self, status: int, body: str = ""):
        super().__init__(f"upstream {status}")
        self.status = status
        self.body = body


CacheKey = Tuple[str, FrozenSet[Tuple[str, str]]]


@dataclass
class _Entry:
    etag: Optional[str]
    payload: Any
    expires_at: float  # monotonic seconds
    link: Optional[str]


class PublicGitHubClient:
    def __init__(
        self,
        api_base: str,
        *,
        fallback_token: str,
        ttl_seconds: int = 60,
        max_entries: int = 512,
        timeout: float = 10.0,
    ) -> None:
        self._api_base = api_base.rstrip("/")
        self._fallback_token = fallback_token
        self._ttl = ttl_seconds
        self._max_entries = max_entries
        self._timeout = timeout
        self._cache: OrderedDict[CacheKey, _Entry] = OrderedDict()
        self._locks: dict[CacheKey, asyncio.Lock] = {}

    def cache_size(self) -> int:
        return len(self._cache)

    async def get_json(
        self,
        path: str,
        *,
        viewer_token: str | None,
        params: dict | None = None,
    ) -> Any:
        body, _ = await self._get(path, viewer_token=viewer_token, params=params)
        return body

    async def get_json_with_link(
        self,
        path: str,
        *,
        viewer_token: str | None,
        params: dict | None = None,
    ) -> tuple[Any, Optional[str]]:
        return await self._get(path, viewer_token=viewer_token, params=params)

    # --- internals --------------------------------------------------------

    def _key(self, path: str, params: dict | None) -> CacheKey:
        items = frozenset((k, str(v)) for k, v in (params or {}).items())
        return (path, items)

    def _select_token(self, viewer_token: str | None) -> str:
        token = viewer_token or self._fallback_token
        if not token:
            raise GitHubAuthError("no token configured")
        return token

    async def _get(
        self,
        path: str,
        *,
        viewer_token: str | None,
        params: dict | None,
    ) -> tuple[Any, Optional[str]]:
        token = self._select_token(viewer_token)
        key = self._key(path, params)
        now = monotonic()

        cached = self._cache.get(key)
        if cached is not None and cached.expires_at > now:
            self._cache.move_to_end(key)
            log.info(
                "github.public_client path=%s cache_state=hit source=cache", path
            )
            return cached.payload, cached.link

        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            # Recheck after acquiring (someone else may have refreshed).
            cached = self._cache.get(key)
            now = monotonic()
            if cached is not None and cached.expires_at > now:
                self._cache.move_to_end(key)
                log.info(
                    "github.public_client path=%s cache_state=hit source=cache",
                    path,
                )
                return cached.payload, cached.link

            cache_state = "stale" if cached else "miss"
            log.info(
                "github.public_client path=%s cache_state=%s source=network",
                path, cache_state,
            )

            headers = {
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }
            if cached and cached.etag:
                headers["If-None-Match"] = cached.etag

            try:
                async with httpx.AsyncClient(timeout=self._timeout) as http:
                    resp = await http.get(
                        f"{self._api_base}{path}",
                        params=params,
                        headers=headers,
                    )
            except httpx.HTTPError as exc:
                raise GitHubUpstreamError(0, str(exc)) from exc

            if resp.status_code == 304 and cached is not None:
                cached.expires_at = monotonic() + self._ttl
                self._cache.move_to_end(key)
                return cached.payload, cached.link

            if resp.status_code == 200:
                payload = resp.json()
                entry = _Entry(
                    etag=resp.headers.get("ETag"),
                    payload=payload,
                    expires_at=monotonic() + self._ttl,
                    link=resp.headers.get("Link"),
                )
                self._cache[key] = entry
                self._cache.move_to_end(key)
                while len(self._cache) > self._max_entries:
                    self._cache.popitem(last=False)
                return payload, entry.link

            if resp.status_code == 401:
                raise GitHubAuthError("upstream 401")
            if resp.status_code == 404:
                raise GitHubNotFound(path)
            if resp.status_code == 403 and resp.headers.get(
                "X-RateLimit-Remaining"
            ) == "0":
                reset = int(resp.headers.get("X-RateLimit-Reset", "0"))
                raise GitHubRateLimited(reset_at_epoch=reset)
            raise GitHubUpstreamError(resp.status_code, resp.text)
