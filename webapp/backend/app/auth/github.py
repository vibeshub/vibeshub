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


@dataclass(frozen=True)
class RepoPermission:
    permission: str  # "admin" | "write" | "read" | "none"

    @property
    def is_collaborator(self) -> bool:
        return self.permission != "none"


@dataclass(frozen=True)
class RepoInfo:
    full_name: str
    is_private: bool


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

    async def get_repo_permission(
        self, token: str, owner: str, repo: str, username: str
    ) -> RepoPermission:
        url = (
            f"{self.api_base}/repos/{owner}/{repo}"
            f"/collaborators/{username}/permission"
        )
        async with httpx.AsyncClient(timeout=self.timeout) as http:
            r = await http.get(url, headers=self._headers(token))
        if r.status_code == 404:
            raise GitHubAPIError("repo not found or not accessible")
        if r.status_code >= 400:
            raise GitHubAPIError(
                f"unexpected {r.status_code} from permission lookup"
            )
        body = r.json()
        return RepoPermission(permission=body.get("permission") or "none")

    async def get_repo(
        self, token: str, owner: str, repo: str
    ) -> RepoInfo:
        url = f"{self.api_base}/repos/{owner}/{repo}"
        async with httpx.AsyncClient(timeout=self.timeout) as http:
            r = await http.get(url, headers=self._headers(token))
        if r.status_code == 404:
            raise GitHubAPIError("repo not found or not accessible")
        if r.status_code >= 400:
            raise GitHubAPIError(f"unexpected {r.status_code} from repo lookup")
        body = r.json()
        return RepoInfo(
            full_name=body["full_name"],
            is_private=bool(body.get("private", False)),
        )
