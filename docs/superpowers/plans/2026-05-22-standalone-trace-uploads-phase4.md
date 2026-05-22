# Standalone Trace Uploads — Phase 4: CLI /share-trace — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the PR-bound `/share-pr` command with `/share-trace`, which detects an open PR, then a GitHub repo, then falls back to a standalone (public) trace upload.

**Architecture:** `/share-trace` is a thin CLI entry point that resolves an upload target in three tiers (PR → repo → standalone) and feeds it into the shared `run_share_pipeline`. The pipeline's `RunOptions` and the `upload_bundle` HTTP layer become PR-optional and gain a `repo_full_name` path that sends the new `X-Vibeshub-Repo` header; the PR-comment step is skipped whenever no PR is present. The auto `gh pr create` hook keeps passing a `pr_url` and is untouched.

**Tech Stack:** Python 3.13, `urllib` for HTTP, `subprocess` + `gh` CLI for GitHub, pytest + pytest-asyncio for tests, FastAPI/uvicorn for the e2e fake server.

---

## File Structure

### Created
- `plugins/claude-code/commands/share-trace.md` — slash-command manifest for `/share-trace`; documents the PR/repo/standalone resolution and the `delete` subcommand. Invokes `share-trace.py`.
- `plugins/claude-code/commands/share-trace.py` — CLI entry point: resolves the upload target (PR / repo / standalone), runs `run_share_pipeline`, and implements `delete` accepting a PR URL, a `/t/<id>` URL, or a bare short id.
- `plugins/claude-code/vibeshub_client/repo_resolve.py` — `resolve_repo_full_name()`: derives the current repo's `owner/name` from the GitHub remote via `gh repo view`.
- `plugins/claude-code/tests/test_repo_resolve.py` — unit tests for `resolve_repo_full_name`.
- `plugins/claude-code/tests/test_share_trace.py` — unit tests for `share-trace.py` (`_session_id`, the delete-id parser, the resolution order).

### Modified
- `plugins/claude-code/vibeshub_client/pipeline.py` — `RunOptions.pr_url` becomes `Optional[str]`; add `repo_full_name: Optional[str]`; pass `repo_full_name` to `upload_bundle`; run the PR-comment step only when `pr_url` is set.
- `plugins/claude-code/vibeshub_client/upload.py` — `upload_bundle`'s `pr_url` param becomes optional; add `repo_full_name: str | None`; send `X-Vibeshub-Pr-Url` / `X-Vibeshub-Repo` only when their value is set.
- `plugins/claude-code/tests/test_pipeline.py` — update fake `upload_bundle` signatures for the new `repo_full_name` kwarg; add repo-only and standalone pipeline tests.
- `plugins/claude-code/tests/test_upload.py` — update the shared `_upload` helper; add header-presence/absence tests for the PR / repo / standalone cases.
- `plugins/claude-code/tests/test_hook_e2e.py` — the fake `/api/ingest` makes `X-Vibeshub-Pr-Url` optional and accepts `X-Vibeshub-Repo` (hook behavior itself is unchanged).
- `plugins/claude-code/README.md` — replace `/share-pr` references with `/share-trace` and document the standalone case.

### Deleted
- `plugins/claude-code/commands/share-pr.md` — replaced by `share-trace.md`.
- `plugins/claude-code/commands/share-pr.py` — replaced by `share-trace.py`.
- `plugins/claude-code/tests/test_share_pr.py` — replaced by `test_share_trace.py`.

### Unchanged (verify only)
- `plugins/claude-code/hooks/on-pr-share.py`, `hooks/hooks.json` — the auto `gh pr create` hook stays PR-based and must keep passing all its existing tests.

---

## Task 1: `upload_bundle` — optional PR header, new repo header

**Files:**
- `plugins/claude-code/vibeshub_client/upload.py`
- `plugins/claude-code/tests/test_upload.py`

1. - [ ] **Step 1: Update the shared `_upload` test helper to accept new kwargs.**
   In `plugins/claude-code/tests/test_upload.py`, replace the `_upload` helper (currently lines ~176-187) with:
   ```python
   async def _upload(**overrides):
       kwargs = dict(
           server_url="https://vibeshub.test",
           token="ghp_test",
           tar_bytes=b"tar",
           pr_url="https://github.com/alice/repo/pull/3",
           repo_full_name=None,
           plugin_version="0.2.0",
           session_id=None,
           redaction_count_client=0,
       )
       kwargs.update(overrides)
       return await upload_bundle(**kwargs)
   ```

2. - [ ] **Step 2: Write a failing test for the standalone case (neither header sent).**
   Add to `plugins/claude-code/tests/test_upload.py`:
   ```python
   @pytest.mark.asyncio
   async def test_upload_standalone_sends_no_pr_or_repo_header():
       captured: dict = {}

       def fake_urlopen(req, timeout=None):
           captured["headers"] = dict(req.header_items())
           return _ok_response()

       with patch("vibeshub_client.upload.urllib_request.urlopen", side_effect=fake_urlopen):
           await upload_bundle(
               server_url="https://vibeshub.test",
               token="ghp_test",
               tar_bytes=b"tar",
               pr_url=None,
               repo_full_name=None,
               plugin_version="0.2.0",
               session_id=None,
               redaction_count_client=0,
           )

       assert "X-vibeshub-pr-url" not in captured["headers"]
       assert "X-vibeshub-repo" not in captured["headers"]
   ```

