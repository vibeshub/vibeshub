# Capture PR updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-run the vibeshub share pipeline whenever a PR changes (`git push`, `gh pr edit`), not only when it is created, so each PR keeps an up-to-date trace per contributing session.

**Architecture:** The Claude Code `PostToolUse`/`Bash` hook classifies the command into a share trigger (`create` / `push` / `edit`), resolves the PR URL (from `gh` stdout for create, from `gh pr view` for push/edit), and runs the existing pipeline. The backend `/api/ingest` upserts by `(repo, pr_number, session_id)` so re-uploads from one session refresh a single trace with a stable URL. The PR comment is posted only when a brand-new trace is created.

**Tech Stack:** Python 3 (plugin, stdlib only), FastAPI + SQLAlchemy async (backend), pytest / pytest-asyncio / respx.

**Spec:** `docs/superpowers/specs/2026-05-21-pr-update-uploads-design.md`

---

## File Structure

**Plugin (`plugins/claude-code/`)**
- Create `vibeshub_client/share_trigger.py` — pure command classifier.
- Create `vibeshub_client/pr_resolve.py` — resolve a PR URL via `gh`.
- Rename `hooks/on-pr-create.py` → `hooks/on-pr-share.py` — the hook entry point.
- Modify `hooks/hooks.json`, `commands/share-pr.py`, `vibeshub_client/upload.py`, `vibeshub_client/pipeline.py`.
- Create `tests/test_share_trigger.py`, `tests/test_pr_resolve.py`; modify `tests/test_hook_e2e.py`, `tests/test_pipeline.py`.

**Backend (`webapp/backend/`)**
- Modify `app/api/ingest.py`, `app/api/schemas.py`; modify `tests/test_ingest.py`.

---

## Task 1: Command classifier (`share_trigger.py`)

**Files:**
- Create: `plugins/claude-code/vibeshub_client/share_trigger.py`
- Test: `plugins/claude-code/tests/test_share_trigger.py`

- [ ] **Step 1: Write the failing test**

Create `plugins/claude-code/tests/test_share_trigger.py`:

```python
import pytest

from vibeshub_client.share_trigger import classify_share_trigger


@pytest.mark.parametrize("command,expected", [
    ("gh pr create --fill", "create"),
    ("gh pr create", "create"),
    ("git push", "push"),
    ("git push origin HEAD", "push"),
    ("git add . && git push", "push"),
    ("gh pr edit --title x", "edit"),
    ("gh pr edit 5 --body y", "edit"),
    ("gh pr edit --add-label x && git push", "edit"),
    ("ls -la", None),
    ("git commit -m x", None),
    ("git status", None),
    ("", None),
])
def test_classify_share_trigger(command, expected):
    assert classify_share_trigger(command) == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugins/claude-code && python3 -m pytest tests/test_share_trigger.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'vibeshub_client.share_trigger'`

- [ ] **Step 3: Write minimal implementation**

Create `plugins/claude-code/vibeshub_client/share_trigger.py`:

```python
from __future__ import annotations


def classify_share_trigger(command: str) -> str | None:
    """Classify a Bash command into the kind of vibeshub share it triggers.

    Returns:
      "create" — `gh pr create`  (PR URL comes from gh stdout)
      "push"   — `git push`      (PR URL resolved from the current branch)
      "edit"   — `gh pr edit`    (PR URL resolved from the current branch)
      None     — anything else

    Substring matching, so compound commands (`git add . && git push`) are
    handled. `gh pr create` and `gh pr edit` are checked before `git push`,
    so a command doing both edits and pushes classifies as the gh action
    (both resolve to the same current-branch PR anyway).
    """
    if "gh pr create" in command:
        return "create"
    if "gh pr edit" in command:
        return "edit"
    if "git push" in command:
        return "push"
    return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plugins/claude-code && python3 -m pytest tests/test_share_trigger.py -v`
Expected: PASS (12 cases)

- [ ] **Step 5: Commit**

```bash
git add plugins/claude-code/vibeshub_client/share_trigger.py plugins/claude-code/tests/test_share_trigger.py
git commit -m "$(cat <<'EOF'
Add a share-trigger classifier for the PR hook

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: PR URL resolver (`pr_resolve.py`)

This lifts the `_gh` / `_resolve_pr_url` helpers out of `commands/share-pr.py` into a shared module the hook can also use, and adds an optional `cwd` so the hook can run `gh` in the PR's directory.

**Files:**
- Create: `plugins/claude-code/vibeshub_client/pr_resolve.py`
- Modify: `plugins/claude-code/commands/share-pr.py`
- Test: `plugins/claude-code/tests/test_pr_resolve.py`

- [ ] **Step 1: Write the failing test**

Create `plugins/claude-code/tests/test_pr_resolve.py`:

```python
import subprocess
from unittest.mock import patch

