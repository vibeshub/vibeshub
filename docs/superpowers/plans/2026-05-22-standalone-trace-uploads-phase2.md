# Standalone Trace Uploads — Phase 2: Backend Endpoints — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the backend endpoints that let a trace exist without a PR — an optional-PR/optional-repo `/api/ingest`, a cookie-authed multipart `/api/uploads`, an owner-only `PATCH /api/traces/{short_id}`, and two GitHub picker endpoints — all converging on Phase 1's shared `create_or_update_trace` service.

**Architecture:** `/api/ingest` (CLI, tar + bearer token) and `/api/uploads` (web, multipart + session cookie) are separate FastAPI routers that each resolve an optional PR/repo association — verifying the uploader is the PR author or a repo collaborator via GitHub — then call the Phase-1 `create_or_update_trace(...)` service to write blobs and the `Trace` row. `PATCH /api/traces/{short_id}` re-runs that association check for edits. The GitHub picker router proxies the signed-in user's decrypted token to GitHub for repo/PR autocomplete. `GitHubClient` gains `get_repo_permission` and `get_repo` for the collaborator/visibility checks, and `app/redact/bundle.py` gains `unpack_loose_files` so the web path can redact loose files instead of a tar.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 async, pydantic v2, httpx, pytest + pytest-asyncio (`asyncio_mode = auto`), respx for GitHub HTTP mocking, `python-multipart` for multipart form parsing.

---

## File Structure

### Created

| Path | Responsibility |
|------|----------------|
| `webapp/backend/app/api/uploads.py` | `POST /api/uploads` — cookie-authed multipart web upload endpoint. |
| `webapp/backend/app/api/github_picker.py` | `/api/github` router with `GET /my-repos` and `GET /repo-prs` picker endpoints. |
| `webapp/backend/tests/test_uploads.py` | Tests for `/api/uploads`. |
| `webapp/backend/tests/test_traces_patch.py` | Tests for `PATCH /api/traces/{short_id}`. |
| `webapp/backend/tests/test_github_picker.py` | Tests for the picker endpoints. |
| `webapp/backend/tests/test_bundle_loose.py` | Tests for `unpack_loose_files`. |

### Modified

| Path | Responsibility |
|------|----------------|
| `webapp/backend/app/auth/github.py` | Add `RepoPermission` / `RepoInfo` dataclasses + `GitHubClient.get_repo_permission` and `get_repo`. |
| `webapp/backend/app/redact/bundle.py` | Add `unpack_loose_files(main_bytes, subagents_zip_bytes, *, max_total_bytes)` building an `UnpackedBundle` from loose files. |
| `webapp/backend/app/api/ingest.py` | Make `X-Vibeshub-Pr-Url` optional; add `X-Vibeshub-Repo`; resolve PR/repo/standalone; call `create_or_update_trace`; return `/t/<sid>` URL. |
| `webapp/backend/app/api/traces.py` | Add `PATCH /api/traces/{short_id}` with the `TracePatch` model + association re-check; rework `DELETE /api/traces/{short_id}` to accept bearer-token OR session-cookie auth. |
| `webapp/backend/app/main.py` | Register the `uploads` and `github_picker` routers. |
| `webapp/backend/tests/test_ingest.py` | Update for optional PR header + repo-only + standalone paths; `/t/` URL shape. |
| `webapp/backend/tests/test_traces.py` | Add dual-auth (bearer + cookie) delete tests for `DELETE /api/traces/{short_id}`. |
| `webapp/backend/pyproject.toml` | Add `python-multipart` to the `dev` extra. |

> **Phase 1 (already delivered, do not redefine):** `Trace.repo_full_name` / `pr_number` / `pr_url` are nullable; `TraceSummary` has nullable `repo_full_name` / `pr_number` / `pr_url`; `_require_trace_access` handles standalone-private; `app/api/trace_service.py` exports `TraceWriteResult` and `create_or_update_trace(...)` with the signature in the task contract. Tasks below **call** these.

---

## Shared helper used across tasks

Several endpoints need "given an optional `pr_url` / `repo_full_name` and a GitHub token, resolve the association metadata or raise 403". Task 4 builds this once as `resolve_association(...)` inside `app/api/trace_service.py` (alongside the Phase-1 service) so `/api/ingest`, `/api/uploads`, and `PATCH` all share it. Every later task imports it — do **not** duplicate the resolution logic.

---

### Task 1: `GitHubClient.get_repo_permission` and `get_repo`

**Files:**
- `webapp/backend/app/auth/github.py`
- `webapp/backend/tests/test_auth_github.py`

1. - [ ] **Step 1: Write a failing test for `get_repo_permission`.** Append to `webapp/backend/tests/test_auth_github.py`:
   ```python
   from app.auth.github import GitHubAPIError


   @pytest.mark.asyncio
   async def test_get_repo_permission_returns_permission(
       respx_mock: respx.MockRouter,
   ):
       respx_mock.get(
           "https://api.github.com/repos/alice/repo/collaborators/alice/permission"
       ).respond(200, json={"permission": "admin"})

       client = GitHubClient(api_base="https://api.github.com")
       perm = await client.get_repo_permission("ghp_test", "alice", "repo", "alice")

       assert perm.permission == "admin"
       assert perm.is_collaborator is True


   @pytest.mark.asyncio
   async def test_get_repo_permission_none_is_not_collaborator(
       respx_mock: respx.MockRouter,
   ):
       respx_mock.get(
           "https://api.github.com/repos/alice/repo/collaborators/bob/permission"
       ).respond(200, json={"permission": "none"})

       client = GitHubClient(api_base="https://api.github.com")
       perm = await client.get_repo_permission("ghp_test", "alice", "repo", "bob")

       assert perm.permission == "none"
       assert perm.is_collaborator is False


   @pytest.mark.asyncio
   async def test_get_repo_permission_404_raises(respx_mock: respx.MockRouter):
       respx_mock.get(
           "https://api.github.com/repos/alice/repo/collaborators/bob/permission"
       ).respond(404)

       client = GitHubClient(api_base="https://api.github.com")
       with pytest.raises(GitHubAPIError):
           await client.get_repo_permission("ghp_test", "alice", "repo", "bob")
   ```

2. - [ ] **Step 2: Run the test, see it fail.** Run:
   ```
   cd webapp/backend && python -m pytest tests/test_auth_github.py -q
   ```
   Expected: `AttributeError: 'GitHubClient' object has no attribute 'get_repo_permission'` (the three new tests error/fail).

3. - [ ] **Step 3: Implement `RepoPermission` + `get_repo_permission`.** In `webapp/backend/app/auth/github.py`, after the `GitHubPull` dataclass, add:
   ```python
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
   ```
   Then add this method to `GitHubClient` (after `get_pull`):
   ```python
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
   ```

4. - [ ] **Step 4: Run the test, see `get_repo_permission` tests pass.** Run:
   ```
   cd webapp/backend && python -m pytest tests/test_auth_github.py -q
   ```
   Expected: all `get_repo_permission` tests pass; `get_repo` tests not yet written.

5. - [ ] **Step 5: Write a failing test for `get_repo`.** Append to `webapp/backend/tests/test_auth_github.py`:
   ```python
   @pytest.mark.asyncio
   async def test_get_repo_returns_visibility(respx_mock: respx.MockRouter):
       respx_mock.get("https://api.github.com/repos/alice/repo").respond(
           200, json={"full_name": "alice/repo", "private": True}
       )

       client = GitHubClient(api_base="https://api.github.com")
       info = await client.get_repo("ghp_test", "alice", "repo")

       assert info.full_name == "alice/repo"
       assert info.is_private is True


   @pytest.mark.asyncio
   async def test_get_repo_404_raises(respx_mock: respx.MockRouter):
       respx_mock.get("https://api.github.com/repos/alice/repo").respond(404)

       client = GitHubClient(api_base="https://api.github.com")
       with pytest.raises(GitHubAPIError):
           await client.get_repo("ghp_test", "alice", "repo")
   ```

6. - [ ] **Step 6: Run the test, see it fail.** Run:
   ```
   cd webapp/backend && python -m pytest tests/test_auth_github.py -q -k get_repo
   ```
   Expected: `AttributeError: 'GitHubClient' object has no attribute 'get_repo'`.

7. - [ ] **Step 7: Implement `get_repo`.** Add this method to `GitHubClient` in `webapp/backend/app/auth/github.py` (after `get_repo_permission`):
   ```python
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
   ```

8. - [ ] **Step 8: Run the full file, see all pass.** Run:
   ```
   cd webapp/backend && python -m pytest tests/test_auth_github.py -q
   ```
   Expected: `7 passed`.

9. - [ ] **Step 9: Commit.** Run:
   ```
   cd webapp/backend && git add app/auth/github.py tests/test_auth_github.py && git commit -m "Add GitHubClient.get_repo_permission and get_repo

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
   ```

---

### Task 2: `unpack_loose_files` in `bundle.py`

The web path receives a loose `transcript` `.jsonl` plus an optional `subagents` `.zip`, not a tar. `unpack_loose_files` produces the same `UnpackedBundle` that `create_or_update_trace` expects, reusing the existing redact + meta-validation logic.

**Files:**
- `webapp/backend/app/redact/bundle.py`
- `webapp/backend/tests/test_bundle_loose.py`