3. - [ ] **Step 3: Write a failing test for the repo-only case (`X-Vibeshub-Repo` sent, no PR header).**
   Add to `plugins/claude-code/tests/test_upload.py`:
   ```python
   @pytest.mark.asyncio
   async def test_upload_repo_only_sends_repo_header_not_pr_header():
       captured: dict = {}

       def fake_urlopen(req, timeout=None):
           captured["headers"] = dict(req.header_items())
           return _ok_response()

       with patch("vibeshub_client.upload.urllib_request.urlopen", side_effect=fake_urlopen):
           await upload_bundle(
               server_url="https://vibeshub.test",
               token="ghp_test",
               tar_bytes=b"tar",
               pr_url=None,
               repo_full_name="alice/repo",
               plugin_version="0.2.0",
               session_id=None,
               redaction_count_client=0,
           )

       assert "X-vibeshub-pr-url" not in captured["headers"]
       assert captured["headers"]["X-vibeshub-repo"] == "alice/repo"
   ```

4. - [ ] **Step 4: Run the new tests and see them fail.**
   ```
   cd /Users/bhavya/git/vibeshub/plugins/claude-code && python3 -m pytest tests/test_upload.py -k "standalone or repo_only" -q
   ```
   Expected: a `TypeError` about `upload_bundle()` receiving an unexpected `repo_full_name` keyword argument (2 failed).

5. - [ ] **Step 5: Make `upload_bundle` accept the optional PR header and the new repo header.**
   In `plugins/claude-code/vibeshub_client/upload.py`, replace the `upload_bundle` function (currently lines ~164-201) with:
   ```python
   async def upload_bundle(
       *,
       server_url: str,
       token: str,
       tar_bytes: bytes,
       pr_url: str | None,
       repo_full_name: str | None,
       plugin_version: str,
       session_id: str | None,
       redaction_count_client: int,
       timeout: float = 60.0,
   ) -> UploadResult:
       url = f"{server_url.rstrip('/')}/api/ingest"
       headers = {
           "Authorization": f"Bearer {token}",
           "Content-Type": "application/x-tar",
           "X-Vibeshub-Platform": "claude-code",
           "X-Vibeshub-Plugin-Version": plugin_version,
           "X-Vibeshub-Client-Redactions": str(redaction_count_client),
       }
       if pr_url:
           headers["X-Vibeshub-Pr-Url"] = pr_url
       if repo_full_name:
           headers["X-Vibeshub-Repo"] = repo_full_name
       if session_id:
           headers["X-Vibeshub-Session-Id"] = session_id

       status, raw = await asyncio.to_thread(
           _post_bytes, url, headers=headers, body=tar_bytes, timeout=timeout,
       )

       if status != 201:
           text = raw.decode("utf-8", errors="replace")
           raise UploadError(f"upload failed: {status} {text}")

       data = json.loads(raw.decode("utf-8"))
       return UploadResult(
           trace_id=data["trace_id"],
           short_id=data["short_id"],
           trace_url=data["trace_url"],
           created=data.get("created", True),
       )
   ```

6. - [ ] **Step 6: Run the new tests and see them pass.**
   ```
   cd /Users/bhavya/git/vibeshub/plugins/claude-code && python3 -m pytest tests/test_upload.py -k "standalone or repo_only" -q
   ```
   Expected: `2 passed`.

7. - [ ] **Step 7: Run the full upload suite to confirm no regression.**
   ```
   cd /Users/bhavya/git/vibeshub/plugins/claude-code && python3 -m pytest tests/test_upload.py -q
   ```
   Expected: all tests pass (the existing PR-based tests still send `X-Vibeshub-Pr-Url` because the `_upload` helper defaults `pr_url` to a PR URL and the explicit-call tests pass `pr_url`).