from vibeshub_client.pr_resolve import resolve_pr_url


def test_resolve_pr_url_passes_through_a_url():
    url = "https://github.com/alice/repo/pull/9"
    with patch("vibeshub_client.pr_resolve.subprocess.run") as run:
        assert resolve_pr_url(url) == url
        run.assert_not_called()


def test_resolve_pr_url_current_branch():
    fake = subprocess.CompletedProcess(
        args=[], returncode=0,
        stdout="https://github.com/a/r/pull/3\n", stderr="",
    )
    with patch("vibeshub_client.pr_resolve.subprocess.run", return_value=fake) as run:
        assert resolve_pr_url(None) == "https://github.com/a/r/pull/3"
        assert run.call_args.args[0] == [
            "gh", "pr", "view", "--json", "url", "-q", ".url",
        ]


def test_resolve_pr_url_by_number():
    fake = subprocess.CompletedProcess(
        args=[], returncode=0,
        stdout="https://github.com/a/r/pull/7\n", stderr="",
    )
    with patch("vibeshub_client.pr_resolve.subprocess.run", return_value=fake) as run:
        assert resolve_pr_url("7") == "https://github.com/a/r/pull/7"
        assert run.call_args.args[0] == [
            "gh", "pr", "view", "7", "--json", "url", "-q", ".url",
        ]


def test_resolve_pr_url_passes_cwd():
    fake = subprocess.CompletedProcess(
        args=[], returncode=0,
        stdout="https://github.com/a/r/pull/3\n", stderr="",
    )
    with patch("vibeshub_client.pr_resolve.subprocess.run", return_value=fake) as run:
        resolve_pr_url(None, cwd="/some/repo")
        assert run.call_args.kwargs["cwd"] == "/some/repo"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugins/claude-code && python3 -m pytest tests/test_pr_resolve.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'vibeshub_client.pr_resolve'`

- [ ] **Step 3: Write the resolver module**

Create `plugins/claude-code/vibeshub_client/pr_resolve.py`:

```python
from __future__ import annotations

import subprocess


def _gh(*args: str, cwd: str | None = None) -> str:
    return subprocess.run(
        ["gh", *args], check=True, capture_output=True, text=True, cwd=cwd,
    ).stdout.strip()


def resolve_pr_url(arg: str | None, *, cwd: str | None = None) -> str:
    """Resolve a PR URL.

    arg=None        -> the open PR for the current branch
    arg is a digit  -> that PR number in the current repo
    arg otherwise   -> returned unchanged (already a URL)

    `cwd` is the directory `gh` runs in (defaults to the process cwd).

    Raises subprocess.CalledProcessError if `gh` cannot resolve a PR (e.g.
    the branch has no open PR), or OSError if `gh` is not installed.
    """
    if arg is None:
        return _gh("pr", "view", "--json", "url", "-q", ".url", cwd=cwd)
    if arg.isdigit():
        return _gh("pr", "view", arg, "--json", "url", "-q", ".url", cwd=cwd)
    return arg
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plugins/claude-code && python3 -m pytest tests/test_pr_resolve.py -v`
Expected: PASS (4 cases)

- [ ] **Step 5: Point `share-pr.py` at the shared resolver**

In `plugins/claude-code/commands/share-pr.py`:

Remove the now-unused `import subprocess` from the top-of-file imports (it is only used by `_gh`, which is being deleted).

Delete the `_gh` function entirely:

```python
def _gh(*args: str) -> str:
    return subprocess.run(
        ["gh", *args], check=True, capture_output=True, text=True
    ).stdout.strip()
```

Delete the `_resolve_pr_url` function entirely:

```python
def _resolve_pr_url(arg: str | None) -> str:
    if arg is None:
        return _gh("pr", "view", "--json", "url", "-q", ".url")
    if arg.isdigit():
        return _gh("pr", "view", arg, "--json", "url", "-q", ".url")
    return arg
```

Replace the `main()` function with this version (it sets up `sys.path` so the
shared module is importable, then calls `resolve_pr_url`):

```python
def main() -> None:
    args = sys.argv[1:]
    server_url = os.environ.get("VIBESHUB_SERVER_URL", "https://vibeshub.ai")
    session_id = _session_id()

    plugin_root = Path(os.environ.get("CLAUDE_PLUGIN_ROOT", Path(__file__).resolve().parent.parent))
    if str(plugin_root) not in sys.path:
        sys.path.insert(0, str(plugin_root))
    from vibeshub_client.pr_resolve import resolve_pr_url

    if args and args[0] == "delete":
        if len(args) < 2:
            print("usage: share-pr delete <pr-url>", file=sys.stderr)
            sys.exit(1)
        asyncio.run(_delete(resolve_pr_url(args[1]), server_url))
        return

    pr_arg = args[0] if args else None
    pr_url = resolve_pr_url(pr_arg)
    asyncio.run(_share(pr_url, server_url, session_id))