1. - [ ] **Step 1: Write a failing test for the main-only case.** Create `webapp/backend/tests/test_bundle_loose.py`:
   ```python
   import io
   import json
   import zipfile

   import pytest

   from app.redact.bundle import unpack_loose_files, BundleError, BundleSizeError


   def _make_zip(members: dict[str, bytes]) -> bytes:
       buf = io.BytesIO()
       with zipfile.ZipFile(buf, mode="w") as zf:
           for name, data in members.items():
               zf.writestr(name, data)
       return buf.getvalue()


   def test_unpack_loose_main_only():
       result = unpack_loose_files(
           b'{"type":"user"}\n', None, max_total_bytes=10_000
       )
       assert result.main_bytes == b'{"type":"user"}\n'
       assert result.agents == []
       assert result.total_redactions == 0
   ```

2. - [ ] **Step 2: Run the test, see it fail.** Run:
   ```
   cd webapp/backend && python -m pytest tests/test_bundle_loose.py -q
   ```
   Expected: `ImportError: cannot import name 'unpack_loose_files'`.

3. - [ ] **Step 3: Implement `unpack_loose_files`.** Add `import zipfile` to the imports of `webapp/backend/app/redact/bundle.py`, then append this function:
   ```python
   def unpack_loose_files(
       main_bytes: bytes,
       subagents_zip_bytes: bytes | None,
       *,
       max_total_bytes: int,
   ) -> UnpackedBundle:
       """Build an UnpackedBundle from a loose transcript + optional subagent zip.

       Mirrors unpack_and_redact's validation and redaction, but the inputs are
       a raw main .jsonl and an optional .zip of agents/<id>.jsonl +
       agents/<id>.meta.json members (same layout as the tar bundle).
       """
       total_bytes = len(main_bytes)
       agent_jsonls: dict[str, bytes] = {}
       agent_metas: dict[str, bytes] = {}

       if subagents_zip_bytes is not None:
           try:
               zf = zipfile.ZipFile(io.BytesIO(subagents_zip_bytes))
           except zipfile.BadZipFile as e:
               raise BundleError(f"malformed zip: {e}")
           try:
               for info in zf.infolist():
                   if info.is_dir():
                       continue
                   name = info.filename
                   if (m := AGENT_JSONL_RE.match(name)):
                       agent_id = m.group(1)
                   elif (m := AGENT_META_RE.match(name)):
                       agent_id = m.group(1)
                   else:
                       raise BundleError(f"disallowed zip member: {name}")
                   total_bytes += info.file_size
                   if total_bytes > max_total_bytes:
                       raise BundleSizeError(
                           f"bundle size {total_bytes} exceeds limit "
                           f"{max_total_bytes}"
                       )
                   data = zf.read(info)
                   if AGENT_JSONL_RE.match(name):
                       agent_jsonls[agent_id] = data
                   else:
                       agent_metas[agent_id] = data
           finally:
               zf.close()

       if total_bytes > max_total_bytes:
           raise BundleSizeError(
               f"bundle size {total_bytes} exceeds limit {max_total_bytes}"
           )

       jsonl_ids = set(agent_jsonls.keys())
       meta_ids = set(agent_metas.keys())
       if jsonl_ids - meta_ids:
           missing = next(iter(jsonl_ids - meta_ids))
           raise BundleError(
               f"agent {missing}: jsonl present but meta.json missing"
           )
       if meta_ids - jsonl_ids:
           missing = next(iter(meta_ids - jsonl_ids))
           raise BundleError(
               f"agent {missing}: meta.json present but jsonl missing"
           )

       total_report = RedactionReport()
       redacted_main, main_report = redact_jsonl(main_bytes)
       for k, v in main_report.counts.items():
           total_report.counts[k] = total_report.counts.get(k, 0) + v

       agents: list[AgentPiece] = []
       for agent_id in sorted(jsonl_ids):
           redacted_jsonl, jr = redact_jsonl(agent_jsonls[agent_id])
           for k, v in jr.counts.items():
               total_report.counts[k] = total_report.counts.get(k, 0) + v
           redacted_meta_bytes, mr = redact_jsonl(agent_metas[agent_id])
           for k, v in mr.counts.items():
               total_report.counts[k] = total_report.counts.get(k, 0) + v
           meta = _validate_meta(redacted_meta_bytes, agent_id)
           agents.append(AgentPiece(
               agent_id=agent_id,
               jsonl_bytes=redacted_jsonl,
               meta=meta,
           ))

       return UnpackedBundle(
           main_bytes=redacted_main,
           agents=agents,
           total_redactions=total_report.total(),
       )
   ```

4. - [ ] **Step 4: Run the test, see it pass.** Run:
   ```
   cd webapp/backend && python -m pytest tests/test_bundle_loose.py -q
   ```
   Expected: `1 passed`.

5. - [ ] **Step 5: Write a failing test for the agent-zip case.** Append to `webapp/backend/tests/test_bundle_loose.py`:
   ```python
   def test_unpack_loose_with_agent_zip():
       aid = "a0123456789abcdef"
       meta = json.dumps({
           "agentType": "Explore",
           "description": "test",
           "toolUseId": "toolu_01abc",
       }).encode()
       zip_bytes = _make_zip({
           f"agents/{aid}.jsonl": b'{"type":"assistant"}\n',
           f"agents/{aid}.meta.json": meta,
       })
       result = unpack_loose_files(
           b'{"type":"user"}\n', zip_bytes, max_total_bytes=10_000
       )
       assert len(result.agents) == 1
       a = result.agents[0]
       assert a.agent_id == aid
       assert a.jsonl_bytes == b'{"type":"assistant"}\n'
       assert a.meta == {
           "agentType": "Explore",
           "description": "test",
           "toolUseId": "toolu_01abc",
       }


   def test_unpack_loose_rejects_unknown_zip_member():
       zip_bytes = _make_zip({"random.txt": b"x"})
       with pytest.raises(BundleError, match="member"):
           unpack_loose_files(b"{}\n", zip_bytes, max_total_bytes=10_000)


   def test_unpack_loose_rejects_agent_jsonl_without_meta():
       zip_bytes = _make_zip({"agents/a0123456789abcdef.jsonl": b"{}"})
       with pytest.raises(BundleError, match="meta"):
           unpack_loose_files(b"{}\n", zip_bytes, max_total_bytes=10_000)


   def test_unpack_loose_rejects_malformed_zip():
       with pytest.raises(BundleError, match="zip"):
           unpack_loose_files(b"{}\n", b"not a zip", max_total_bytes=10_000)


   def test_unpack_loose_rejects_oversize():
       with pytest.raises(BundleSizeError):
           unpack_loose_files(b"x" * 5000, None, max_total_bytes=100)
   ```

6. - [ ] **Step 6: Run the tests, see all pass.** Run:
   ```
   cd webapp/backend && python -m pytest tests/test_bundle_loose.py -q
   ```
   Expected: `6 passed` (the new code already handles all these cases).

7. - [ ] **Step 7: Commit.** Run:
   ```
   cd webapp/backend && git add app/redact/bundle.py tests/test_bundle_loose.py && git commit -m "Add unpack_loose_files for loose transcript + subagent zip uploads

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
   ```

---

### Task 3: Add `python-multipart` dependency

FastAPI raises at import time if multipart form params are declared without `python-multipart` installed. `/api/uploads` (Task 5) needs it.

**Files:**
- `webapp/backend/pyproject.toml`

1. - [ ] **Step 1: Confirm it is missing.** Run:
   ```
   cd webapp/backend && python -c "import multipart" ; echo "exit=$?"
   ```
   Expected: `ModuleNotFoundError: No module named 'multipart'` and `exit=1`.

2. - [ ] **Step 2: Add the dependency.** In `webapp/backend/pyproject.toml`, in the `dev` extra list, add `"python-multipart>=0.0.9",` after the `"aiosqlite>=0.20",` line so the block reads:
   ```toml
   dev = [
       "pytest>=8.3",
       "pytest-asyncio>=0.24",
       "respx>=0.21",
       "aiosqlite>=0.20",
       "python-multipart>=0.0.9",
       "azure-storage-blob>=12.19",
       "azure-identity>=1.15",
   ]
   ```

3. - [ ] **Step 3: Install it into the active environment.** Run:
   ```
   cd webapp/backend && python -m pip install "python-multipart>=0.0.9"
   ```
   Expected: `Successfully installed python-multipart-...`.

4. - [ ] **Step 4: Confirm it imports.** Run:
   ```
   cd webapp/backend && python -c "import multipart; print('ok')"
   ```
   Expected: `ok`.

5. - [ ] **Step 5: Commit.** Run:
   ```
   cd webapp/backend && git add pyproject.toml && git commit -m "Add python-multipart dependency for multipart upload endpoint

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
   ```

---

### Task 4: `resolve_association` shared helper

Given an optional `pr_url` and/or `repo_full_name` plus a GitHub token and the uploader's login, resolve the association metadata or raise an `HTTPException`. Used by `/api/ingest`, `/api/uploads`, and `PATCH`. Lives in `app/api/trace_service.py` next to the Phase-1 service.

**Files:**
- `webapp/backend/app/api/trace_service.py`
- `webapp/backend/tests/test_trace_service.py` (created)