8. - [ ] **Step 8: Commit.**
   ```
   cd /Users/bhavya/git/vibeshub && git add plugins/claude-code/vibeshub_client/upload.py plugins/claude-code/tests/test_upload.py && git commit -m "$(cat <<'EOF'
   Make upload_bundle PR-optional and add X-Vibeshub-Repo header

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 2: `RunOptions` — optional PR, add `repo_full_name`, conditional comment

**Files:**
- `plugins/claude-code/vibeshub_client/pipeline.py`
- `plugins/claude-code/tests/test_pipeline.py`

1. - [ ] **Step 1: Update the existing fake `upload_bundle` signatures in `test_pipeline.py`.**
   In `plugins/claude-code/tests/test_pipeline.py`, both `fake_upload` functions declare `pr_url` in their kwargs. Update each to add `repo_full_name`. In `test_pipeline_builds_bundle_with_agents` replace the `fake_upload` signature line:
   ```python
       async def fake_upload(
           *, server_url, token, tar_bytes, pr_url, repo_full_name,
           plugin_version, session_id, redaction_count_client, timeout=60.0,
       ):
   ```
   and add `captured["repo_full_name"] = repo_full_name` directly below the existing `captured["pr_url"] = pr_url` line. In `test_pipeline_skips_comment_when_trace_not_created` replace its `fake_upload` signature with the same new signature above.

2. - [ ] **Step 2: Run the pipeline suite and see it fail.**
   ```
   cd /Users/bhavya/git/vibeshub/plugins/claude-code && python3 -m pytest tests/test_pipeline.py -q
   ```
   Expected: failures — `run_share_pipeline` still calls `upload_bundle` without `repo_full_name`, so the fakes raise `TypeError: fake_upload() missing 1 required keyword-only argument: 'repo_full_name'`.

3. - [ ] **Step 3: Write a failing test for the standalone pipeline (no PR, no comment).**
   Add to `plugins/claude-code/tests/test_pipeline.py`:
   ```python
   @pytest.mark.asyncio
   async def test_pipeline_standalone_uploads_without_comment(tmp_path):
       project_root = tmp_path / "projects" / "-fake-cwd"
       project_root.mkdir(parents=True)
       (project_root / "sess1.jsonl").write_bytes(
           (FIXTURES / "single-agent" / "session.jsonl").read_bytes()
       )
       session_dir = project_root / "sess1"
       session_dir.mkdir()
       (session_dir / "subagents").mkdir()
       for f in (FIXTURES / "single-agent" / "subagents").iterdir():
           (session_dir / "subagents" / f.name).write_bytes(f.read_bytes())

       reader = ClaudeCodeTranscriptReader()
       hook_input = {
           "session_id": "sess1",
           "cwd": "/fake/cwd",
           "transcript_path": str(project_root / "sess1.jsonl"),
       }

       captured: dict = {}

       async def fake_upload(
           *, server_url, token, tar_bytes, pr_url, repo_full_name,
           plugin_version, session_id, redaction_count_client, timeout=60.0,
       ):
           captured["pr_url"] = pr_url
           captured["repo_full_name"] = repo_full_name
           return UploadResult(trace_id="t1", short_id="abc", trace_url="https://x/t/abc")

       with patch("vibeshub_client.pipeline.upload_bundle", new=fake_upload), \
            patch("vibeshub_client.pipeline.post_pr_comment") as mock_comment:
           result = await run_share_pipeline(
               reader=reader,
               hook_input=hook_input,
               options=RunOptions(
                   server_url="https://x",
                   token="t",
                   pr_url=None,
                   repo_full_name=None,
                   session_id="sess1",
               ),
           )

       assert result.uploaded is True
       assert result.trace_url == "https://x/t/abc"
       assert captured["pr_url"] is None
       assert captured["repo_full_name"] is None
       mock_comment.assert_not_called()
   ```

4. - [ ] **Step 4: Write a failing test for the repo-only pipeline (repo passed, no comment).**
   Add to `plugins/claude-code/tests/test_pipeline.py`:
   ```python
   @pytest.mark.asyncio
   async def test_pipeline_repo_only_uploads_without_comment(tmp_path):
       project_root = tmp_path / "projects" / "-fake-cwd"
       project_root.mkdir(parents=True)
       (project_root / "sess1.jsonl").write_bytes(
           (FIXTURES / "single-agent" / "session.jsonl").read_bytes()
       )
       session_dir = project_root / "sess1"
       session_dir.mkdir()
       (session_dir / "subagents").mkdir()
       for f in (FIXTURES / "single-agent" / "subagents").iterdir():
           (session_dir / "subagents" / f.name).write_bytes(f.read_bytes())

       reader = ClaudeCodeTranscriptReader()
       hook_input = {
           "session_id": "sess1",
           "cwd": "/fake/cwd",
           "transcript_path": str(project_root / "sess1.jsonl"),
       }

       captured: dict = {}

       async def fake_upload(
           *, server_url, token, tar_bytes, pr_url, repo_full_name,
           plugin_version, session_id, redaction_count_client, timeout=60.0,
       ):
           captured["pr_url"] = pr_url
           captured["repo_full_name"] = repo_full_name
           return UploadResult(trace_id="t1", short_id="abc", trace_url="https://x/t/abc")

       with patch("vibeshub_client.pipeline.upload_bundle", new=fake_upload), \
            patch("vibeshub_client.pipeline.post_pr_comment") as mock_comment:
           result = await run_share_pipeline(
               reader=reader,
               hook_input=hook_input,
               options=RunOptions(
                   server_url="https://x",
                   token="t",
                   pr_url=None,
                   repo_full_name="alice/repo",
                   session_id="sess1",
               ),
           )

       assert result.uploaded is True
       assert captured["pr_url"] is None
       assert captured["repo_full_name"] == "alice/repo"
       mock_comment.assert_not_called()
   ```

5. - [ ] **Step 5: Run the two new tests and see them fail.**
   ```
   cd /Users/bhavya/git/vibeshub/plugins/claude-code && python3 -m pytest tests/test_pipeline.py -k "standalone or repo_only" -q
   ```
   Expected: 2 failed — `RunOptions.__init__()` got an unexpected keyword argument `repo_full_name`.

6. - [ ] **Step 6: Update `RunOptions` and `run_share_pipeline`.**
   In `plugins/claude-code/vibeshub_client/pipeline.py`, replace the `RunOptions` dataclass (currently lines ~18-23) with:
   ```python
   @dataclass
   class RunOptions:
       server_url: str
       token: str
       pr_url: Optional[str] = None
       repo_full_name: Optional[str] = None
       session_id: Optional[str] = None
   ```
   Then replace the `upload_bundle(...)` call inside `run_share_pipeline` (currently lines ~55-63) with:
   ```python
       try:
           result = await upload_bundle(
               server_url=options.server_url,
               token=options.token,
               tar_bytes=tar_bytes,
               pr_url=options.pr_url,
               repo_full_name=options.repo_full_name,
               plugin_version=PLUGIN_VERSION,
               session_id=options.session_id,
               redaction_count_client=report.total(),
           )
   ```
   Then replace the comment block (currently `if result.created:` ... through the `post_pr_comment` call, lines ~73-88) with:
   ```python
       if result.created and options.pr_url:
           try:
               post_pr_comment(
                   pr_url=options.pr_url,
                   body=build_comment_body(result.trace_url),
               )
           except RuntimeError as e:
               return RunResult(
                   uploaded=True,
                   short_id=result.short_id,
                   trace_url=result.trace_url,
                   skip_reason=f"comment failed: {e}",
                   payload_bytes=payload_bytes,
                   upload_elapsed_seconds=elapsed,
                   created=result.created,
               )
   ```

7. - [ ] **Step 7: Run the full pipeline suite and see it pass.**
   ```
   cd /Users/bhavya/git/vibeshub/plugins/claude-code && python3 -m pytest tests/test_pipeline.py -q
   ```
   Expected: all tests pass (4 originally-relevant + the 2 new = the full file green). The existing PR test still posts a comment because it passes `pr_url`.

8. - [ ] **Step 8: Commit.**
   ```
   cd /Users/bhavya/git/vibeshub && git add plugins/claude-code/vibeshub_client/pipeline.py plugins/claude-code/tests/test_pipeline.py && git commit -m "$(cat <<'EOF'
   Make RunOptions PR-optional with repo_full_name; skip comment when no PR

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 3: Repo detection helper (`resolve_repo_full_name`)