```

- [ ] **Step 6: Verify `share-pr.py` still parses and the suite is green**

Run: `cd plugins/claude-code && python3 -m py_compile commands/share-pr.py && python3 -m pytest -q`
Expected: `share-pr.py` compiles with no output; full plugin suite PASSES.

- [ ] **Step 7: Commit**

```bash
git add plugins/claude-code/vibeshub_client/pr_resolve.py plugins/claude-code/tests/test_pr_resolve.py plugins/claude-code/commands/share-pr.py
git commit -m "$(cat <<'EOF'
Extract PR-URL resolution into a shared module

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Rename the hook to `on-pr-share.py`

Mechanical rename — the hook no longer fires only on PR creation. No behavior
change; the existing tests must stay green.

**Files:**
- Rename: `plugins/claude-code/hooks/on-pr-create.py` → `plugins/claude-code/hooks/on-pr-share.py`
- Modify: `plugins/claude-code/hooks/hooks.json`
- Modify: `plugins/claude-code/tests/test_hook_e2e.py`

- [ ] **Step 1: Rename the hook file**

```bash
git mv plugins/claude-code/hooks/on-pr-create.py plugins/claude-code/hooks/on-pr-share.py
```

- [ ] **Step 2: Update `hooks.json`**

In `plugins/claude-code/hooks/hooks.json`, change the command path:

```json
            "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/hooks/on-pr-share.py\"",
```

(Only the filename changes; `matcher`, `type`, and `async: false` stay.)

- [ ] **Step 3: Update the hook path in `test_hook_e2e.py`**

In `plugins/claude-code/tests/test_hook_e2e.py`, there are three identical lines:

```python
    hook_script = plugin_root / "hooks" / "on-pr-create.py"
```

Change all three to:

```python
    hook_script = plugin_root / "hooks" / "on-pr-share.py"
```

- [ ] **Step 4: Run the hook tests to verify they still pass**

Run: `cd plugins/claude-code && python3 -m pytest tests/test_hook_e2e.py -v`
Expected: PASS (3 existing tests) — the rename is behavior-preserving.

- [ ] **Step 5: Commit**

```bash
git add plugins/claude-code/hooks/on-pr-share.py plugins/claude-code/hooks/hooks.json plugins/claude-code/tests/test_hook_e2e.py
git commit -m "$(cat <<'EOF'
Rename the PR hook to on-pr-share.py

It no longer fires only on PR creation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Trigger the hook on `git push` and `gh pr edit`

**Files:**
- Modify: `plugins/claude-code/hooks/on-pr-share.py`
- Modify: `plugins/claude-code/tests/test_hook_e2e.py`

- [ ] **Step 1: Replace the `fake_gh_dir` fixture with a configurable fake `gh`**

In `plugins/claude-code/tests/test_hook_e2e.py`, replace the existing
`fake_gh_dir` fixture (the `@pytest.fixture def fake_gh_dir(...)` block) with
this helper plus two fixtures:

```python
def _write_fake_gh(directory: Path, *, pr_view_url: str | None) -> Path:
    """Write a fake `gh` script into `directory` and return `directory`.

    `gh auth token` and `gh pr comment` always succeed. `gh pr view` echoes
    `pr_view_url` and exits 0, or exits 1 when `pr_view_url` is None (the
    branch has no open PR). Anything else exits 1.
    """
    if pr_view_url is None:
        pr_view = "exit 1"
    else:
        pr_view = f"echo '{pr_view_url}'; exit 0"
    gh = directory / "gh"
    gh.write_text(
        "#!/usr/bin/env bash\n"
        "case \"$1 $2\" in\n"
        "  'auth token') echo 'ghp_test_fake'; exit 0 ;;\n"
        "  'pr comment') exit 0 ;;\n"
        f"  'pr view') {pr_view} ;;\n"
        "  *) exit 1 ;;\n"
        "esac\n"
    )
    gh.chmod(0o755)
    return directory


@pytest.fixture
def fake_gh_dir(tmp_path: Path) -> Path:
    """A dir with a fake `gh` whose `pr view` resolves to alice/repo PR 3."""
    d = tmp_path / "ghbin"
    d.mkdir()
    return _write_fake_gh(d, pr_view_url="https://github.com/alice/repo/pull/3")


@pytest.fixture
def fake_gh_dir_no_pr(tmp_path: Path) -> Path:
    """A dir with a fake `gh` whose `pr view` fails (branch has no PR)."""
    d = tmp_path / "ghbin"
    d.mkdir()
    return _write_fake_gh(d, pr_view_url=None)