1. - [ ] **Step 1: Write a failing test for the PR path.** Create `webapp/backend/tests/test_trace_service.py`:
   ```python
   import pytest
   import respx
   from fastapi import HTTPException

   from app.api.trace_service import resolve_association, ResolvedAssociation
   from app.auth.github import GitHubClient


   API = "https://api.github.test"


   @pytest.mark.asyncio
   async def test_resolve_standalone_when_no_pr_or_repo():
       gh = GitHubClient(api_base=API)
       result = await resolve_association(
           github=gh, token="ghp_x", uploader_login="alice",
           pr_url=None, repo_full_name=None,
       )
       assert result == ResolvedAssociation(
           repo_full_name=None, pr_number=None, pr_url=None,
           pr_title=None, is_private=False,
       )


   @pytest.mark.asyncio
   async def test_resolve_pr_path(respx_mock: respx.MockRouter):
       respx_mock.get(f"{API}/repos/alice/repo/pulls/3").respond(
           200,
           json={
               "number": 3, "title": "Hello", "user": {"login": "alice"},
               "html_url": "https://github.com/alice/repo/pull/3",
               "head": {"repo": {"private": True, "full_name": "alice/repo"}},
               "base": {"repo": {"private": True, "full_name": "alice/repo"}},
           },
       )
       gh = GitHubClient(api_base=API)
       result = await resolve_association(
           github=gh, token="ghp_x", uploader_login="alice",
           pr_url="https://github.com/alice/repo/pull/3", repo_full_name=None,
       )
       assert result.repo_full_name == "alice/repo"
       assert result.pr_number == 3
       assert result.pr_title == "Hello"
       assert result.is_private is True


   @pytest.mark.asyncio
   async def test_resolve_pr_rejects_author_mismatch(
       respx_mock: respx.MockRouter,
   ):
       respx_mock.get(f"{API}/repos/alice/repo/pulls/3").respond(
           200,
           json={
               "number": 3, "title": "Hello", "user": {"login": "bob"},
               "html_url": "https://github.com/alice/repo/pull/3",
               "head": {"repo": {"private": False, "full_name": "alice/repo"}},
               "base": {"repo": {"private": False, "full_name": "alice/repo"}},
           },
       )
       gh = GitHubClient(api_base=API)
       with pytest.raises(HTTPException) as exc:
           await resolve_association(
               github=gh, token="ghp_x", uploader_login="alice",
               pr_url="https://github.com/alice/repo/pull/3",
               repo_full_name=None,
           )
       assert exc.value.status_code == 403
   ```

2. - [ ] **Step 2: Run the test, see it fail.** Run:
   ```
   cd webapp/backend && python -m pytest tests/test_trace_service.py -q
   ```
   Expected: `ImportError: cannot import name 'resolve_association'`.

3. - [ ] **Step 3: Implement `ResolvedAssociation` + `resolve_association`.** Append to `webapp/backend/app/api/trace_service.py`:
   ```python
   from dataclasses import dataclass

   from fastapi import HTTPException

   from app.api.pr_url import parse_pr_url
   from app.auth.github import GitHubAPIError, GitHubClient


   @dataclass(frozen=True)
   class ResolvedAssociation:
       repo_full_name: str | None
       pr_number: int | None
       pr_url: str | None
       pr_title: str | None
       is_private: bool


   _STANDALONE = ResolvedAssociation(
       repo_full_name=None, pr_number=None, pr_url=None,
       pr_title=None, is_private=False,
   )


   def _parse_repo_full_name(value: str) -> tuple[str, str]:
       parts = value.strip().split("/")
       if len(parts) != 2 or not parts[0] or not parts[1]:
           raise HTTPException(
               status_code=400, detail=f"invalid repo: {value}"
           )
       return parts[0], parts[1]


   async def resolve_association(
       *,
       github: GitHubClient,
       token: str,
       uploader_login: str,
       pr_url: str | None,
       repo_full_name: str | None,
   ) -> ResolvedAssociation:
       """Resolve an optional PR/repo association for an upload.

       PR wins over repo. Verifies the uploader is the PR author (PR path) or
       a repo collaborator (repo-only path), snapshotting repo visibility.
       Raises HTTPException (400/403/404/502) on failure; returns a standalone
       association when neither is given.
       """
       if pr_url:
           try:
               parsed = parse_pr_url(pr_url)
           except ValueError as e:
               raise HTTPException(status_code=400, detail=str(e))
           try:
               pr = await github.get_pull(
                   token, parsed.owner, parsed.repo, parsed.number
               )
           except GitHubAPIError as e:
               msg = str(e)
               if "not found" in msg.lower():
                   raise HTTPException(
                       status_code=404, detail=f"PR not found: {pr_url}"
                   )
               raise HTTPException(
                   status_code=502, detail=f"github upstream error: {msg}"
               )
           if pr.author_login != uploader_login:
               raise HTTPException(
                   status_code=403,
                   detail=(
                       f"PR author ({pr.author_login}) does not match "
                       f"uploader ({uploader_login})"
                   ),
               )
           return ResolvedAssociation(
               repo_full_name=pr.repo_full_name,
               pr_number=pr.number,
               pr_url=pr.html_url,
               pr_title=pr.title,
               is_private=pr.repo_is_private,
           )

       if repo_full_name:
           owner, repo = _parse_repo_full_name(repo_full_name)
           try:
               perm = await github.get_repo_permission(
                   token, owner, repo, uploader_login
               )
           except GitHubAPIError as e:
               msg = str(e)
               if "not found" in msg.lower():
                   raise HTTPException(
                       status_code=404,
                       detail=f"repo not found: {repo_full_name}",
                   )
               raise HTTPException(
                   status_code=502, detail=f"github upstream error: {msg}"
               )
           if not perm.is_collaborator:
               raise HTTPException(
                   status_code=403,
                   detail=(
                       f"{uploader_login} is not a collaborator on "
                       f"{repo_full_name}"
                   ),
               )
           try:
               info = await github.get_repo(token, owner, repo)
           except GitHubAPIError as e:
               raise HTTPException(
                   status_code=502, detail=f"github upstream error: {e}"
               )
           return ResolvedAssociation(
               repo_full_name=info.full_name,
               pr_number=None,
               pr_url=None,
               pr_title=None,
               is_private=info.is_private,
           )

       return _STANDALONE
   ```

4. - [ ] **Step 4: Run the test, see PR tests pass.** Run:
   ```
   cd webapp/backend && python -m pytest tests/test_trace_service.py -q
   ```
   Expected: `3 passed`.

5. - [ ] **Step 5: Write a failing test for the repo-only path.** Append to `webapp/backend/tests/test_trace_service.py`:
   ```python
   @pytest.mark.asyncio
   async def test_resolve_repo_only_collaborator(respx_mock: respx.MockRouter):
       respx_mock.get(
           f"{API}/repos/alice/repo/collaborators/alice/permission"
       ).respond(200, json={"permission": "write"})
       respx_mock.get(f"{API}/repos/alice/repo").respond(
           200, json={"full_name": "alice/repo", "private": True}
       )
       gh = GitHubClient(api_base=API)
       result = await resolve_association(
           github=gh, token="ghp_x", uploader_login="alice",
           pr_url=None, repo_full_name="alice/repo",
       )
       assert result.repo_full_name == "alice/repo"
       assert result.pr_number is None
       assert result.is_private is True


   @pytest.mark.asyncio
   async def test_resolve_repo_only_rejects_non_collaborator(
       respx_mock: respx.MockRouter,
   ):
       respx_mock.get(
           f"{API}/repos/alice/repo/collaborators/bob/permission"
       ).respond(200, json={"permission": "none"})
       gh = GitHubClient(api_base=API)
       with pytest.raises(HTTPException) as exc:
           await resolve_association(
               github=gh, token="ghp_x", uploader_login="bob",
               pr_url=None, repo_full_name="alice/repo",
           )
       assert exc.value.status_code == 403


   @pytest.mark.asyncio
   async def test_resolve_repo_only_rejects_bad_repo_string():
       gh = GitHubClient(api_base=API)
       with pytest.raises(HTTPException) as exc:
           await resolve_association(
               github=gh, token="ghp_x", uploader_login="bob",
               pr_url=None, repo_full_name="not-a-repo",
           )
       assert exc.value.status_code == 400
   ```

6. - [ ] **Step 6: Run the tests, see all pass.** Run:
   ```
   cd webapp/backend && python -m pytest tests/test_trace_service.py -q
   ```
   Expected: `6 passed`.

7. - [ ] **Step 7: Commit.** Run:
   ```
   cd webapp/backend && git add app/api/trace_service.py tests/test_trace_service.py && git commit -m "Add resolve_association helper for optional PR/repo linking

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
   ```

---

### Task 5: Rework `/api/ingest` — optional PR, optional repo, standalone

`X-Vibeshub-Pr-Url` becomes optional; add `X-Vibeshub-Repo`. Resolution goes through `resolve_association`; the row is written by `create_or_update_trace`. The response `trace_url` becomes `<public_base_url>/t/<sid>`.

**Files:**
- `webapp/backend/app/api/ingest.py`
- `webapp/backend/tests/test_ingest.py`