**Files:**
- `plugins/claude-code/vibeshub_client/repo_resolve.py`
- `plugins/claude-code/tests/test_repo_resolve.py`

1. - [ ] **Step 1: Write a failing test file for `resolve_repo_full_name`.**
   Create `plugins/claude-code/tests/test_repo_resolve.py`:
   ```python
   import subprocess
   from unittest.mock import patch

   from vibeshub_client.repo_resolve import resolve_repo_full_name


   def test_resolve_repo_full_name_returns_owner_slash_name():
       fake = subprocess.CompletedProcess(
           args=[], returncode=0,
           stdout="alice/repo\n", stderr="",
       )
       with patch("vibeshub_client.repo_resolve.subprocess.run", return_value=fake) as run:
           assert resolve_repo_full_name() == "alice/repo"
           assert run.call_args.args[0] == [
               "gh", "repo", "view", "--json", "nameWithOwner",
               "-q", ".nameWithOwner",
           ]


   def test_resolve_repo_full_name_passes_cwd():
       fake = subprocess.CompletedProcess(
           args=[], returncode=0,
           stdout="alice/repo\n", stderr="",
       )
       with patch("vibeshub_client.repo_resolve.subprocess.run", return_value=fake) as run:
           resolve_repo_full_name(cwd="/some/repo")
           assert run.call_args.kwargs["cwd"] == "/some/repo"


   def test_resolve_repo_full_name_returns_none_when_no_github_remote():
       def boom(*args, **kwargs):
           raise subprocess.CalledProcessError(1, args[0], stderr="no remote")

       with patch("vibeshub_client.repo_resolve.subprocess.run", side_effect=boom):
           assert resolve_repo_full_name() is None


   def test_resolve_repo_full_name_returns_none_when_gh_missing():
       with patch("vibeshub_client.repo_resolve.subprocess.run", side_effect=OSError):
           assert resolve_repo_full_name() is None


   def test_resolve_repo_full_name_returns_none_on_empty_output():
       fake = subprocess.CompletedProcess(
           args=[], returncode=0, stdout="\n", stderr="",
       )
       with patch("vibeshub_client.repo_resolve.subprocess.run", return_value=fake):
           assert resolve_repo_full_name() is None
   ```

2. - [ ] **Step 2: Run the new test file and see it fail.**
   ```
   cd /Users/bhavya/git/vibeshub/plugins/claude-code && python3 -m pytest tests/test_repo_resolve.py -q
   ```
   Expected: collection error — `ModuleNotFoundError: No module named 'vibeshub_client.repo_resolve'`.

3. - [ ] **Step 3: Implement `resolve_repo_full_name`.**
   Create `plugins/claude-code/vibeshub_client/repo_resolve.py`:
   ```python
   from __future__ import annotations

   import subprocess


   def resolve_repo_full_name(*, cwd: str | None = None) -> str | None:
       """The current repo's `owner/name`, derived from its GitHub remote.

       Runs `gh repo view`, which inspects the git remotes and resolves the
       repo on GitHub. Returns None when the directory is not a git repo, has
       no GitHub remote, or `gh` is not installed — i.e. whenever no repo can
       be attached to a trace.

       `cwd` is the directory `gh` runs in (defaults to the process cwd).
       """
       try:
           result = subprocess.run(
               ["gh", "repo", "view", "--json", "nameWithOwner",
                "-q", ".nameWithOwner"],
               check=True,
               capture_output=True,
               text=True,
               cwd=cwd,
           )
       except (subprocess.SubprocessError, OSError):
           return None
       name = result.stdout.strip()
       return name or None
   ```

4. - [ ] **Step 4: Run the new test file and see it pass.**
   ```
   cd /Users/bhavya/git/vibeshub/plugins/claude-code && python3 -m pytest tests/test_repo_resolve.py -q
   ```
   Expected: `5 passed`.

