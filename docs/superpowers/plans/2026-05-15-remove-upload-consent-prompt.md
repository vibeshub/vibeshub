# Remove upload consent prompt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the y/N upload prompt and all env-var gating from the share pipeline. Plugin installation is treated as consent.

**Architecture:** The share pipeline currently has a `confirm` branch that calls `/dev/tty` for a y/N prompt, with `VIBESHUB_AUTO_YES`/`VIBESHUB_AUTO_NO` env overrides and an auto-share-when-no-tty fallback. Strip the whole branch, delete `preview.py`, simplify `RunOptions`, drop env reads from both callers, and trim tests/docs to match.

**Tech Stack:** Python 3.12+, pytest, respx (HTTP mocking).

---

## File Structure

- Modify: `plugins/shared/vibeshub_client/pipeline.py` — drop `confirm` branch and `confirm` field
- Delete: `plugins/shared/vibeshub_client/preview.py`
- Modify: `plugins/claude-code/hooks/on-pr-create.py` — drop `confirm=` and `VIBESHUB_AUTO_YES`
- Modify: `plugins/claude-code/commands/share-pr.py` — drop `confirm=` and `VIBESHUB_AUTO_YES`
- Modify: `plugins/shared/tests/test_pipeline.py` — keep happy path only, assert `skip_reason is None`
- Delete: `plugins/shared/tests/test_preview.py`
- Modify: `plugins/claude-code/tests/test_hook_e2e.py` — drop `VIBESHUB_AUTO_YES` env
- Modify: `plugins/claude-code/README.md` — drop env row, rewrite step 3

Tests drive the change: rewriting `test_pipeline.py` first lets the test prove "no auto-share-note when no TTY" failure, which is exactly the behavior we then make true by simplifying pipeline.py.

---

### Task 1: Rewrite pipeline tests to describe the new contract

**Files:**
- Modify: `plugins/shared/tests/test_pipeline.py`

- [ ] **Step 1: Replace the file with only the happy-path test**

Overwrite `plugins/shared/tests/test_pipeline.py` with:

```python
from pathlib import Path
from unittest.mock import patch

import pytest
import respx

from vibeshub_client.pipeline import RunOptions, run_share_pipeline
from vibeshub_client.reader import TranscriptReader


class FakeReader(TranscriptReader):
    def __init__(self, path: Path):
        self.path = path

    def find_session(self, hook_input):
        return self.path

    def platform_id(self):
        return "fake"


@pytest.mark.asyncio
async def test_pipeline_happy_path(tmp_path: Path, respx_mock: respx.MockRouter):
    transcript = tmp_path / "session.jsonl"
    transcript.write_text(
        '{"type":"user","message":{"role":"user","content":"hi"}}\n'
        '{"type":"assistant","message":{"role":"assistant","content":"hello"}}\n'
    )

    respx_mock.post("https://vibeshub.test/api/ingest").respond(
        201,
        json={
            "trace_id": "00000000-0000-0000-0000-000000000001",
            "short_id": "abc1234567",
            "trace_url": "https://vibeshub.test/alice/repo/pull/3/abc1234567",
        },
    )

    posted: list[tuple[str, str]] = []

    def fake_post(*, pr_url: str, body: str) -> None:
        posted.append((pr_url, body))

    options = RunOptions(
        server_url="https://vibeshub.test",
        token="ghp_test",
        pr_url="https://github.com/alice/repo/pull/3",
    )
    reader = FakeReader(transcript)

    with patch("vibeshub_client.pipeline.post_pr_comment", side_effect=fake_post):
        result = await run_share_pipeline(reader=reader, hook_input={}, options=options)

    assert result.uploaded is True
    assert result.short_id == "abc1234567"
    assert result.skip_reason is None
    assert posted == [(
        "https://github.com/alice/repo/pull/3",
        f"Claude Code trace for this PR: https://vibeshub.test/alice/repo/pull/3/abc1234567\n\nUploaded by the PR author. Traces are public by default.",
    )]
```

- [ ] **Step 2: Run the test and verify it fails as expected**

Run: `pytest plugins/shared/tests/test_pipeline.py -v`

Expected: FAIL. The `confirm=True` default on `RunOptions` makes the pipeline enter the `if options.confirm:` branch. With no `/dev/tty` in pytest, it auto-shares and sets `skip_reason = "no interactive terminal, auto-shared"`, so `assert result.skip_reason is None` fails.