```

- [ ] **Step 2: Add a transcript-setup helper and the new failing tests**

In `plugins/claude-code/tests/test_hook_e2e.py`, add this helper and three
tests at the end of the file:

```python
def _setup_transcript(tmp_path: Path) -> tuple[Path, Path, str]:
    """Create Claude Code's on-disk transcript layout under `tmp_path`.
    Returns (fake_home, cwd, session_id)."""
    fake_home = tmp_path / "home"
    cwd = tmp_path / "repo"
    cwd.mkdir()
    encoded = str(cwd).replace("/", "-")
    transcript_dir = fake_home / ".claude" / "projects" / encoded
    transcript_dir.mkdir(parents=True)
    session_id = "session-xyz"
    (transcript_dir / f"{session_id}.jsonl").write_text(
        '{"type":"user","message":{"role":"user","content":"hi"}}\n'
    )
    return fake_home, cwd, session_id


def _run_hook(hook_script: Path, payload: dict, env: dict) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(hook_script)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
    )


def test_hook_uploads_when_git_push_to_pr_branch(
    tmp_path: Path, fake_gh_dir: Path, fake_server, monkeypatch,
):
    fake_home, cwd, session_id = _setup_transcript(tmp_path)
    plugin_root = Path(__file__).resolve().parents[1]
    hook_script = plugin_root / "hooks" / "on-pr-share.py"

    payload = {
        "session_id": session_id,
        "cwd": str(cwd),
        "tool_input": {"command": "git push origin HEAD"},
        "tool_response": {"stdout": "", "stderr": ""},
    }
    env = os.environ.copy()
    env["HOME"] = str(fake_home)
    env["CLAUDE_PLUGIN_ROOT"] = str(plugin_root)
    env["VIBESHUB_SERVER_URL"] = "http://127.0.0.1:9999"
    env["VIBESHUB_HOOK_LOG"] = str(tmp_path / "hook.log")
    env["PATH"] = str(fake_gh_dir) + os.pathsep + env.get("PATH", "")

    proc = _run_hook(hook_script, payload, env)

    assert proc.returncode == 0, proc.stderr
    assert len(fake_server) == 1
    assert fake_server[0]["pr_url"] == "https://github.com/alice/repo/pull/3"
    assert "[vibeshub] trace uploaded" in proc.stderr


def test_hook_uploads_when_gh_pr_edit(
    tmp_path: Path, fake_gh_dir: Path, fake_server, monkeypatch,
):
    fake_home, cwd, session_id = _setup_transcript(tmp_path)
    plugin_root = Path(__file__).resolve().parents[1]
    hook_script = plugin_root / "hooks" / "on-pr-share.py"

    payload = {
        "session_id": session_id,
        "cwd": str(cwd),
        "tool_input": {"command": "gh pr edit --title 'new title'"},
        "tool_response": {"stdout": "", "stderr": ""},
    }
    env = os.environ.copy()
    env["HOME"] = str(fake_home)
    env["CLAUDE_PLUGIN_ROOT"] = str(plugin_root)
    env["VIBESHUB_SERVER_URL"] = "http://127.0.0.1:9999"
    env["VIBESHUB_HOOK_LOG"] = str(tmp_path / "hook.log")
    env["PATH"] = str(fake_gh_dir) + os.pathsep + env.get("PATH", "")

    proc = _run_hook(hook_script, payload, env)

    assert proc.returncode == 0, proc.stderr
    assert len(fake_server) == 1
    assert fake_server[0]["pr_url"] == "https://github.com/alice/repo/pull/3"


def test_hook_silent_when_git_push_has_no_pr(
    tmp_path: Path, fake_gh_dir_no_pr: Path, monkeypatch,
):
    fake_home, cwd, session_id = _setup_transcript(tmp_path)
    plugin_root = Path(__file__).resolve().parents[1]
    hook_script = plugin_root / "hooks" / "on-pr-share.py"

    payload = {
        "session_id": session_id,
        "cwd": str(cwd),
        "tool_input": {"command": "git push"},
        "tool_response": {"stdout": "", "stderr": ""},
    }
    env = os.environ.copy()
    env["HOME"] = str(fake_home)
    env["CLAUDE_PLUGIN_ROOT"] = str(plugin_root)
    env["VIBESHUB_HOOK_LOG"] = str(tmp_path / "hook.log")
    env["PATH"] = str(fake_gh_dir_no_pr) + os.pathsep + env.get("PATH", "")

    proc = _run_hook(hook_script, payload, env)

    assert proc.returncode == 0
    assert proc.stderr == ""
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `cd plugins/claude-code && python3 -m pytest tests/test_hook_e2e.py -v -k "git_push or gh_pr_edit"`
Expected: `test_hook_uploads_when_git_push_to_pr_branch` and
`test_hook_uploads_when_gh_pr_edit` FAIL (the current hook ignores anything
that is not `gh pr create`, so `fake_server` stays empty).