5. - [ ] **Step 5: Commit.**
   ```
   cd /Users/bhavya/git/vibeshub && git add plugins/claude-code/vibeshub_client/repo_resolve.py plugins/claude-code/tests/test_repo_resolve.py && git commit -m "$(cat <<'EOF'
   Add resolve_repo_full_name for repo detection from the git remote

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 4: `share-trace.py` — delete-id parsing

This task builds the new command file with only its `delete`-related helpers first, so the id-parsing logic is fully tested before the resolution logic is layered on in Task 5.

**Files:**
- `plugins/claude-code/commands/share-trace.py`
- `plugins/claude-code/tests/test_share_trace.py`

1. - [ ] **Step 1: Write a failing test file for the delete-id parser and `_session_id`.**
   Create `plugins/claude-code/tests/test_share_trace.py`:
   ```python
   import importlib.util
   import os
   from pathlib import Path
   from unittest.mock import patch

   _SHARE_TRACE_PATH = (
       Path(__file__).resolve().parent.parent / "commands" / "share-trace.py"
   )


   def _load_share_trace():
       """share-trace.py has a hyphen so it can't be imported normally; load
       it by path. Module-load has no side effects (only defs + a __main__
       guard)."""
       spec = importlib.util.spec_from_file_location(
           "share_trace_cmd", _SHARE_TRACE_PATH
       )
       mod = importlib.util.module_from_spec(spec)
       spec.loader.exec_module(mod)
       return mod


   def test_session_id_prefers_claude_code_session_id():
       mod = _load_share_trace()
       with patch.dict(
           os.environ,
           {"CLAUDE_CODE_SESSION_ID": "from-cc", "CLAUDE_SESSION_ID": "legacy"},
           clear=True,
       ):
           assert mod._session_id() == "from-cc"


   def test_session_id_falls_back_to_legacy_var():
       mod = _load_share_trace()
       with patch.dict(os.environ, {"CLAUDE_SESSION_ID": "legacy"}, clear=True):
           assert mod._session_id() == "legacy"


   def test_session_id_is_none_when_unset():
       mod = _load_share_trace()
       with patch.dict(os.environ, {}, clear=True):
           assert mod._session_id() is None


   def test_delete_short_id_from_bare_id():
       mod = _load_share_trace()
       assert mod._delete_short_id("abc1234567", "https://vibeshub.ai") == (
           "abc1234567"
       )


   def test_delete_short_id_from_t_url():
       mod = _load_share_trace()
       assert mod._delete_short_id(
           "https://vibeshub.ai/t/abc1234567", "https://vibeshub.ai"
       ) == "abc1234567"


   def test_delete_short_id_from_t_url_with_trailing_slash():
       mod = _load_share_trace()
       assert mod._delete_short_id(
           "https://vibeshub.ai/t/abc1234567/", "https://vibeshub.ai"
       ) == "abc1234567"


   def test_delete_short_id_returns_none_for_pr_url():
       mod = _load_share_trace()
       assert mod._delete_short_id(
           "https://github.com/alice/repo/pull/3", "https://vibeshub.ai"
       ) is None
   ```

2. - [ ] **Step 2: Run the new test file and see it fail.**
   ```
   cd /Users/bhavya/git/vibeshub/plugins/claude-code && python3 -m pytest tests/test_share_trace.py -q
   ```
   Expected: collection error — `share-trace.py` does not exist (`FileNotFoundError` / `spec` is None).

3. - [ ] **Step 3: Create `share-trace.py` with `_session_id`, `_delete_short_id`, and the delete flow.**
   Create `plugins/claude-code/commands/share-trace.py`:
   ```python
   #!/usr/bin/env python3
   """
   Manual upload / delete entry point for vibeshub.

   Usage:
     share-trace                       # auto-detect: PR, else repo, else standalone
     share-trace <pr-url-or-number>    # share a specific PR
     share-trace delete <id>           # delete a trace by PR URL, /t/<id> URL,
                                       # or bare short id
   """
   from __future__ import annotations

   import asyncio
   import os
   import re
   import sys
   from pathlib import Path

   _SHORT_ID_RE = re.compile(r"^[A-Za-z0-9]+$")


   def _session_id() -> str | None:
       """The current Claude Code session id. Claude Code exports
       CLAUDE_CODE_SESSION_ID; CLAUDE_SESSION_ID is accepted as a legacy/manual
       fallback."""
       return os.environ.get("CLAUDE_CODE_SESSION_ID") or os.environ.get(
           "CLAUDE_SESSION_ID"
       )


   def _delete_short_id(arg: str, server_url: str) -> str | None:
       """Resolve a delete argument to a trace short id, or None if `arg` is
       not a short id form (e.g. it is a PR URL — the caller resolves that
       separately).

       Accepts a bare short id (`abc1234567`) or a `<server>/t/<id>` URL.
       """
       value = arg.rstrip("/")
       if "/t/" in value:
           return value.rsplit("/t/", 1)[1] or None
       if "://" in value or "/" in value:
           return None
       return value if _SHORT_ID_RE.match(value) else None


   def _server_base(server_url: str) -> str:
       return server_url.rstrip("/")


   async def _delete_by_short_id(short_id: str, server_url: str) -> None:
       from urllib import error as urllib_error
       from urllib import request as urllib_request

       from vibeshub_client.gh_token import get_gh_token

       def _do_delete(token: str) -> tuple[int, str]:
           req = urllib_request.Request(
               f"{_server_base(server_url)}/api/traces/{short_id}",
               headers={"Authorization": f"Bearer {token}"},
               method="DELETE",
           )
           try:
               with urllib_request.urlopen(req, timeout=15.0) as resp:
                   return resp.status, resp.read().decode("utf-8", errors="replace")
           except urllib_error.HTTPError as e:
               return e.code, e.read().decode("utf-8", errors="replace")

       token = get_gh_token()
       status, body = await asyncio.to_thread(_do_delete, token)
       if status == 204:
           print(f"deleted trace {short_id}")
       else:
           print(f"delete failed: {status} {body}", file=sys.stderr)


   async def _delete_by_pr(pr_url: str, server_url: str) -> None:
       import json
       from urllib import request as urllib_request

       parts = pr_url.rstrip("/").split("/")
       owner, repo, number = parts[-4], parts[-3], parts[-1]
       list_url = (
           f"{_server_base(server_url)}/api/traces/{owner}/{repo}/pull/{number}"
       )

       def _list() -> list[dict]:
           with urllib_request.urlopen(list_url, timeout=15.0) as resp:
               if resp.status >= 400:
                   raise RuntimeError(f"list failed: HTTP {resp.status}")
               data = json.loads(resp.read().decode("utf-8"))
           return data.get("traces", [])

       traces = await asyncio.to_thread(_list)
       if not traces:
           print("no traces found for that PR", file=sys.stderr)
           return
       await _delete_by_short_id(traces[0]["short_id"], server_url)


   def main() -> None:
       args = sys.argv[1:]
       server_url = os.environ.get("VIBESHUB_SERVER_URL", "https://vibeshub.ai")
       session_id = _session_id()

       plugin_root = Path(
           os.environ.get(
               "CLAUDE_PLUGIN_ROOT", Path(__file__).resolve().parent.parent
           )
       )
       if str(plugin_root) not in sys.path:
           sys.path.insert(0, str(plugin_root))

       from vibeshub_client.pr_resolve import resolve_pr_url

       if args and args[0] == "delete":
           if len(args) < 2:
               print(
                   "usage: share-trace delete <pr-url | /t/<id> url | short-id>",
                   file=sys.stderr,
               )
               sys.exit(1)
           short_id = _delete_short_id(args[1], server_url)
           if short_id is not None:
               asyncio.run(_delete_by_short_id(short_id, server_url))
           else:
               asyncio.run(_delete_by_pr(resolve_pr_url(args[1]), server_url))
           return

       asyncio.run(_share(args, server_url, session_id))


   if __name__ == "__main__":
       main()
   ```
   Note: `_share` is referenced by `main` but defined in Task 5; module load only runs `def`s and the `__main__` guard, so the test file (which calls `_session_id` / `_delete_short_id` and never `main`) loads cleanly.

4. - [ ] **Step 4: Run the new test file and see it pass.**
   ```
   cd /Users/bhavya/git/vibeshub/plugins/claude-code && python3 -m pytest tests/test_share_trace.py -q
   ```
   Expected: `7 passed`.

5. - [ ] **Step 5: Commit.**
   ```
   cd /Users/bhavya/git/vibeshub && git add plugins/claude-code/commands/share-trace.py plugins/claude-code/tests/test_share_trace.py && git commit -m "$(cat <<'EOF'
   Add share-trace.py with delete-by-id parsing for PR / t-url / short id

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 5: `share-trace.py` — PR → repo → standalone resolution