1. - [ ] **Step 1: Write the failing tests for the new ingest paths.** In `webapp/backend/tests/test_ingest.py`, add a repo-mock helper and three new tests, and update `test_ingest_requires_pr_url_header` to reflect that the header is now optional. First, append after `_mock_alice_pr1`:
   ```python
   def _mock_alice_collab_repo(
       respx_mock: respx.MockRouter, *, permission: str = "write",
       private: bool = False,
   ) -> None:
       """Stand up the GitHub responses the repo-only ingest path needs."""
       respx_mock.get("https://api.github.test/user").respond(
           200, json={"login": "alice", "id": 7}
       )
       respx_mock.get(
           "https://api.github.test/repos/alice/repo/collaborators/alice/permission"
       ).respond(200, json={"permission": permission})
       respx_mock.get("https://api.github.test/repos/alice/repo").respond(
           200, json={"full_name": "alice/repo", "private": private}
       )
   ```
   Then add the new tests:
   ```python
   @pytest.mark.asyncio
   async def test_ingest_standalone_when_no_pr_or_repo(client, respx_mock):
       respx_mock.get("https://api.github.test/user").respond(
           200, json={"login": "alice", "id": 7}
       )
       headers = {k: v for k, v in COMMON_HEADERS.items()
                  if k != "X-Vibeshub-Pr-Url"}
       body = make_bundle({"main.jsonl": b'{"type":"user"}\n'})
       r = client.post("/api/ingest", content=body, headers=headers)
       assert r.status_code == 201, r.text
       data = r.json()
       assert data["trace_url"].endswith(f"/t/{data['short_id']}")

       SessionLocal = client.app.state.session_maker
       async with SessionLocal() as session:
           trace = (await session.execute(
               select(Trace).where(Trace.short_id == data["short_id"])
           )).scalar_one()
       assert trace.repo_full_name is None
       assert trace.pr_number is None
       assert trace.pr_url is None
       assert trace.is_private is False
       assert trace.owner_login == "alice"


   @pytest.mark.asyncio
   async def test_ingest_repo_only_for_collaborator(client, respx_mock):
       _mock_alice_collab_repo(respx_mock, permission="write", private=True)
       headers = {k: v for k, v in COMMON_HEADERS.items()
                  if k != "X-Vibeshub-Pr-Url"}
       headers["X-Vibeshub-Repo"] = "alice/repo"
       body = make_bundle({"main.jsonl": b'{"type":"user"}\n'})
       r = client.post("/api/ingest", content=body, headers=headers)
       assert r.status_code == 201, r.text
       short_id = r.json()["short_id"]

       SessionLocal = client.app.state.session_maker
       async with SessionLocal() as session:
           trace = (await session.execute(
               select(Trace).where(Trace.short_id == short_id)
           )).scalar_one()
       assert trace.repo_full_name == "alice/repo"
       assert trace.pr_number is None
       assert trace.is_private is True


   @pytest.mark.asyncio
   async def test_ingest_repo_only_rejects_non_collaborator(
       client, respx_mock
   ):
       respx_mock.get("https://api.github.test/user").respond(
           200, json={"login": "alice", "id": 7}
       )
       respx_mock.get(
           "https://api.github.test/repos/alice/repo/collaborators/alice/permission"
       ).respond(200, json={"permission": "none"})
       headers = {k: v for k, v in COMMON_HEADERS.items()
                  if k != "X-Vibeshub-Pr-Url"}
       headers["X-Vibeshub-Repo"] = "alice/repo"
       body = make_bundle({"main.jsonl": b'{"type":"user"}\n'})
       r = client.post("/api/ingest", content=body, headers=headers)
       assert r.status_code == 403
   ```
   Finally, replace the body of `test_ingest_requires_pr_url_header` and rename it:
   ```python
   @pytest.mark.asyncio
   async def test_ingest_without_pr_url_header_is_standalone(client, respx_mock):
       respx_mock.get("https://api.github.test/user").respond(
           200, json={"login": "alice", "id": 7}
       )
       body = make_bundle({"main.jsonl": b"{}\n"})
       headers = {k: v for k, v in COMMON_HEADERS.items()
                  if k != "X-Vibeshub-Pr-Url"}
       r = client.post("/api/ingest", content=body, headers=headers)
       assert r.status_code == 201
   ```

2. - [ ] **Step 2: Update the existing PR-URL assertion.** In `test_ingest_accepts_tar_bundle`, change the last assertion from the `/alice/repo/pull/1/...` form to the `/t/` form:
   ```python
       assert data["trace_url"].endswith(f"/t/{data['short_id']}")
   ```

3. - [ ] **Step 3: Run the tests, see the new ones fail.** Run:
   ```
   cd webapp/backend && python -m pytest tests/test_ingest.py -q
   ```
   Expected: the new standalone/repo tests fail (400 "missing required header" / `trace_url` ends with the old path).

4. - [ ] **Step 4: Rewrite `/api/ingest`.** Replace the entire body of `webapp/backend/app/api/ingest.py` with:
   ```python
   from __future__ import annotations

   from typing import Annotated

   from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
   from sqlalchemy.ext.asyncio import AsyncSession

   from app.api.schemas import IngestResponse
   from app.api.trace_service import create_or_update_trace, resolve_association
   from app.auth.github import GitHubAuthError, GitHubClient
   from app.deps import get_blob_store, get_github, get_app_settings, get_session
   from app.redact.bundle import BundleError, BundleSizeError, unpack_and_redact
   from app.settings import Settings
   from app.storage.blob import BlobStore


   router = APIRouter()


   def _bearer_token(authorization: str | None) -> str:
       if not authorization or not authorization.lower().startswith("bearer "):
           raise HTTPException(status_code=401, detail="missing bearer token")
       return authorization.split(None, 1)[1].strip()


   def _trace_url(settings: Settings, sid: str) -> str:
       base = settings.public_base_url.rstrip("/")
       return f"{base}/t/{sid}"


   def _require_header(value: str | None, name: str) -> str:
       if not value:
           raise HTTPException(
               status_code=400, detail=f"missing required header: {name}"
           )
       return value


   @router.post(
       "/api/ingest",
       status_code=status.HTTP_201_CREATED,
       response_model=IngestResponse,
   )
   async def ingest(
       request: Request,
       authorization: Annotated[str | None, Header()] = None,
       x_vibeshub_pr_url: Annotated[str | None, Header()] = None,
       x_vibeshub_repo: Annotated[str | None, Header()] = None,
       x_vibeshub_platform: Annotated[str | None, Header()] = None,
       x_vibeshub_plugin_version: Annotated[str | None, Header()] = None,
       x_vibeshub_session_id: Annotated[str | None, Header()] = None,
       x_vibeshub_client_redactions: Annotated[str | None, Header()] = None,
       session: AsyncSession = Depends(get_session),
       blob_store: BlobStore = Depends(get_blob_store),
       github: GitHubClient = Depends(get_github),
       settings: Settings = Depends(get_app_settings),
   ) -> IngestResponse:
       token = _bearer_token(authorization)
       platform = _require_header(x_vibeshub_platform, "X-Vibeshub-Platform")
       plugin_version = _require_header(
           x_vibeshub_plugin_version, "X-Vibeshub-Plugin-Version"
       )
       try:
           redaction_count_client = int(x_vibeshub_client_redactions or "0")
       except ValueError:
           raise HTTPException(
               status_code=400, detail="invalid X-Vibeshub-Client-Redactions"
           )

       try:
           user = await github.verify_token(token)
       except GitHubAuthError as e:
           raise HTTPException(status_code=401, detail=str(e))

       assoc = await resolve_association(
           github=github,
           token=token,
           uploader_login=user.login,
           pr_url=x_vibeshub_pr_url,
           repo_full_name=x_vibeshub_repo,
       )

       tar_bytes = await request.body()
       if len(tar_bytes) > settings.max_trace_bytes:
           raise HTTPException(
               status_code=413,
               detail=(
                   f"upload exceeds {settings.max_trace_bytes} "
                   f"compressed bytes"
               ),
           )

       try:
           unpacked = unpack_and_redact(
               tar_bytes, max_total_bytes=settings.max_trace_bytes
           )
       except BundleSizeError as e:
           raise HTTPException(status_code=413, detail=str(e))
       except BundleError as e:
           raise HTTPException(status_code=400, detail=str(e))

       result = await create_or_update_trace(
           session=session,
           blob_store=blob_store,
           unpacked=unpacked,
           owner_login=user.login,
           platform=platform,
           plugin_version=plugin_version,
           session_id=x_vibeshub_session_id,
           redaction_count_client=redaction_count_client,
           repo_full_name=assoc.repo_full_name,
           pr_number=assoc.pr_number,
           pr_url=assoc.pr_url,
           pr_title=assoc.pr_title,
           is_private=assoc.is_private,
       )

       return IngestResponse(
           trace_id=str(result.trace.id),
           short_id=result.trace.short_id,
           trace_url=_trace_url(settings, result.trace.short_id),
           created=result.created,
       )
   ```

5. - [ ] **Step 5: Run the ingest tests, see all pass.** Run:
   ```
   cd webapp/backend && python -m pytest tests/test_ingest.py tests/test_private_traces.py tests/test_traces.py -q
   ```
   Expected: all pass. (The PR concurrency probe test `test_ingest_runs_github_calls_in_parallel` covered parallel GitHub calls, which the new sequential `verify_token` then `resolve_association` flow removes — if that test still asserts concurrency, delete it as the parallelism is no longer a behavior we keep; note the deletion in the commit message.)

6. - [ ] **Step 6: Commit.** Run:
   ```
   cd webapp/backend && git add app/api/ingest.py tests/test_ingest.py && git commit -m "Make /api/ingest PR optional; support repo-only and standalone uploads

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
   ```

---

### Task 6: `POST /api/uploads` web endpoint

A cookie-authed multipart endpoint. Reads `transcript` + optional `subagents` zip, redacts via `unpack_loose_files`, resolves an optional PR/repo with the user's stored token, and calls `create_or_update_trace`. No PR comment.

**Files:**
- `webapp/backend/app/api/uploads.py` (created)
- `webapp/backend/app/main.py`
- `webapp/backend/tests/test_uploads.py` (created)