- [ ] **Step 4: Rewrite the hook to handle all three triggers**

Replace the entire contents of `plugins/claude-code/hooks/on-pr-share.py` with:

```python
#!/usr/bin/env python3
"""
PostToolUse hook for Claude Code.

Reads the hook payload from stdin (JSON). When the tool call was a command
that creates or updates a PR — `gh pr create`, `git push`, or `gh pr edit` —
it runs the vibeshub share pipeline: redact, upload, and (for a brand-new
trace) comment on the PR.

Exits 0 on success or any non-fatal failure (we never want to block Claude).
Errors are written to stderr.
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def _log_path() -> Path:
    override = os.environ.get("VIBESHUB_HOOK_LOG")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".vibeshub" / "hook.log"


_SESSION_ID: str | None = None


def _log(message: str) -> None:
    """Append a timestamped line to the hook log. Never raises."""
    try:
        path = _log_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().isoformat(timespec="seconds")
        sid = f" session={_SESSION_ID}" if _SESSION_ID else ""
        with path.open("a", encoding="utf-8") as f:
            f.write(f"{ts}{sid} {message}\n")
    except Exception:
        # Logging must never break the hook.
        pass


def _bail(message: str) -> None:
    _log(f"bail: {message}")
    print(f"[vibeshub] {message}", file=sys.stderr)
    sys.exit(0)


def main() -> None:
    global _SESSION_ID

    plugin_root = Path(os.environ.get("CLAUDE_PLUGIN_ROOT", Path(__file__).resolve().parent.parent))
    sys.path.insert(0, str(plugin_root))

    _log("hook invoked")

    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as e:
        _bail(f"could not parse hook payload: {e}")
        return

    _SESSION_ID = payload.get("session_id")

    tool_input = payload.get("tool_input", {})
    tool_response = payload.get("tool_response", {})
    command = tool_input.get("command", "")

    try:
        from vibeshub_client.gh_token import GhTokenError, get_gh_token
        from vibeshub_client.parse_pr_url import extract_pr_url_from_gh_stdout
        from vibeshub_client.pipeline import RunOptions, run_share_pipeline
        from vibeshub_client.pr_resolve import resolve_pr_url
        from vibeshub_client.share_trigger import classify_share_trigger
    except ImportError as e:
        _bail(f"failed to import vibeshub_client (is the plugin's Python missing deps?): {e}")
        return

    trigger = classify_share_trigger(command)
    if trigger is None:
        _log("skipped: command is not a share trigger")
        return  # not for us

    pr_url: str | None = None
    if trigger == "create":
        stdout = ""
        if isinstance(tool_response, dict):
            stdout = tool_response.get("stdout", "") or tool_response.get("output", "")
        elif isinstance(tool_response, str):
            stdout = tool_response
        pr_url = extract_pr_url_from_gh_stdout(stdout)
        if not pr_url:
            _log("skipped: no PR URL in gh stdout (command likely failed)")
            return  # likely the command failed; nothing to share
    else:
        # "push" / "edit": no PR URL in the command output. Resolve the open
        # PR for the current branch. A failure here is the normal case for a
        # push outside a PR — bail silently (log only, nothing on stderr).
        try:
            pr_url = resolve_pr_url(None, cwd=payload.get("cwd"))
        except (subprocess.SubprocessError, OSError) as e:
            _log(f"skipped: no open PR for current branch ({e})")
            return
        if not pr_url:
            _log("skipped: no open PR for current branch")
            return

    _log(f"detected PR ({trigger}): {pr_url}")

    try:
        token = get_gh_token()
    except GhTokenError as e:
        _bail(str(e))
        return

    server_url = os.environ.get("VIBESHUB_SERVER_URL", "https://vibeshub.ai")

    from reader import ClaudeCodeTranscriptReader

    options = RunOptions(
        server_url=server_url,
        token=token,
        pr_url=pr_url,
        session_id=payload.get("session_id"),
    )
    reader = ClaudeCodeTranscriptReader()

    try:
        result = asyncio.run(
            run_share_pipeline(
                reader=reader,
                hook_input=payload,
                options=options,
            )
        )
    except Exception as e:
        _bail(f"share failed: {e}")
        return

    diag = ""
    if result.payload_bytes is not None and result.upload_elapsed_seconds is not None:
        diag = f" (bytes={result.payload_bytes} elapsed={result.upload_elapsed_seconds:.2f}s)"

    if result.uploaded:
        msg = f"trace uploaded: {result.trace_url}"
        if result.skip_reason:
            msg += f" (note: {result.skip_reason})"
        _log(msg + diag)
        print(f"[vibeshub] {msg}", file=sys.stderr)
    else:
        _log(f"skipped: {result.skip_reason}{diag}")
        print(f"[vibeshub] skipped: {result.skip_reason}", file=sys.stderr)


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run the full hook test file to verify everything passes**

Run: `cd plugins/claude-code && python3 -m pytest tests/test_hook_e2e.py -v`
Expected: PASS — 3 original tests + 3 new tests (6 total).

- [ ] **Step 6: Commit**

```bash
git add plugins/claude-code/hooks/on-pr-share.py plugins/claude-code/tests/test_hook_e2e.py
git commit -m "$(cat <<'EOF'
Trigger the share hook on git push and gh pr edit

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Backend — upsert ingest by session, return a `created` flag