**Files:**
- `plugins/claude-code/commands/share-trace.py`
- `plugins/claude-code/tests/test_share_trace.py`

1. - [ ] **Step 1: Write a failing test for the PR resolution path.**
   Add to `plugins/claude-code/tests/test_share_trace.py`:
   ```python
   import subprocess


   def test_resolve_target_prefers_pr():
       mod = _load_share_trace()
       with patch.object(mod, "resolve_pr_url", return_value="https://github.com/a/r/pull/9"), \
            patch.object(mod, "resolve_repo_full_name") as repo:
           pr_url, repo_full_name = mod._resolve_target(arg=None)
       assert pr_url == "https://github.com/a/r/pull/9"
       assert repo_full_name is None
       repo.assert_not_called()
   ```

2. - [ ] **Step 2: Write a failing test for the repo fallback path.**
   Add to `plugins/claude-code/tests/test_share_trace.py`:
   ```python
   def test_resolve_target_falls_back_to_repo_when_no_pr():
       mod = _load_share_trace()

       def no_pr(arg, cwd=None):
           raise subprocess.CalledProcessError(1, "gh", stderr="no PR")

       with patch.object(mod, "resolve_pr_url", side_effect=no_pr), \
            patch.object(mod, "resolve_repo_full_name", return_value="alice/repo"):
           pr_url, repo_full_name = mod._resolve_target(arg=None)
       assert pr_url is None
       assert repo_full_name == "alice/repo"
   ```

3. - [ ] **Step 3: Write a failing test for the standalone fallback path.**
   Add to `plugins/claude-code/tests/test_share_trace.py`:
   ```python
   def test_resolve_target_falls_back_to_standalone_when_no_pr_or_repo():
       mod = _load_share_trace()

       def no_pr(arg, cwd=None):
           raise subprocess.CalledProcessError(1, "gh", stderr="no PR")

       with patch.object(mod, "resolve_pr_url", side_effect=no_pr), \
            patch.object(mod, "resolve_repo_full_name", return_value=None):
           pr_url, repo_full_name = mod._resolve_target(arg=None)
       assert pr_url is None
       assert repo_full_name is None
   ```

4. - [ ] **Step 4: Write a failing test that an explicit PR arg skips repo detection.**
   Add to `plugins/claude-code/tests/test_share_trace.py`:
   ```python
   def test_resolve_target_uses_explicit_pr_arg():
       mod = _load_share_trace()
       with patch.object(
           mod, "resolve_pr_url", return_value="https://github.com/a/r/pull/4"
       ) as pr, patch.object(mod, "resolve_repo_full_name") as repo:
           pr_url, repo_full_name = mod._resolve_target(arg="4")
       assert pr_url == "https://github.com/a/r/pull/4"
       assert repo_full_name is None
       assert pr.call_args.args[0] == "4"
       repo.assert_not_called()
   ```

5. - [ ] **Step 5: Run the four new tests and see them fail.**
   ```
   cd /Users/bhavya/git/vibeshub/plugins/claude-code && python3 -m pytest tests/test_share_trace.py -k resolve_target -q
   ```
   Expected: 4 failed — `module 'share_trace_cmd' has no attribute '_resolve_target'` (and no `resolve_pr_url` / `resolve_repo_full_name` at module scope).