(If by environment quirk `/dev/tty` is available, the test would instead hang on a prompt — also a failure. Either way the test correctly demands the new contract.)

- [ ] **Step 3: Commit**

```bash
git add plugins/shared/tests/test_pipeline.py
git commit -m "test(pipeline): assert new no-prompt contract (failing)"
```

---

### Task 2: Simplify the pipeline to make the test pass

**Files:**
- Modify: `plugins/shared/vibeshub_client/pipeline.py`

- [ ] **Step 1: Rewrite the pipeline module**

Overwrite `plugins/shared/vibeshub_client/pipeline.py` with:

```python
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from vibeshub_client.post_comment import build_comment_body, post_pr_comment
from vibeshub_client.reader import TranscriptReader
from vibeshub_client.redact import redact_jsonl
from vibeshub_client.upload import IngestPayload, UploadError, upload_trace
from vibeshub_client.version import PLUGIN_VERSION


@dataclass
class RunOptions:
    server_url: str
    token: str
    pr_url: str
    session_id: Optional[str] = None


@dataclass
class RunResult:
    uploaded: bool
    short_id: str | None = None
    trace_url: str | None = None
    skip_reason: str | None = None


async def run_share_pipeline(
    *,
    reader: TranscriptReader,
    hook_input: dict,
    options: RunOptions,
) -> RunResult:
    transcript_path: Path = reader.find_session(hook_input)
    raw = transcript_path.read_bytes()
    redacted, report = redact_jsonl(raw)

    payload = IngestPayload(
        transcript_jsonl=redacted.decode("utf-8", errors="replace"),
        pr_url=options.pr_url,
        platform=reader.platform_id(),
        plugin_version=PLUGIN_VERSION,
        session_id=options.session_id,
        redaction_count_client=report.total(),
    )

    try:
        result = await upload_trace(
            server_url=options.server_url,
            token=options.token,
            payload=payload,
        )
    except UploadError as e:
        return RunResult(uploaded=False, skip_reason=f"upload failed: {e}")

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
        )

    return RunResult(
        uploaded=True,
        short_id=result.short_id,
        trace_url=result.trace_url,
    )
```

Note what changed: removed `import asyncio`, `import os`, the `preview` import, `confirm`, the entire `if options.confirm:` block, `message_count`, and `auto_share_note`. The `RunOptions` dataclass no longer has a `confirm` field.

- [ ] **Step 2: Run the test and verify it passes**

Run: `pytest plugins/shared/tests/test_pipeline.py -v`

Expected: PASS (1 test).

- [ ] **Step 3: Commit**

```bash
git add plugins/shared/vibeshub_client/pipeline.py
git commit -m "refactor(pipeline): always upload, drop consent prompt and env gating"
```

---

### Task 3: Delete preview.py and its tests

**Files:**
- Delete: `plugins/shared/vibeshub_client/preview.py`
- Delete: `plugins/shared/tests/test_preview.py`

- [ ] **Step 1: Delete both files**

Run:

```bash
git rm plugins/shared/vibeshub_client/preview.py plugins/shared/tests/test_preview.py
```

- [ ] **Step 2: Run the full shared test suite to verify nothing else imports it**

Run: `pytest plugins/shared/tests/ -v`

Expected: PASS. No `ImportError` from any other module. If anything fails with `ModuleNotFoundError: No module named 'vibeshub_client.preview'`, search for stray references with `grep -rn "vibeshub_client.preview\|from .preview\|import preview" plugins/` and remove them.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: delete preview.py (no longer used)"
```

---

### Task 4: Drop confirm/AUTO_YES from the hook caller

**Files:**
- Modify: `plugins/claude-code/hooks/on-pr-create.py:103-109`

- [ ] **Step 1: Edit the RunOptions construction**

In `plugins/claude-code/hooks/on-pr-create.py`, change this block:

```python
    options = RunOptions(
        server_url=server_url,
        token=token,
        pr_url=pr_url,
        confirm=os.environ.get("VIBESHUB_AUTO_YES") != "1",
        session_id=payload.get("session_id"),
    )
```

to:

```python
    options = RunOptions(
        server_url=server_url,
        token=token,
        pr_url=pr_url,
        session_id=payload.get("session_id"),
    )