A re-upload carrying the same `X-Vibeshub-Session-Id` for the same PR refreshes
that session's existing trace in place (stable `short_id`) instead of inserting
a new row. The response reports whether a new trace was created.

**Files:**
- Modify: `webapp/backend/app/api/schemas.py`
- Modify: `webapp/backend/app/api/ingest.py`
- Test: `webapp/backend/tests/test_ingest.py`

- [ ] **Step 1: Write the failing tests**

In `webapp/backend/tests/test_ingest.py`, add these two tests at the end of
the file (the imports `select`, `Trace`, and the `make_bundle` / `_mock_alice_pr1`
helpers already exist in that file):

```python
@pytest.mark.asyncio
async def test_ingest_upserts_trace_for_same_session(client, respx_mock):
    _mock_alice_pr1(respx_mock)
    headers = {**COMMON_HEADERS, "X-Vibeshub-Session-Id": "sess-A"}
    SessionLocal = client.app.state.session_maker

    r1 = client.post(
        "/api/ingest",
        content=make_bundle({"main.jsonl": b'{"type":"user"}\n'}),
        headers=headers,
    )
    assert r1.status_code == 201, r1.text
    assert r1.json()["created"] is True
    sid1 = r1.json()["short_id"]

    async with SessionLocal() as session:
        row1 = (
            await session.execute(
                select(Trace).where(Trace.session_id == "sess-A")
            )
        ).scalar_one()
        byte_size_1 = row1.byte_size

    r2 = client.post(
        "/api/ingest",
        content=make_bundle(
            {"main.jsonl": b'{"type":"user"}\n{"type":"assistant"}\n'}
        ),
        headers=headers,
    )
    assert r2.status_code == 201, r2.text
    assert r2.json()["created"] is False
    assert r2.json()["short_id"] == sid1

    async with SessionLocal() as session:
        rows = (
            await session.execute(
                select(Trace).where(Trace.session_id == "sess-A")
            )
        ).scalars().all()

    assert len(rows) == 1                    # upserted, not duplicated
    assert rows[0].byte_size != byte_size_1  # content refreshed in place


@pytest.mark.asyncio
async def test_ingest_without_session_always_creates(client, respx_mock):
    _mock_alice_pr1(respx_mock)
    # COMMON_HEADERS carries no X-Vibeshub-Session-Id.
    body = make_bundle({"main.jsonl": b"{}\n"})
    r1 = client.post("/api/ingest", content=body, headers=COMMON_HEADERS)
    r2 = client.post("/api/ingest", content=body, headers=COMMON_HEADERS)
    assert r1.status_code == 201 and r2.status_code == 201
    assert r1.json()["created"] is True
    assert r2.json()["created"] is True
    assert r1.json()["short_id"] != r2.json()["short_id"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd webapp/backend && python3 -m pytest tests/test_ingest.py -v -k "upsert or without_session"`
Expected: FAIL — `test_ingest_upserts_trace_for_same_session` fails on
`KeyError: 'created'` (no such response field) and, once that is fixed, on the
row count (two rows instead of one).

- [ ] **Step 3: Add the `created` field to `IngestResponse`**

In `webapp/backend/app/api/schemas.py`, change the `IngestResponse` model:

```python
class IngestResponse(BaseModel):
    trace_id: str
    short_id: str
    trace_url: str
    created: bool = True
```

- [ ] **Step 4: Add the `select` import to `ingest.py`**

In `webapp/backend/app/api/ingest.py`, add this import (alongside the other
top-level imports):

```python
from sqlalchemy import select
```

- [ ] **Step 5: Implement the upsert**

In `webapp/backend/app/api/ingest.py`, replace everything from `sid = generate()`
through the final `return IngestResponse(...)` (the current trailing block of
the `ingest` handler) with:

```python
    # Upsert: a re-upload carrying the same session_id for this PR refreshes
    # that session's existing trace (stable short_id / URL) instead of adding
    # a new row. A null session_id always creates a fresh trace. A trace the
    # user has deleted (deleted_at set) is not resurrected.
    existing: Trace | None = None
    if x_vibeshub_session_id:
        existing = (
            await session.execute(
                select(Trace)
                .where(
                    Trace.repo_full_name == pr.repo_full_name,
                    Trace.pr_number == pr.number,
                    Trace.session_id == x_vibeshub_session_id,
                    Trace.deleted_at.is_(None),
                )
                .order_by(Trace.created_at.desc())
            )
        ).scalars().first()

    created = existing is None
    sid = existing.short_id if existing is not None else generate()
    blob_prefix = f"traces/{sid}/"
    await blob_store.put(f"{blob_prefix}main.jsonl", unpacked.main_bytes)

    agent_summaries: list[dict] = []
    for agent in unpacked.agents:
        await blob_store.put(
            f"{blob_prefix}agents/{agent.agent_id}.jsonl",
            agent.jsonl_bytes,
        )
        await blob_store.put(
            f"{blob_prefix}agents/{agent.agent_id}.meta.json",
            json.dumps(agent.meta, ensure_ascii=False).encode("utf-8"),
        )
        agent_summaries.append({
            "agent_id": agent.agent_id,
            "tool_use_id": agent.meta.get("toolUseId"),
            "agent_type": agent.meta["agentType"],
            "description": agent.meta["description"],
            "message_count": count_messages(agent.jsonl_bytes),
        })

    message_count_main = count_messages(unpacked.main_bytes)
    byte_size = len(unpacked.main_bytes) + sum(
        len(a.jsonl_bytes) for a in unpacked.agents
    )

    if existing is not None:
        trace = existing
        trace.pr_url = pr.html_url
        trace.pr_title = pr.title
        trace.platform = platform
        trace.plugin_version = plugin_version
        trace.byte_size = byte_size
        trace.message_count = message_count_main
        trace.redaction_count_client = redaction_count_client
        trace.redaction_count_server = unpacked.total_redactions
        trace.is_private = pr.repo_is_private
        trace.blob_path = None
        trace.blob_prefix = blob_prefix
        trace.agents = agent_summaries
        trace.agent_count = len(agent_summaries)
    else:
        trace = Trace(
            short_id=sid,
            owner_login=user.login,
            repo_full_name=pr.repo_full_name,
            pr_number=pr.number,
            pr_url=pr.html_url,
            pr_title=pr.title,
            platform=platform,
            plugin_version=plugin_version,
            session_id=x_vibeshub_session_id,
            byte_size=byte_size,
            message_count=message_count_main,
            redaction_count_client=redaction_count_client,
            redaction_count_server=unpacked.total_redactions,
            is_private=pr.repo_is_private,
            blob_path=None,
            blob_prefix=blob_prefix,
            agents=agent_summaries,
            agent_count=len(agent_summaries),
        )
        session.add(trace)
    await session.commit()

    return IngestResponse(
        trace_id=str(trace.id),
        short_id=sid,
        trace_url=_trace_url(settings, parsed.owner, parsed.repo, parsed.number, sid),
        created=created,
    )
```

- [ ] **Step 6: Run the ingest test file to verify it all passes**

Run: `cd webapp/backend && python3 -m pytest tests/test_ingest.py -v`
Expected: PASS — the two new tests plus all pre-existing ingest tests.

- [ ] **Step 7: Commit**

```bash
git add webapp/backend/app/api/schemas.py webapp/backend/app/api/ingest.py webapp/backend/tests/test_ingest.py
git commit -m "$(cat <<'EOF'
Upsert ingested traces by session instead of always inserting

A re-upload from the same Claude Code session refreshes that session's
trace for the PR in place, keeping a stable short_id. The response now
reports whether a new trace was created.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Plugin — comment on the PR only for a newly created trace

The pipeline currently posts a PR comment on every upload. With upsert, a
session's trace URL is stable, so only the first upload of a session needs a
comment. Gate it on the `created` flag the backend now returns.

**Files:**
- Modify: `plugins/claude-code/vibeshub_client/upload.py`
- Modify: `plugins/claude-code/vibeshub_client/pipeline.py`
- Test: `plugins/claude-code/tests/test_pipeline.py`

- [ ] **Step 1: Write the failing test**

In `plugins/claude-code/tests/test_pipeline.py`, add this test at the end of
the file (`io`, `tarfile`, `Path`, `patch`, `pytest`, `ClaudeCodeTranscriptReader`,
`RunOptions`, `run_share_pipeline`, `UploadResult`, and `FIXTURES` are already
imported at the top):

```python
@pytest.mark.asyncio
async def test_pipeline_skips_comment_when_trace_not_created(tmp_path):
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

    async def fake_upload(
        *, server_url, token, tar_bytes, pr_url, plugin_version,
        session_id, redaction_count_client, timeout=60.0,
    ):
        return UploadResult(
            trace_id="t1", short_id="abc",
            trace_url="https://x/abc", created=False,
        )

    with patch("vibeshub_client.pipeline.upload_bundle", new=fake_upload), \
         patch("vibeshub_client.pipeline.post_pr_comment") as mock_comment:
        result = await run_share_pipeline(
            reader=reader,
            hook_input=hook_input,
            options=RunOptions(
                server_url="https://x",
                token="t",
                pr_url="https://github.com/a/r/pull/1",
                session_id="sess1",
            ),
        )

    assert result.uploaded is True
    assert result.created is False
    mock_comment.assert_not_called()