6. - [ ] **Step 6: Add module-level imports, `_resolve_target`, and `_share` to `share-trace.py`.**
   In `plugins/claude-code/commands/share-trace.py`, the imports of `resolve_pr_url` and `resolve_repo_full_name` must be at module scope so the tests can `patch.object` them. Insert this block immediately after the `_SHORT_ID_RE = ...` line near the top of the file:
   ```python
   # The plugin root must be importable before the vibeshub_client imports
   # below. CLAUDE_PLUGIN_ROOT is set by Claude Code; fall back to this file's
   # grandparent when the module is imported directly (e.g. by tests).
   _PLUGIN_ROOT = Path(
       os.environ.get(
           "CLAUDE_PLUGIN_ROOT", Path(__file__).resolve().parent.parent
       )
   )
   if str(_PLUGIN_ROOT) not in sys.path:
       sys.path.insert(0, str(_PLUGIN_ROOT))

   from vibeshub_client.pr_resolve import resolve_pr_url  # noqa: E402
   from vibeshub_client.repo_resolve import resolve_repo_full_name  # noqa: E402
   ```
   Then add these two functions above `main()` (after `_delete_by_pr`):
   ```python
   def _resolve_target(*, arg: str | None) -> tuple[str | None, str | None]:
       """Resolve the upload target as a (pr_url, repo_full_name) pair.

       Resolution order:
         1. An open PR (the explicit `arg`, or the current branch's PR) ->
            (pr_url, None).
         2. No PR but a GitHub repo for the current dir -> (None, repo).
         3. Neither -> (None, None), a standalone upload.
       """
       try:
           pr_url = resolve_pr_url(arg)
       except (subprocess.SubprocessError, OSError):
           pr_url = None
       if pr_url:
           return pr_url, None
       return None, resolve_repo_full_name()


   async def _share(
       args: list[str], server_url: str, session_id: str | None
   ) -> None:
       from vibeshub_client.gh_token import get_gh_token
       from vibeshub_client.pipeline import RunOptions, run_share_pipeline
       from reader import ClaudeCodeTranscriptReader

       if not session_id:
           sys.stderr.write(
               "[vibeshub] no session_id available; this command must be run "
               "inside a Claude Code session\n"
           )
           return

       pr_url, repo_full_name = _resolve_target(arg=args[0] if args else None)

       options = RunOptions(
           server_url=server_url,
           token=get_gh_token(),
           pr_url=pr_url,
           repo_full_name=repo_full_name,
           session_id=session_id,
       )
       reader = ClaudeCodeTranscriptReader()
       hook_input = {"session_id": session_id, "cwd": os.getcwd()}

       result = await run_share_pipeline(
           reader=reader, hook_input=hook_input, options=options
       )
       if not result.uploaded:
           print(f"skipped: {result.skip_reason}", file=sys.stderr)
           return

       print(f"trace uploaded: {result.trace_url}")
       if pr_url is None and repo_full_name is None:
           print(
               "This is a standalone (public) trace. You can make it private "
               "from the trace page in the vibeshub UI."
           )
       if result.skip_reason:
           print(f"note: {result.skip_reason}", file=sys.stderr)
   ```
   Finally, in `main()`, delete the now-duplicate inner `from vibeshub_client.pr_resolve import resolve_pr_url` line and the local `plugin_root` block that precedes it (the module-level block above already does this work). The `delete` branch keeps calling `resolve_pr_url(args[1])`, which now resolves from the module-level import.

7. - [ ] **Step 7: Run the resolution tests and see them pass.**
   ```
   cd /Users/bhavya/git/vibeshub/plugins/claude-code && python3 -m pytest tests/test_share_trace.py -q
   ```
   Expected: `11 passed` (7 from Task 4 + 4 new).

8. - [ ] **Step 8: Sanity-check the command compiles and the CLI usage prints.**
   ```
   cd /Users/bhavya/git/vibeshub/plugins/claude-code && python3 -c "import py_compile; py_compile.compile('commands/share-trace.py', doraise=True); print('ok')" && python3 commands/share-trace.py delete; echo "exit=$?"
   ```
   Expected: `ok`, then `usage: share-trace delete <pr-url | /t/<id> url | short-id>` on stderr and `exit=1`.

9. - [ ] **Step 9: Commit.**
   ```
   cd /Users/bhavya/git/vibeshub && git add plugins/claude-code/commands/share-trace.py plugins/claude-code/tests/test_share_trace.py && git commit -m "$(cat <<'EOF'
   Add /share-trace PR -> repo -> standalone resolution

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 6: `share-trace.md` command manifest

**Files:**
- `plugins/claude-code/commands/share-trace.md`

1. - [ ] **Step 1: Create the `/share-trace` command manifest.**
   Create `plugins/claude-code/commands/share-trace.md`:
   ```markdown
   ---
   name: share-trace
   description: Manually upload the current Claude Code session to vibeshub, or delete an existing trace.
   argument-hint: "[<pr-number-or-url>] | delete <pr-url | /t/<id> url | short-id>"
   ---

   Use this command to upload the current session's trace to vibeshub. Without
   arguments it picks the best target automatically:

   1. The most recent open PR you authored on the current branch — the trace is
      attached to that PR and a PR comment is posted.
   2. Otherwise, if you are inside a git repo with a GitHub remote, the trace is
      attached to that repo.
   3. Otherwise, the trace is uploaded standalone and is public; you can switch
      it to private from the trace page in the vibeshub UI.

   Pass a PR number or URL to force a specific PR. Use `delete` with a PR URL, a
   `/t/<id>` trace URL, or a bare short id to remove a trace.

   Run the helper script:

   !python3 "${CLAUDE_PLUGIN_ROOT}/commands/share-trace.py" $ARGUMENTS
   ```

2. - [ ] **Step 2: Verify the manifest references the new script and matches the slash-command format.**
   ```
   cd /Users/bhavya/git/vibeshub/plugins/claude-code && grep -c "share-trace.py" commands/share-trace.md && head -1 commands/share-trace.md
   ```
   Expected: `1` then `---` (the front-matter delimiter).

3. - [ ] **Step 3: Commit.**
   ```
   cd /Users/bhavya/git/vibeshub && git add plugins/claude-code/commands/share-trace.md && git commit -m "$(cat <<'EOF'
   Add /share-trace command manifest

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 7: Delete the old `/share-pr` command and test

**Files:**
- `plugins/claude-code/commands/share-pr.md` (deleted)
- `plugins/claude-code/commands/share-pr.py` (deleted)
- `plugins/claude-code/tests/test_share_pr.py` (deleted)

1. - [ ] **Step 1: Confirm nothing else references `share-pr` (besides the README, updated in Task 9).**
   ```
   cd /Users/bhavya/git/vibeshub/plugins/claude-code && grep -rn "share-pr\|share_pr" --include="*.py" --include="*.json" --include="*.md" . | grep -v _vendor | grep -v __pycache__
   ```
   Expected: only matches in `commands/share-pr.md`, `commands/share-pr.py`, `tests/test_share_pr.py`, and `README.md`. If anything else appears, stop and reassess.

2. - [ ] **Step 2: Delete the three files via git.**
   ```
   cd /Users/bhavya/git/vibeshub && git rm plugins/claude-code/commands/share-pr.md plugins/claude-code/commands/share-pr.py plugins/claude-code/tests/test_share_pr.py
   ```
   Expected: `rm 'plugins/claude-code/commands/share-pr.md'` and two more lines.