1. - [ ] **Step 1: Write the failing happy-path test.** Create `webapp/backend/tests/test_uploads.py`:
   ```python
   import io
   import json
   import zipfile

   import pytest
   import respx
   from sqlalchemy import select

   from app.storage.models import Trace
   from tests._auth_helpers import authed_cookies


   API = "https://api.github.test"


   def _make_zip(members: dict[str, bytes]) -> bytes:
       buf = io.BytesIO()
       with zipfile.ZipFile(buf, mode="w") as zf:
           for name, data in members.items():
               zf.writestr(name, data)
       return buf.getvalue()


   @pytest.mark.asyncio
   async def test_uploads_requires_auth(client):
       r = client.post(
           "/api/uploads",
           files={"transcript": ("chat.jsonl", b'{"type":"user"}\n')},
       )
       assert r.status_code == 403


   @pytest.mark.asyncio
   async def test_uploads_standalone_happy_path(client):
       cookies, user = await authed_cookies(client, login="alice")
       r = client.post(
           "/api/uploads",
           files={"transcript": ("chat.jsonl", b'{"type":"user"}\n')},
           cookies=cookies,
       )
       assert r.status_code == 201, r.text
       data = r.json()
       assert data["created"] is True
       assert data["trace_url"].endswith(f"/t/{data['short_id']}")

       SessionLocal = client.app.state.session_maker
       async with SessionLocal() as session:
           trace = (await session.execute(
               select(Trace).where(Trace.short_id == data["short_id"])
           )).scalar_one()
       assert trace.owner_login == "alice"
       assert trace.repo_full_name is None
       assert trace.platform == "web"
       assert trace.is_private is False
   ```

2. - [ ] **Step 2: Run the test, see it fail.** Run:
   ```
   cd webapp/backend && python -m pytest tests/test_uploads.py -q
   ```
   Expected: `404 Not Found` (route not registered).

3. - [ ] **Step 3: Create `app/api/uploads.py`.** Create `webapp/backend/app/api/uploads.py`:
   ```python
   from __future__ import annotations

   from fastapi import (
       APIRouter,
       Depends,
       File,
       Form,
       HTTPException,
       UploadFile,
       status,
   )
   from sqlalchemy.ext.asyncio import AsyncSession

   from app.api.trace_service import create_or_update_trace, resolve_association
   from app.auth.crypto import TokenCipher
   from app.auth.github import GitHubClient
   from app.auth.sessions import get_current_user
   from app.deps import get_blob_store, get_github, get_app_settings, get_session
   from app.redact.bundle import BundleError, BundleSizeError, unpack_loose_files
   from app.settings import Settings
   from app.storage.blob import BlobStore
   from app.storage.models import User


   router = APIRouter()


   def _trace_url(settings: Settings, sid: str) -> str:
       base = settings.public_base_url.rstrip("/")
       return f"{base}/t/{sid}"


   @router.post("/api/uploads", status_code=status.HTTP_201_CREATED)
   async def create_upload(
       transcript: UploadFile = File(...),
       subagents: UploadFile | None = File(default=None),
       is_private: bool = Form(default=False),
       pr_url: str | None = Form(default=None),
       repo_full_name: str | None = Form(default=None),
       session: AsyncSession = Depends(get_session),
       blob_store: BlobStore = Depends(get_blob_store),
       github: GitHubClient = Depends(get_github),
       settings: Settings = Depends(get_app_settings),
       user: User | None = Depends(get_current_user),
   ) -> dict:
       if user is None:
           raise HTTPException(status_code=403, detail="auth_required")

       main_bytes = await transcript.read()
       if len(main_bytes) > settings.max_trace_bytes:
           raise HTTPException(
               status_code=413,
               detail=f"upload exceeds {settings.max_trace_bytes} bytes",
           )
       zip_bytes: bytes | None = None
       if subagents is not None:
           zip_bytes = await subagents.read()
           if len(main_bytes) + len(zip_bytes) > settings.max_trace_bytes:
               raise HTTPException(
                   status_code=413,
                   detail=f"upload exceeds {settings.max_trace_bytes} bytes",
               )

       try:
           unpacked = unpack_loose_files(
               main_bytes, zip_bytes, max_total_bytes=settings.max_trace_bytes
           )
       except BundleSizeError as e:
           raise HTTPException(status_code=413, detail=str(e))
       except BundleError as e:
           raise HTTPException(status_code=400, detail=str(e))

       assoc_private = is_private
       repo_name: str | None = None
       pr_number: int | None = None
       resolved_pr_url: str | None = None
       pr_title: str | None = None

       if pr_url or repo_full_name:
           cipher = TokenCipher(settings.token_encryption_key)
           try:
               token = cipher.decrypt(user.encrypted_access_token)
           except Exception:
               raise HTTPException(
                   status_code=403, detail="github_token_unavailable"
               )
           assoc = await resolve_association(
               github=github,
               token=token,
               uploader_login=user.github_login,
               pr_url=pr_url,
               repo_full_name=repo_full_name,
           )
           repo_name = assoc.repo_full_name
           pr_number = assoc.pr_number
           resolved_pr_url = assoc.pr_url
           pr_title = assoc.pr_title
           # Repo-associated: privacy mirrors GitHub, not the form field.
           assoc_private = assoc.is_private

       result = await create_or_update_trace(
           session=session,
           blob_store=blob_store,
           unpacked=unpacked,
           owner_login=user.github_login,
           platform="web",
           plugin_version=None,
           session_id=None,
           redaction_count_client=0,
           repo_full_name=repo_name,
           pr_number=pr_number,
           pr_url=resolved_pr_url,
           pr_title=pr_title,
           is_private=assoc_private,
       )

       return {
           "trace_id": str(result.trace.id),
           "short_id": result.trace.short_id,
           "trace_url": _trace_url(settings, result.trace.short_id),
           "created": result.created,
       }
   ```

4. - [ ] **Step 4: Register the router.** In `webapp/backend/app/main.py`, add `uploads as uploads_api` to the `from app.api import (...)` block (keep alphabetical-ish ordering, e.g. after `traces as traces_api,`), then add `app.include_router(uploads_api.router)` after `app.include_router(traces_api.router)`.

5. - [ ] **Step 5: Run the test, see happy path pass.** Run:
   ```
   cd webapp/backend && python -m pytest tests/test_uploads.py -q
   ```
   Expected: `2 passed`.

6. - [ ] **Step 6: Write the failing tests for errors + linking.** Append to `webapp/backend/tests/test_uploads.py`:
   ```python
   @pytest.mark.asyncio
   async def test_uploads_missing_transcript_is_422(client):
       cookies, _ = await authed_cookies(client, login="alice")
       r = client.post("/api/uploads", data={"is_private": "false"},
                        cookies=cookies)
       assert r.status_code == 422


   @pytest.mark.asyncio
   async def test_uploads_too_big_is_413(client):
       cookies, _ = await authed_cookies(client, login="alice")
       client.app.state.settings.max_trace_bytes = 100
       r = client.post(
           "/api/uploads",
           files={"transcript": ("chat.jsonl", b"x" * 5000)},
           cookies=cookies,
       )
       assert r.status_code == 413


   @pytest.mark.asyncio
   async def test_uploads_malformed_zip_is_400(client):
       cookies, _ = await authed_cookies(client, login="alice")
       r = client.post(
           "/api/uploads",
           files={
               "transcript": ("chat.jsonl", b'{"type":"user"}\n'),
               "subagents": ("subs.zip", b"not a zip"),
           },
           cookies=cookies,
       )
       assert r.status_code == 400


   @pytest.mark.asyncio
   async def test_uploads_with_subagent_zip(client):
       cookies, _ = await authed_cookies(client, login="alice")
       aid = "a0123456789abcdef"
       meta = json.dumps({
           "agentType": "Explore", "description": "d", "toolUseId": "t1",
       }).encode()
       zip_bytes = _make_zip({
           f"agents/{aid}.jsonl": b'{"type":"assistant"}\n',
           f"agents/{aid}.meta.json": meta,
       })
       r = client.post(
           "/api/uploads",
           files={
               "transcript": ("chat.jsonl", b'{"type":"user"}\n'),
               "subagents": ("subs.zip", zip_bytes),
           },
           cookies=cookies,
       )
       assert r.status_code == 201, r.text
       short_id = r.json()["short_id"]

       SessionLocal = client.app.state.session_maker
       async with SessionLocal() as session:
           trace = (await session.execute(
               select(Trace).where(Trace.short_id == short_id)
           )).scalar_one()
       assert trace.agent_count == 1


   @pytest.mark.asyncio
   async def test_uploads_with_repo_link_for_collaborator(
       client, respx_mock: respx.MockRouter,
   ):
       cookies, _ = await authed_cookies(
           client, login="alice", access_token="gho_alice"
       )
       respx_mock.get(
           f"{API}/repos/alice/repo/collaborators/alice/permission"
       ).respond(200, json={"permission": "admin"})
       respx_mock.get(f"{API}/repos/alice/repo").respond(
           200, json={"full_name": "alice/repo", "private": True}
       )
       r = client.post(
           "/api/uploads",
           files={"transcript": ("chat.jsonl", b'{"type":"user"}\n')},
           data={"repo_full_name": "alice/repo", "is_private": "false"},
           cookies=cookies,
       )
       assert r.status_code == 201, r.text
       short_id = r.json()["short_id"]

       SessionLocal = client.app.state.session_maker
       async with SessionLocal() as session:
           trace = (await session.execute(
               select(Trace).where(Trace.short_id == short_id)
           )).scalar_one()
       assert trace.repo_full_name == "alice/repo"
       # Repo-associated: is_private mirrors GitHub (private), not the form.
       assert trace.is_private is True


   @pytest.mark.asyncio
   async def test_uploads_repo_link_rejects_non_collaborator(
       client, respx_mock: respx.MockRouter,
   ):
       cookies, _ = await authed_cookies(
           client, login="bob", access_token="gho_bob"
       )
       respx_mock.get(
           f"{API}/repos/alice/repo/collaborators/bob/permission"
       ).respond(200, json={"permission": "none"})
       r = client.post(
           "/api/uploads",
           files={"transcript": ("chat.jsonl", b'{"type":"user"}\n')},
           data={"repo_full_name": "alice/repo"},
           cookies=cookies,
       )
       assert r.status_code == 403
   ```