```

Also, in the existing `test_pipeline_builds_bundle_with_agents` test, change
the `post_pr_comment` patch line so the comment call is asserted. Replace:

```python
    with patch("vibeshub_client.pipeline.upload_bundle", new=fake_upload), \
         patch("vibeshub_client.pipeline.post_pr_comment"):
```

with:

```python
    with patch("vibeshub_client.pipeline.upload_bundle", new=fake_upload), \
         patch("vibeshub_client.pipeline.post_pr_comment") as mock_comment:
```

and add this assertion at the end of that test (after the existing
`assert captured["plugin_version"] == PLUGIN_VERSION` line):

```python
    # fake_upload returns a default UploadResult (created=True) -> comment posted.
    mock_comment.assert_called_once()
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `cd plugins/claude-code && python3 -m pytest tests/test_pipeline.py -v`
Expected: `test_pipeline_skips_comment_when_trace_not_created` FAILS —
`UploadResult` has no `created` argument (`TypeError`), and the pipeline posts
the comment unconditionally.

- [ ] **Step 3: Add `created` to `UploadResult`**

In `plugins/claude-code/vibeshub_client/upload.py`, change the `UploadResult`
dataclass:

```python
@dataclass
class UploadResult:
    trace_id: str
    short_id: str
    trace_url: str
    created: bool = True
```

And in `upload_bundle`, change the returned `UploadResult` to read the flag
from the response (defaulting to `True` so an older backend still comments):

```python
    data = json.loads(raw.decode("utf-8"))
    return UploadResult(
        trace_id=data["trace_id"],
        short_id=data["short_id"],
        trace_url=data["trace_url"],
        created=data.get("created", True),
    )
```

- [ ] **Step 4: Gate the comment in the pipeline on `created`**

In `plugins/claude-code/vibeshub_client/pipeline.py`, add `created` to the
`RunResult` dataclass:

```python
@dataclass
class RunResult:
    uploaded: bool
    short_id: str | None = None
    trace_url: str | None = None
    skip_reason: str | None = None
    payload_bytes: int | None = None
    upload_elapsed_seconds: float | None = None
    created: bool = True
```

Then replace the comment-posting block and the final return (everything from
`try:` / `post_pr_comment(...)` through the end of `run_share_pipeline`) with:

```python
    if result.created:
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

    return RunResult(
        uploaded=True,
        short_id=result.short_id,
        trace_url=result.trace_url,
        payload_bytes=payload_bytes,
        upload_elapsed_seconds=elapsed,
        created=result.created,
    )
```

- [ ] **Step 5: Run the pipeline tests to verify they pass**

Run: `cd plugins/claude-code && python3 -m pytest tests/test_pipeline.py -v`
Expected: PASS — all three tests, including the new comment-skip test.

- [ ] **Step 6: Commit**

```bash
git add plugins/claude-code/vibeshub_client/upload.py plugins/claude-code/vibeshub_client/pipeline.py plugins/claude-code/tests/test_pipeline.py
git commit -m "$(cat <<'EOF'
Comment on the PR only when a new trace is created

Re-uploads from the same session refresh a trace with a stable URL, so
the comment would just be noise. Gate it on the backend's created flag.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full plugin test suite**

Run: `cd plugins/claude-code && python3 -m pytest -q`
Expected: PASS — all tests, no failures.

- [ ] **Step 2: Run the full backend test suite**

Run: `cd webapp/backend && python3 -m pytest -q`
Expected: PASS — all tests, no failures.

- [ ] **Step 3: Confirm no stale `on-pr-create` references remain in live code**

Run: `git grep -n "on-pr-create" -- plugins/ webapp/`
Expected: no matches (historical `docs/superpowers/` plans/specs are allowed to
keep the old name and are not searched here).

---

## Notes for the implementer

- The plugin uses **stdlib only** — do not add dependencies to
  `vibeshub_client/`.
- `git push --dry-run` will also classify as a `push` trigger. This is
  intentionally left as-is: the resulting upsert is idempotent and harmless.
- No database migration is needed — `created` is a response-only field and the
  upsert reuses existing columns.
