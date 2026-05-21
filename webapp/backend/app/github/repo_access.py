from __future__ import annotations

import uuid
from time import monotonic

import httpx


class RepoAccessError(Exception):
    """GitHub returned an unexpected status while checking repo access."""


class RepoAccessChecker:
    """Decides whether a viewer may read a GitHub repo, by asking GitHub.

    Calls `GET /repos/{owner}/{repo}` with the viewer's own OAuth token:
    200 means the viewer can read the repo, 404 means they cannot (GitHub
    returns 404 — not 403 — for private repos the caller can't see).

    Results are cached per `(user_id, repo_full_name)` with a short TTL. The
    cache is deliberately keyed by user, never shared across viewers — a
    private 200 must never be served to a different viewer.
    """

    def __init__(
        self,
        api_base: str,
        *,
        ttl_seconds: int = 60,
        timeout: float = 10.0,
    ) -> None:
        self._api_base = api_base.rstrip("/")
        self._ttl = ttl_seconds
        self._timeout = timeout
        self._cache: dict[tuple[uuid.UUID, str], tuple[bool, float]] = {}

    def cache_size(self) -> int:
        return len(self._cache)

    async def can_read(
        self, user_id: uuid.UUID, token: str, repo_full_name: str
    ) -> bool:
        key = (user_id, repo_full_name)
        now = monotonic()
        cached = self._cache.get(key)
        if cached is not None and cached[1] > now:
            return cached[0]

        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        url = f"{self._api_base}/repos/{repo_full_name}"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as http:
                resp = await http.get(url, headers=headers)
        except httpx.HTTPError as exc:
            raise RepoAccessError(str(exc)) from exc

        if resp.status_code == 200:
            allowed = True
        elif resp.status_code == 404:
            allowed = False
        else:
            # 401 (bad token), 403 (rate limited), 5xx — do not cache;
            # surface so the caller can return a clear upstream error.
            raise RepoAccessError(
                f"unexpected {resp.status_code} from repo lookup"
            )

        self._cache[key] = (allowed, now + self._ttl)
        return allowed
