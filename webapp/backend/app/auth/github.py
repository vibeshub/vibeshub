from __future__ import annotations

from dataclasses import dataclass

import httpx


class GitHubAuthError(Exception):
    pass


class GitHubAPIError(Exception):
    pass


@dataclass(frozen=True)
class GitHubUser:
    login: str
    id: int


@dataclass(frozen=True)
class GitHubPull:
    number: int
    title: str
    author_login: str
    html_url: str
    repo_is_private: bool
    repo_full_name: str


class GitHubClient:
    def __init__(self, api_base: str, timeout: float = 10.0):
        self.api_base = api_base.rstrip("/")
        self.timeout = timeout

    def _headers(self, token: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    async def verify_token(self, token: str) -> GitHubUser:
        async with httpx.AsyncClient(timeout=self.timeout) as http:
            r = await http.get(f"{self.api_base}/user", headers=self._headers(token))
        if r.status_code == 401:
            raise GitHubAuthError("invalid token")
        if r.status_code >= 400:
            raise GitHubAPIError(f"unexpected {r.status_code} from /user")
        body = r.json()
        return GitHubUser(login=body["login"], id=body["id"])

    async def get_pull(
        self, token: str, owner: str, repo: str, number: int
    ) -> GitHubPull:
        url = f"{self.api_base}/repos/{owner}/{repo}/pulls/{number}"
        async with httpx.AsyncClient(timeout=self.timeout) as http:
            r = await http.get(url, headers=self._headers(token))
        if r.status_code == 404:
            raise GitHubAPIError("pr not found or not accessible")
        if r.status_code >= 400:
            raise GitHubAPIError(f"unexpected {r.status_code} from PR lookup")
        body = r.json()
        base_repo = body["base"]["repo"]
        return GitHubPull(
            number=body["number"],
            title=body.get("title") or "",
            author_login=body["user"]["login"],
            html_url=body["html_url"],
            repo_is_private=bool(base_repo.get("private", False)),
            repo_full_name=base_repo["full_name"],
        )