7. - [ ] **Step 7: Run the tests, see all pass.** Run:
   ```
   cd webapp/backend && python -m pytest tests/test_uploads.py -q
   ```
   Expected: `8 passed` (the endpoint already covers every case).

8. - [ ] **Step 8: Commit.** Run:
   ```
   cd webapp/backend && git add app/api/uploads.py app/main.py tests/test_uploads.py && git commit -m "Add POST /api/uploads web upload endpoint

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
   ```

---

### Task 7: `PATCH /api/traces/{short_id}`

Owner-only edit endpoint. The `TracePatch` model distinguishes "field absent" from "field set to null" via pydantic `model_fields_set`. Setting/changing PR/repo re-runs `resolve_association`; clearing reverts to standalone; `is_private` is honored only when the trace is/becomes standalone.

**Files:**
- `webapp/backend/app/api/traces.py`
- `webapp/backend/tests/test_traces_patch.py` (created)

1. - [ ] **Step 1: Write the failing tests.** Create `webapp/backend/tests/test_traces_patch.py`:
   ```python
   import pytest
   import respx
   from sqlalchemy import select

   from app.storage.models import Trace
   from tests._auth_helpers import authed_cookies


   API = "https://api.github.test"


   async def _seed_standalone_trace(client, *, owner_login: str) -> str:
       """Insert a standalone trace owned by owner_login; return its short_id."""
       from app.short_id import generate
       SessionLocal = client.app.state.session_maker
       sid = generate()
       async with SessionLocal() as session:
           session.add(Trace(
               short_id=sid,
               owner_login=owner_login,
               repo_full_name=None,
               pr_number=None,
               pr_url=None,
               pr_title=None,
               platform="web",
               plugin_version=None,
               session_id=None,
               byte_size=10,
               message_count=1,
               is_private=False,
               blob_path=None,
               blob_prefix=f"traces/{sid}/",
               agents=[],
               agent_count=0,
           ))
           await session.commit()
       return sid


   @pytest.mark.asyncio
   async def test_patch_requires_auth(client):
       sid = await _seed_standalone_trace(client, owner_login="alice")
       r = client.patch(f"/api/traces/{sid}", json={"is_private": True})
       assert r.status_code == 401


   @pytest.mark.asyncio
   async def test_patch_404_when_missing(client):
       cookies, _ = await authed_cookies(client, login="alice")
       r = client.patch("/api/traces/zzzzzzzzzz", json={"is_private": True},
                         cookies=cookies)
       assert r.status_code == 404


   @pytest.mark.asyncio
   async def test_patch_403_for_non_owner(client):
       sid = await _seed_standalone_trace(client, owner_login="alice")
       cookies, _ = await authed_cookies(client, login="bob", github_id=200)
       r = client.patch(f"/api/traces/{sid}", json={"is_private": True},
                         cookies=cookies)
       assert r.status_code == 403


   @pytest.mark.asyncio
   async def test_patch_toggles_privacy_on_standalone(client):
       sid = await _seed_standalone_trace(client, owner_login="alice")
       cookies, _ = await authed_cookies(client, login="alice")
       r = client.patch(f"/api/traces/{sid}", json={"is_private": True},
                         cookies=cookies)
       assert r.status_code == 200
       assert r.json()["is_private"] is True

       SessionLocal = client.app.state.session_maker
       async with SessionLocal() as session:
           trace = (await session.execute(
               select(Trace).where(Trace.short_id == sid)
           )).scalar_one()
       assert trace.is_private is True


   @pytest.mark.asyncio
   async def test_patch_links_repo_and_syncs_privacy(
       client, respx_mock: respx.MockRouter,
   ):
       sid = await _seed_standalone_trace(client, owner_login="alice")
       cookies, _ = await authed_cookies(
           client, login="alice", access_token="gho_alice"
       )
       respx_mock.get(
           f"{API}/repos/alice/repo/collaborators/alice/permission"
       ).respond(200, json={"permission": "write"})
       respx_mock.get(f"{API}/repos/alice/repo").respond(
           200, json={"full_name": "alice/repo", "private": True}
       )
       # is_private in the body is ignored once a repo is linked.
       r = client.patch(
           f"/api/traces/{sid}",
           json={"repo_full_name": "alice/repo", "is_private": False},
           cookies=cookies,
       )
       assert r.status_code == 200
       body = r.json()
       assert body["repo_full_name"] == "alice/repo"
       assert body["is_private"] is True


   @pytest.mark.asyncio
   async def test_patch_rejects_repo_for_non_collaborator(
       client, respx_mock: respx.MockRouter,
   ):
       sid = await _seed_standalone_trace(client, owner_login="alice")
       cookies, _ = await authed_cookies(
           client, login="alice", access_token="gho_alice"
       )
       respx_mock.get(
           f"{API}/repos/other/repo/collaborators/alice/permission"
       ).respond(200, json={"permission": "none"})
       r = client.patch(
           f"/api/traces/{sid}",
           json={"repo_full_name": "other/repo"},
           cookies=cookies,
       )
       assert r.status_code == 403


   @pytest.mark.asyncio
   async def test_patch_clears_association_to_standalone(
       client, respx_mock: respx.MockRouter,
   ):
       sid = await _seed_standalone_trace(client, owner_login="alice")
       cookies, _ = await authed_cookies(
           client, login="alice", access_token="gho_alice"
       )
       # First link a repo.
       respx_mock.get(
           f"{API}/repos/alice/repo/collaborators/alice/permission"
       ).respond(200, json={"permission": "write"})
       respx_mock.get(f"{API}/repos/alice/repo").respond(
           200, json={"full_name": "alice/repo", "private": False}
       )
       client.patch(f"/api/traces/{sid}",
                    json={"repo_full_name": "alice/repo"}, cookies=cookies)
       # Now clear it.
       r = client.patch(f"/api/traces/{sid}",
                        json={"repo_full_name": None}, cookies=cookies)
       assert r.status_code == 200
       assert r.json()["repo_full_name"] is None

       SessionLocal = client.app.state.session_maker
       async with SessionLocal() as session:
           trace = (await session.execute(
               select(Trace).where(Trace.short_id == sid)
           )).scalar_one()
       assert trace.repo_full_name is None
       assert trace.pr_number is None
   ```

2. - [ ] **Step 2: Run the tests, see them fail.** Run:
   ```
   cd webapp/backend && python -m pytest tests/test_traces_patch.py -q
   ```
   Expected: `405 Method Not Allowed` (no PATCH route).

3. - [ ] **Step 3: Add the `TracePatch` model and the route.** In `webapp/backend/app/api/traces.py`, add to the imports near the top:
   ```python
   from pydantic import BaseModel

   from app.api.trace_service import resolve_association
   from app.auth.crypto import TokenCipher
   ```
   (`TokenCipher` is already imported — keep one import only; if a duplicate appears, drop it.) Then add the model after the `_AGENT_ID_RE` line:
   ```python
   class TracePatch(BaseModel):
       """All fields optional; pydantic's model_fields_set distinguishes an
       absent field from one explicitly set to null."""
       is_private: bool | None = None
       pr_url: str | None = None
       repo_full_name: str | None = None
   ```
   Then add the route at the end of `webapp/backend/app/api/traces.py`:
   ```python
   @router.patch("/api/traces/{short_id}", response_model=TraceSummary)
   async def patch_trace(
       short_id: str,
       patch: TracePatch,
       session: AsyncSession = Depends(get_session),
       github: GitHubClient = Depends(get_github),
       user: User | None = Depends(get_current_user),
       settings: Settings = Depends(get_app_settings),
   ):
       if not looks_like_short_id(short_id):
           raise HTTPException(status_code=404, detail="not found")
       if user is None:
           raise HTTPException(status_code=401, detail="auth_required")

       trace = (await session.execute(
           select(Trace).where(
               Trace.short_id == short_id, Trace.deleted_at.is_(None)
           )
       )).scalar_one_or_none()
       if trace is None:
           raise HTTPException(status_code=404, detail="not found")
       if trace.owner_login != user.github_login:
           raise HTTPException(status_code=403, detail="not the trace owner")

       fields = patch.model_fields_set
       touches_assoc = "pr_url" in fields or "repo_full_name" in fields

       if touches_assoc:
           # The post-edit association: a field present in the patch
           # overrides; an absent field keeps the trace's current value.
           new_pr_url = patch.pr_url if "pr_url" in fields else trace.pr_url
           new_repo = (
               patch.repo_full_name
               if "repo_full_name" in fields
               else trace.repo_full_name
           )
           if new_pr_url or new_repo:
               cipher = TokenCipher(settings.token_encryption_key)
               try:
                   token = cipher.decrypt(user.encrypted_access_token)
               except Exception:
                   raise HTTPException(
                       status_code=403, detail="github_token_unavailable"
                   )
               assoc = await resolve_association(
                   github=github,
                   token=token,
                   uploader_login=user.github_login,
                   pr_url=new_pr_url,
                   repo_full_name=new_repo,
               )
               trace.repo_full_name = assoc.repo_full_name
               trace.pr_number = assoc.pr_number
               trace.pr_url = assoc.pr_url
               trace.pr_title = assoc.pr_title
               # Repo-associated: privacy mirrors GitHub.
               trace.is_private = assoc.is_private
           else:
               # Cleared all association — revert to standalone.
               trace.repo_full_name = None
               trace.pr_number = None
               trace.pr_url = None
               trace.pr_title = None

       # is_private is honored only when the trace is (or just became)
       # standalone. For a repo-associated trace, privacy mirrors GitHub.
       if "is_private" in fields and patch.is_private is not None:
           if trace.repo_full_name is None:
               trace.is_private = patch.is_private

       await session.commit()
       await session.refresh(trace)
       return _to_summary(trace)
   ```