3. - [ ] **Step 3: Confirm the test suite still collects cleanly.**
   ```
   cd /Users/bhavya/git/vibeshub/plugins/claude-code && python3 -m pytest --co -q tests/ 2>&1 | tail -5
   ```
   Expected: no collection errors; `test_share_pr.py` no longer appears, `test_share_trace.py` does.

4. - [ ] **Step 4: Commit.**
   ```
   cd /Users/bhavya/git/vibeshub && git commit -m "$(cat <<'EOF'
   Remove /share-pr, replaced by /share-trace

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 8: e2e fake server — optional PR header, accept repo header

The auto `gh pr create` hook is unchanged, but its e2e test (`test_hook_e2e.py`) has a fake `/api/ingest` that declares `x_vibeshub_pr_url` as a required header (`Header(...)`). Phase 2's backend made that header optional, so the fake server must match the new contract for the e2e tests to keep faithfully exercising the hook.

**Files:**
- `plugins/claude-code/tests/test_hook_e2e.py`

1. - [ ] **Step 1: Make the fake `/api/ingest` header optional and capture the repo header.**
   In `plugins/claude-code/tests/test_hook_e2e.py`, replace the `ingest` route's signature and the `key`/`received.append` block. The function signature becomes:
   ```python
       @app.post("/api/ingest", status_code=201)
       async def ingest(
           request: Request,
           x_vibeshub_pr_url: str | None = Header(None),
           x_vibeshub_repo: str | None = Header(None),
           x_vibeshub_platform: str = Header(...),
           x_vibeshub_plugin_version: str = Header(...),
           x_vibeshub_session_id: str | None = Header(None),
       ):
   ```
   and the `received.append({...})` dict gains a `"repo"` entry:
   ```python
           received.append(
               {
                   "tar_bytes": body,
                   "pr_url": x_vibeshub_pr_url,
                   "repo": x_vibeshub_repo,
                   "platform": x_vibeshub_platform,
                   "plugin_version": x_vibeshub_plugin_version,
                   "content_type": request.headers.get("content-type", ""),
                   "created": created,
               }
           )
       ```
   Leave the `key = (x_vibeshub_pr_url, x_vibeshub_session_id)` upsert logic and the `trace_url` (still `/alice/repo/pull/3/{short_id}`) as-is — the hook always sends a PR URL, so those paths are unaffected.

2. - [ ] **Step 2: Run the e2e suite and confirm the hook still works unchanged.**
   ```
   cd /Users/bhavya/git/vibeshub/plugins/claude-code && python3 -m pytest tests/test_hook_e2e.py -q
   ```
   Expected: all tests pass — the hook still uploads with `pr_url` set, posts comments, and the upsert/no-repeat-comment behavior is intact.

3. - [ ] **Step 3: Commit.**
   ```
   cd /Users/bhavya/git/vibeshub && git add plugins/claude-code/tests/test_hook_e2e.py && git commit -m "$(cat <<'EOF'
   Make e2e fake /api/ingest match optional PR + repo header contract

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 9: Update the README

**Files:**
- `plugins/claude-code/README.md`

1. - [ ] **Step 1: Read the README's `/share-pr` section.**
   ```
   cd /Users/bhavya/git/vibeshub/plugins/claude-code && sed -n '40,65p' README.md
   ```
   Expected: the lines mentioning `/share-pr` (around lines 48-63).

2. - [ ] **Step 2: Replace the `/share-pr` usage block.**
   In `plugins/claude-code/README.md`, replace the bullet list and surrounding text that documents `/share-pr` with the `/share-trace` equivalent. The three usage bullets become:
   ```markdown
   - `/share-trace` — upload the current session: an open PR if there is one,
     else the current GitHub repo, else a standalone public trace
   - `/share-trace <pr-url-or-number>` — share a specific PR
   - `/share-trace delete <pr-url | /t/<id> url | short-id>` — delete a trace
   ```
   Replace every remaining inline `/share-pr` mention (e.g. "deletion of any trace is available via `/share-pr delete <pr-url>`" and "delete a trace after the fact via `/share-pr delete <pr-url>`") with `/share-trace delete <pr-url | /t/<id> url | short-id>`. Update any prose that says a trace is always tied to a PR to note the standalone case.

3. - [ ] **Step 3: Confirm no `/share-pr` references remain.**
   ```
   cd /Users/bhavya/git/vibeshub/plugins/claude-code && grep -n "share-pr\|share_pr" README.md; echo "exit=$?"
   ```
   Expected: no output and `exit=1` (grep found nothing).

4. - [ ] **Step 4: Commit.**
   ```
   cd /Users/bhavya/git/vibeshub && git add plugins/claude-code/README.md && git commit -m "$(cat <<'EOF'
   Document /share-trace in the plugin README

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 10: Full-suite verification

**Files:** none (verification only).

1. - [ ] **Step 1: Run the entire plugin test suite.**
   ```
   cd /Users/bhavya/git/vibeshub/plugins/claude-code && python3 -m pytest tests/ -q
   ```
   Expected: all tests pass, zero collection errors. Key files exercised: `test_upload.py`, `test_pipeline.py`, `test_repo_resolve.py`, `test_share_trace.py`, `test_hook_e2e.py`.

2. - [ ] **Step 2: Confirm the working tree is clean and the deletions landed.**
   ```
   cd /Users/bhavya/git/vibeshub && git status --short && git log --oneline -10
   ```
   Expected: clean working tree; the last ~9 commits are this phase's; `git ls-files plugins/claude-code/commands` shows `share-trace.md` and `share-trace.py` and no `share-pr.*`.

3. - [ ] **Step 3: Confirm the auto hook is byte-for-byte unchanged.**
   ```
   cd /Users/bhavya/git/vibeshub && git log --oneline -- plugins/claude-code/hooks/on-pr-share.py plugins/claude-code/hooks/hooks.json | head -1
   ```
   Expected: the most recent commit touching the hook files predates this phase — this phase introduced no changes to `hooks/`.