```

- [ ] **Step 2: Verify nothing else in the file references confirm or VIBESHUB_AUTO_YES**

Run: `grep -n "confirm\|VIBESHUB_AUTO" plugins/claude-code/hooks/on-pr-create.py`

Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add plugins/claude-code/hooks/on-pr-create.py
git commit -m "refactor(hook): drop confirm arg and VIBESHUB_AUTO_YES read"
```

---

### Task 5: Drop confirm/AUTO_YES from the share-pr command

**Files:**
- Modify: `plugins/claude-code/commands/share-pr.py:48-54`

- [ ] **Step 1: Edit the RunOptions construction**

In `plugins/claude-code/commands/share-pr.py`, change this block:

```python
    options = RunOptions(
        server_url=server_url,
        token=get_gh_token(),
        pr_url=pr_url,
        confirm=os.environ.get("VIBESHUB_AUTO_YES") != "1",
        session_id=session_id,
    )
```

to:

```python
    options = RunOptions(
        server_url=server_url,
        token=get_gh_token(),
        pr_url=pr_url,
        session_id=session_id,
    )
```

- [ ] **Step 2: Verify nothing else in the file references confirm or VIBESHUB_AUTO_YES**

Run: `grep -n "confirm\|VIBESHUB_AUTO" plugins/claude-code/commands/share-pr.py`

Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add plugins/claude-code/commands/share-pr.py
git commit -m "refactor(share-pr): drop confirm arg and VIBESHUB_AUTO_YES read"
```

---

### Task 6: Clean up VIBESHUB_AUTO_YES from the e2e test

**Files:**
- Modify: `plugins/claude-code/tests/test_hook_e2e.py:96`

- [ ] **Step 1: Remove the env line**

In `plugins/claude-code/tests/test_hook_e2e.py`, delete this line (currently line 96):

```python
    env["VIBESHUB_AUTO_YES"] = "1"
```

- [ ] **Step 2: Run the e2e test**

Run: `pytest plugins/claude-code/tests/test_hook_e2e.py -v`

Expected: PASS (3 tests). The hook should upload exactly as before — the env var was already a no-op against the simplified pipeline.

- [ ] **Step 3: Commit**

```bash
git add plugins/claude-code/tests/test_hook_e2e.py
git commit -m "test(hook): drop obsolete VIBESHUB_AUTO_YES env"
```

---

### Task 7: Update the plugin README

**Files:**
- Modify: `plugins/claude-code/README.md:30-47`

- [ ] **Step 1: Replace the env table and "How it works" section**

In `plugins/claude-code/README.md`, replace the section starting at "## Configure" through the end of "## How it works" with:

```markdown
## Configure

| Env var | Default | Notes |
|---|---|---|
| `VIBESHUB_SERVER_URL` | `https://vibeshub.ai` | Override for self-hosting |

## How it works

After every Bash tool call, a `PostToolUse` hook runs and checks whether the
command included `gh pr create`. If so, the hook:

1. Locates this session's transcript at
   `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`.
2. Runs client-side redaction over the JSONL (AWS keys, GitHub tokens, OpenAI
   keys, Anthropic keys, JWTs, env-style assignments, and high-entropy tokens).
3. Uploads to vibeshub using your `gh auth token` for identity.
4. Posts a `gh pr comment` linking to the public trace.

Installing the plugin is consent for upload. To stop uploading, uninstall the
plugin or remove the hook entry from your Claude Code settings. After-the-fact
deletion of any trace is available via `/share-pr delete <pr-url>`.
```

- [ ] **Step 2: Verify the file looks right**

Run: `grep -n "VIBESHUB_AUTO\|y/N preview" plugins/claude-code/README.md`

Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add plugins/claude-code/README.md
git commit -m "docs: remove consent prompt from README, document opt-out via uninstall"
```

---

### Task 8: Run the full test suite

**Files:** None.

- [ ] **Step 1: Run all plugin tests**

Run: `pytest plugins/ -v`

Expected: all tests pass. No `ImportError`, no `TypeError` from a stray `confirm=` argument.

- [ ] **Step 2: If anything fails, grep for leftovers and fix**

```bash
grep -rn "confirm=\|VIBESHUB_AUTO\|vibeshub_client.preview\|format_summary\|confirm_via_tty\|has_interactive_tty" plugins/
```

Any match outside of an intentional location (e.g., the old design doc under `docs/`) needs cleanup.

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -u
git commit -m "fix: clean up remaining consent-prompt references"
```

(Skip this step if nothing changed.)