4. - [ ] **Step 4: Run the tests, see all pass.** Run:
   ```
   cd webapp/backend && python -m pytest tests/test_traces_patch.py -q
   ```
   Expected: `7 passed`.

5. - [ ] **Step 5: Commit.** Run:
   ```
   cd webapp/backend && git add app/api/traces.py tests/test_traces_patch.py && git commit -m "Add PATCH /api/traces/{short_id} for owner-only association edits

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
   ```

---

### Task 8: Dual-auth `DELETE /api/traces/{short_id}` (bearer token OR session cookie)

The existing `DELETE /api/traces/{short_id}` is bearer-token-only — it reads the `Authorization` header and calls `github.verify_token`. The Phase 3 web UI needs to delete a trace using session-cookie auth instead. Make the endpoint accept **either** form: a bearer GitHub token (existing CLI behavior, unchanged) **or** a session cookie (`get_current_user`). The owner check still holds — bearer path: `trace.owner_login` must equal the verified GitHub user's `login`; cookie path: `trace.owner_login` must equal the signed-in `User.github_login`. Missing both → 401; non-owner → 403. Soft-delete, best-effort blob cleanup, and the 204 response are unchanged.

**Files:**
- `webapp/backend/app/api/traces.py`
- `webapp/backend/tests/test_traces.py`

1. - [ ] **Step 1: Write the failing test for the cookie-auth delete path.** Append to `webapp/backend/tests/test_traces.py`:
   ```python
   @pytest.mark.asyncio
   async def test_delete_trace_with_session_cookie(client):
       sid = await _seed_standalone_trace(client, owner_login="alice")
       cookies, _ = await authed_cookies(client, login="alice")
       r = client.delete(f"/api/traces/{sid}", cookies=cookies)
       assert r.status_code == 204, r.text

       SessionLocal = client.app.state.session_maker
       async with SessionLocal() as session:
           trace = (await session.execute(
               select(Trace).where(Trace.short_id == sid)
           )).scalar_one()
       assert trace.deleted_at is not None


   @pytest.mark.asyncio
   async def test_delete_trace_cookie_non_owner_is_403(client):
       sid = await _seed_standalone_trace(client, owner_login="alice")
       cookies, _ = await authed_cookies(client, login="bob", github_id=200)
       r = client.delete(f"/api/traces/{sid}", cookies=cookies)
       assert r.status_code == 403

       SessionLocal = client.app.state.session_maker
       async with SessionLocal() as session:
           trace = (await session.execute(
               select(Trace).where(Trace.short_id == sid)
           )).scalar_one()
       assert trace.deleted_at is None


   @pytest.mark.asyncio
   async def test_delete_trace_no_auth_is_401(client):
       sid = await _seed_standalone_trace(client, owner_login="alice")
       r = client.delete(f"/api/traces/{sid}")
       assert r.status_code == 401
   ```
   This task assumes the test file has the `authed_cookies` helper and a `_seed_standalone_trace` helper available. `authed_cookies` is imported in other test modules as `from tests._auth_helpers import authed_cookies`; ensure `test_traces.py` has that import (add it next to its other imports if missing). For `_seed_standalone_trace`, if `test_traces.py` does not already define an equivalent helper, add this one near the top of the file (it mirrors the helper introduced in Task 7's `test_traces_patch.py`):
   ```python
   async def _seed_standalone_trace(client, *, owner_login: str) -> str:
       """Insert a standalone trace owned by owner_login; return its short_id."""
       from app.short_id import generate
       SessionLocal = client.app.state.session_maker
       sid = generate()
       async with SessionLocal() as session:
           session.add(Trace(
               short_id=sid,
               owner_login=owner_login,
               repo_full_name=None,
               pr_number=None,
               pr_url=None,
               pr_title=None,
               platform="web",
               plugin_version=None,
               session_id=None,
               byte_size=10,
               message_count=1,
               is_private=False,
               blob_path=None,
               blob_prefix=f"traces/{sid}/",
               agents=[],
               agent_count=0,
           ))
           await session.commit()
       return sid
   ```
   Also confirm `select` and `Trace` are imported in `test_traces.py` (they are used by the existing tests; add `from sqlalchemy import select` / `from app.storage.models import Trace` only if missing).

2. - [ ] **Step 2: Run the new tests, see them fail.** Run:
   ```
   cd webapp/backend && python -m pytest tests/test_traces.py -q -k delete_trace
   ```
   Expected: `test_delete_trace_with_session_cookie` fails with `401` (the endpoint still requires a bearer token, so a cookie-only request is rejected); `test_delete_trace_cookie_non_owner_is_403` fails for the same reason; `test_delete_trace_no_auth_is_401` already passes. Any pre-existing bearer-token delete tests still pass.

3. - [ ] **Step 3: Rework `delete_trace` to accept either auth form.** In `webapp/backend/app/api/traces.py`, replace the entire `delete_trace` route (the `@router.delete("/api/traces/{short_id}", status_code=204)` function) with:
   ```python
   @router.delete("/api/traces/{short_id}", status_code=204)
   async def delete_trace(
       short_id: str,
       authorization: Annotated[str | None, Header()] = None,
       session: AsyncSession = Depends(get_session),
       blob_store: BlobStore = Depends(get_blob_store),
       github: GitHubClient = Depends(get_github),
       user: User | None = Depends(get_current_user),
   ):
       if not looks_like_short_id(short_id):
           raise HTTPException(status_code=404)

       # Resolve the owner login from either a bearer GitHub token (CLI) or
       # a session cookie (web). Bearer wins when both are present so the
       # existing CLI behavior is unchanged.
       owner_login: str | None = None
       if authorization and authorization.lower().startswith("bearer "):
           token = authorization.split(None, 1)[1].strip()
           try:
               gh_user = await github.verify_token(token)
           except GitHubAuthError as e:
               raise HTTPException(status_code=401, detail=str(e))
           owner_login = gh_user.login
       elif user is not None:
           owner_login = user.github_login

       if owner_login is None:
           raise HTTPException(
               status_code=401, detail="missing bearer token or session"
           )

       stmt = select(Trace).where(
           Trace.short_id == short_id, Trace.deleted_at.is_(None)
       )
       trace = (await session.execute(stmt)).scalar_one_or_none()
       if trace is None:
           raise HTTPException(status_code=404)
       if trace.owner_login != owner_login:
           raise HTTPException(status_code=403, detail="not the trace owner")

       # Build the full key list before deleting (so a mid-flight crash
       # doesn't leave the DB row pointing at a half-deleted layout).
       keys_to_delete = []
       if trace.blob_prefix:
           keys_to_delete.append(f"{trace.blob_prefix}main.jsonl")
           for a in (trace.agents or []):
               keys_to_delete.append(f"{trace.blob_prefix}agents/{a['agent_id']}.jsonl")
               keys_to_delete.append(f"{trace.blob_prefix}agents/{a['agent_id']}.meta.json")
       elif trace.blob_path:
           keys_to_delete.append(trace.blob_path)

       # Soft-delete the row, then best-effort blob cleanup.
       trace.deleted_at = utcnow()
       await session.commit()

       for key in keys_to_delete:
           try:
               await blob_store.delete(key)
           except FileNotFoundError:
               pass
       return Response(status_code=204)
   ```
   `get_current_user`, `User`, `GitHubClient`, `GitHubAuthError`, `looks_like_short_id`, `utcnow`, `select`, `Header`, and `Response` are all already imported in `traces.py` — no new imports are needed.

4. - [ ] **Step 4: Run the delete tests, see all pass.** Run:
   ```
   cd webapp/backend && python -m pytest tests/test_traces.py -q -k delete_trace
   ```
   Expected: all `delete_trace` tests pass — the three new dual-auth tests plus any pre-existing bearer-token delete tests (the bearer path is unchanged).

5. - [ ] **Step 5: Run the full traces test file, see no regressions.** Run:
   ```
   cd webapp/backend && python -m pytest tests/test_traces.py -q
   ```
   Expected: all tests pass.

6. - [ ] **Step 6: Commit.** Run:
   ```
   cd webapp/backend && git add app/api/traces.py tests/test_traces.py && git commit -m "Accept session-cookie auth on DELETE /api/traces/{short_id}

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
   ```

---

### Task 9: GitHub picker endpoints

A new `/api/github` router with two picker endpoints, cookie auth + decrypted stored token. `my-repos` lists the user's owned + collaborated repos; `repo-prs` lists PRs the user authored in a repo. Both reuse the `github_stats.py` error-handling style via `PublicGitHubClient`.

**Files:**
- `webapp/backend/app/api/github_picker.py` (created)
- `webapp/backend/app/main.py`
- `webapp/backend/tests/test_github_picker.py` (created)

1. - [ ] **Step 1: Write the failing tests.** Create `webapp/backend/tests/test_github_picker.py`:
   ```python
   import pytest
   import respx

   from tests._auth_helpers import authed_cookies


   API = "https://api.github.test"


   @pytest.mark.asyncio
   async def test_my_repos_requires_auth(client):
       r = client.get("/api/github/my-repos")
       assert r.status_code == 403


   @pytest.mark.asyncio
   async def test_my_repos_lists_user_repos(
       client, respx_mock: respx.MockRouter,
   ):
       cookies, _ = await authed_cookies(
           client, login="alice", access_token="gho_alice"
       )
       respx_mock.get(f"{API}/user/repos").respond(
           200,
           json=[
               {"full_name": "alice/repo-a", "name": "repo-a",
                "private": False},
               {"full_name": "org/repo-b", "name": "repo-b",
                "private": True},
           ],
       )
       r = client.get("/api/github/my-repos", cookies=cookies)
       assert r.status_code == 200
       repos = r.json()["repos"]
       assert {x["full_name"] for x in repos} == {
           "alice/repo-a", "org/repo-b",
       }
       assert repos[0].keys() == {"full_name", "name", "private"}


   @pytest.mark.asyncio
   async def test_my_repos_filters_by_query(
       client, respx_mock: respx.MockRouter,
   ):
       cookies, _ = await authed_cookies(
           client, login="alice", access_token="gho_alice"
       )
       respx_mock.get(f"{API}/user/repos").respond(
           200,
           json=[
               {"full_name": "alice/alpha", "name": "alpha",
                "private": False},
               {"full_name": "alice/beta", "name": "beta",
                "private": False},
           ],
       )
       r = client.get("/api/github/my-repos?q=alph", cookies=cookies)
       assert r.status_code == 200
       assert [x["name"] for x in r.json()["repos"]] == ["alpha"]


   @pytest.mark.asyncio
   async def test_repo_prs_requires_auth(client):
       r = client.get("/api/github/repo-prs?repo=alice/repo")
       assert r.status_code == 403


   @pytest.mark.asyncio
   async def test_repo_prs_lists_authored_prs(
       client, respx_mock: respx.MockRouter,
   ):
       cookies, _ = await authed_cookies(
           client, login="alice", access_token="gho_alice"
       )
       respx_mock.get(f"{API}/repos/alice/repo/pulls").respond(
           200,
           json=[
               {"number": 7, "title": "Mine",
                "html_url": "https://github.com/alice/repo/pull/7",
                "user": {"login": "alice"}},
               {"number": 8, "title": "Theirs",
                "html_url": "https://github.com/alice/repo/pull/8",
                "user": {"login": "bob"}},
           ],
       )
       r = client.get("/api/github/repo-prs?repo=alice/repo", cookies=cookies)
       assert r.status_code == 200
       prs = r.json()["prs"]
       assert [p["number"] for p in prs] == [7]
       assert prs[0].keys() == {"number", "title", "html_url"}


   @pytest.mark.asyncio
   async def test_repo_prs_404_for_missing_repo(
       client, respx_mock: respx.MockRouter,
   ):
       cookies, _ = await authed_cookies(
           client, login="alice", access_token="gho_alice"
       )
       respx_mock.get(f"{API}/repos/alice/missing/pulls").respond(404)
       r = client.get(
           "/api/github/repo-prs?repo=alice/missing", cookies=cookies
       )
       assert r.status_code == 404
   ```

2. - [ ] **Step 2: Run the tests, see them fail.** Run:
   ```
   cd webapp/backend && python -m pytest tests/test_github_picker.py -q
   ```
   Expected: `404 Not Found` (route not registered).

3. - [ ] **Step 3: Create `app/api/github_picker.py`.** Create `webapp/backend/app/api/github_picker.py`:
   ```python
   from __future__ import annotations

   import logging

   from fastapi import APIRouter, Depends, HTTPException

   from app.api.github_stats import _handle_errors, _viewer_token
   from app.auth.sessions import get_current_user
   from app.deps import get_app_settings, get_public_github
   from app.github.public_client import PublicGitHubClient
   from app.settings import Settings
   from app.storage.models import User


   log = logging.getLogger(__name__)

   router = APIRouter(prefix="/api/github", tags=["github-picker"])


   @router.get("/my-repos")
   async def my_repos(
       q: str | None = None,
       user: User | None = Depends(get_current_user),
       settings: Settings = Depends(get_app_settings),
       gh: PublicGitHubClient = Depends(get_public_github),
   ):
       if user is None:
           raise HTTPException(status_code=403, detail="auth_required")
       token = _viewer_token(user, settings)
       if token is None:
           raise HTTPException(
               status_code=403, detail="github_token_unavailable"
           )
       try:
           payload = await gh.get_json(
               "/user/repos",
               viewer_token=token,
               params={"per_page": 100, "sort": "pushed", "affiliation":
                       "owner,collaborator"},
           )
       except Exception as exc:
           raise _handle_errors(exc, not_found_detail="repo_not_found") from exc

       needle = (q or "").strip().lower()
       repos = [
           {
               "full_name": r["full_name"],
               "name": r["name"],
               "private": bool(r.get("private", False)),
           }
           for r in payload
           if not needle or needle in r["full_name"].lower()
       ]
       return {"repos": repos}


   @router.get("/repo-prs")
   async def repo_prs(
       repo: str,
       q: str | None = None,
       user: User | None = Depends(get_current_user),
       settings: Settings = Depends(get_app_settings),
       gh: PublicGitHubClient = Depends(get_public_github),
   ):
       if user is None:
           raise HTTPException(status_code=403, detail="auth_required")
       token = _viewer_token(user, settings)
       if token is None:
           raise HTTPException(
               status_code=403, detail="github_token_unavailable"
           )
       parts = repo.strip().split("/")
       if len(parts) != 2 or not parts[0] or not parts[1]:
           raise HTTPException(status_code=400, detail=f"invalid repo: {repo}")
       owner, name = parts
       try:
           payload = await gh.get_json(
               f"/repos/{owner}/{name}/pulls",
               viewer_token=token,
               params={"state": "all", "per_page": 100, "sort": "updated",
                       "direction": "desc"},
           )
       except Exception as exc:
           raise _handle_errors(exc, not_found_detail="repo_not_found") from exc

       needle = (q or "").strip().lower()
       prs = [
           {
               "number": p["number"],
               "title": p.get("title") or "",
               "html_url": p["html_url"],
           }
           for p in payload
           if (p.get("user") or {}).get("login") == user.github_login
           and (not needle or needle in (p.get("title") or "").lower())
       ]
       return {"prs": prs}
   ```

4. - [ ] **Step 4: Register the router.** In `webapp/backend/app/main.py`, add `github_picker as github_picker_api` to the `from app.api import (...)` block, then add `app.include_router(github_picker_api.router)` after `app.include_router(github_stats_api.router)`.

5. - [ ] **Step 5: Run the tests, see all pass.** Run:
   ```
   cd webapp/backend && python -m pytest tests/test_github_picker.py -q
   ```
   Expected: `6 passed`.

6. - [ ] **Step 6: Commit.** Run:
   ```
   cd webapp/backend && git add app/api/github_picker.py app/main.py tests/test_github_picker.py && git commit -m "Add GitHub picker endpoints: /api/github/my-repos and /repo-prs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
   ```

---

### Task 10: Full-suite verification

**Files:** none (verification only).

1. - [ ] **Step 1: Run the entire backend test suite.** Run:
   ```
   cd webapp/backend && python -m pytest -q
   ```
   Expected: all tests pass, exit code 0. If `test_e2e.py` or `test_traces.py` reference the old `/{owner}/{repo}/pull/{n}/{sid}` trace-URL shape, update those assertions to the `/t/<sid>` form (the change was made in Task 5) and re-run.

2. - [ ] **Step 2: Confirm the app boots with all routers.** Run:
   ```
   cd webapp/backend && python -c "from app.main import create_app; app = create_app(); paths = sorted({r.path for r in app.routes}); assert '/api/uploads' in paths and '/api/github/my-repos' in paths and '/api/github/repo-prs' in paths, paths; print('routers OK')"
   ```
   Expected: `routers OK`.

3. - [ ] **Step 3: Final commit (only if Step 1 required test edits).** Run:
   ```
   cd webapp/backend && git add -A && git commit -m "Update remaining tests for /t/<short_id> trace URLs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
   ```
   If no files changed, skip this step.

---

## Notes for the implementer

- **Phase-1 dependency:** every task that imports `app.api.trace_service` (Tasks 4-7) assumes Phase 1 delivered `create_or_update_trace` and `TraceWriteResult`. If `trace_service.py` does not exist when Task 4 starts, Phase 1 is incomplete — stop and resolve that first.
- **`resolve_association` raises `HTTPException`** directly. That is intentional: it is only ever called from request handlers, so the exceptions propagate as HTTP responses without per-caller translation. The unit tests in Task 4 assert on `exc.value.status_code`.
- **`owner_login` source:** `/api/ingest` uses the token user's `login` (`GitHubUser.login`); `/api/uploads` and `PATCH` use the session user's `github_login` (`User.github_login`). Both are the GitHub login string — keep them consistent.
- **No PR comment** is posted by `/api/uploads` or `PATCH` — only the CLI `/api/ingest` path posts comments, and that behavior is unchanged here (it lives in the CLI, Phase 4).
- **`Cache-Control: no-store`** on gated errors is handled by Phase 1's `_require_trace_access`; the `PATCH` route does not serve trace content, so it does not need that header.
- **`python-multipart`** must be installed (Task 3) before Task 6, or FastAPI raises at import time when `app/api/uploads.py` declares `File`/`Form` params.
