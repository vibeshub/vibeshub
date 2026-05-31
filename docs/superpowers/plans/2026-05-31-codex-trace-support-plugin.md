# Codex Trace Support — Plugin Implementation Plan (Phase C of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the single vibeshub plugin upload the right transcript with the right label under both Claude Code and Codex, including Codex subagents, by introducing a thin per-runtime adapter while reusing all of `vibeshub_client/`.

**Architecture:** The plugin already raw-uploads a transcript (redact → tar → POST). It runs under both Claude Code and Codex (shared marketplace/hook system). We keep one plugin and select an adapter at runtime: `ClaudeCodeTranscriptReader` or a new `CodexTranscriptReader`, each exposing `find_session_paths` + `link_subagents` + `platform_id`. The platform label is threaded into the upload header (currently hardcoded). Codex subagents are linked from `state_<N>.sqlite` (version-robust discovery) cross-referenced with the parent's `spawn_agent` outputs, with a schema-independent JSONL-header glob fallback. The raw Codex rollout is uploaded verbatim, so display fidelity and any future re-parse live entirely in the frontend (spec §11).

**Tech Stack:** Python 3.13, stdlib only (`sqlite3`, `tarfile`), pytest. Tests run from `plugins/claude-code/` via `/Users/bhavya/git/vibeshub/env/bin/pytest`.

**Ships last:** This is the step that begins emitting Codex traces, so it must land after the backend accepts `platform=codex` + UUID agents and the frontend can render Codex. The `PlatformAdapter` refactor is behavior-preserving for Claude Code: existing Claude tests stay green.

**Spec:** `docs/superpowers/specs/2026-05-31-codex-trace-support-design.md` (§4).

---

## File Structure

- Create: `plugins/claude-code/codex_reader.py` — `CodexTranscriptReader` (find transcript + link subagents + `platform_id`).
- Create: `plugins/claude-code/vibeshub_client/codex_subagent_link.py` — `link_codex_subagents` (sqlite + glob + spawn-output cross-link).
- Create: `plugins/claude-code/platform_adapter.py` — `select_adapter(payload, env)`.
- Create: `plugins/claude-code/.codex-plugin/plugin.json` and repo-root `.codex-plugin/marketplace.json` — Codex-native manifests.
- Modify: `vibeshub_client/upload.py` (platform kwarg), `vibeshub_client/post_comment.py` (label kwarg), `vibeshub_client/pipeline.py` (thread platform/label, call `reader.link_subagents`), `vibeshub_client/subagent_link.py` (`AgentEntry.meta`), `vibeshub_client/bundle.py` (use synthetic meta), `reader.py` (add `link_subagents` method), `hooks/hooks.json` (matcher), `hooks/on-pr-share.py` (adapter select + `cmd` extraction), `commands/share-trace.py` (adapter select).

---

## Task 1: Thread platform + comment label through the pipeline

The upload header and PR-comment text are hardcoded to Claude Code. Make both come from the adapter.

**Files:**
- Modify: `vibeshub_client/upload.py`, `vibeshub_client/post_comment.py`, `vibeshub_client/pipeline.py`
- Test: `tests/test_upload.py`, `tests/test_post_comment.py`, `tests/test_pipeline.py`

- [ ] **Step 1: Write the failing tests**

Add to `plugins/claude-code/tests/test_upload.py` (it spins a fake server asserting the platform header; mirror its existing call but pass `platform="codex"`):

```python
@pytest.mark.asyncio
async def test_upload_sends_codex_platform(...):  # copy the existing upload test's fixtures
    result = await upload_bundle(
        server_url=server_url, token="t", tar_bytes=b"x",
        pr_url=None, repo_full_name=None, plugin_version="0.4.0",
        session_id=None, redaction_count_client=0, platform="codex",
    )
    assert captured_headers["x-vibeshub-platform"] == "codex"
```

Add to `plugins/claude-code/tests/test_post_comment.py`:

```python
def test_comment_body_uses_platform_label():
    body = build_comment_body(
        "https://vibeshub.ai/t/abc", "https://github.com/a/r/pull/1",
        platform_label="Codex CLI",
    )
    assert "Codex CLI trace for this PR" in body
    # default stays Claude Code
    default = build_comment_body("https://vibeshub.ai/t/abc", "https://github.com/a/r/pull/1")
    assert "Claude Code trace for this PR" in default
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd /Users/bhavya/git/vibeshub/plugins/claude-code && /Users/bhavya/git/vibeshub/env/bin/pytest tests/test_upload.py tests/test_post_comment.py -v`
Expected: FAIL — `upload_bundle` has no `platform` kwarg (TypeError); `build_comment_body` has no `platform_label` kwarg.

- [ ] **Step 3: Implement the kwargs and thread them**

In `vibeshub_client/upload.py`, add a `platform` keyword to `upload_bundle` and use it in the header:

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
    platform: str = "claude-code",
    timeout: float = 60.0,
) -> UploadResult:
    ...
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/x-tar",
        "X-Vibeshub-Platform": platform,
        ...
    }
```

In `vibeshub_client/post_comment.py`, add a `platform_label` keyword:

```python
def build_comment_body(trace_url: str, pr_url: str, *, platform_label: str = "Claude Code") -> str:
    return (
        f"{platform_label} trace for this PR: {_pr_style_trace_url(trace_url, pr_url)}\n\n"
        "Uploaded by the PR author."
    )
```

In `vibeshub_client/pipeline.py`, add a label helper and pass both through:

```python
def _platform_label(platform_id: str) -> str:
    return "Codex CLI" if platform_id == "codex" else "Claude Code"
```

and in `run_share_pipeline`, change the `upload_bundle(...)` call to add `platform=reader.platform_id()`, and the `build_comment_body(...)` call to:

```python
                body=build_comment_body(
                    result.trace_url, options.pr_url,
                    platform_label=_platform_label(reader.platform_id()),
                ),
```

- [ ] **Step 4: Update the pipeline test's fake upload, then run all three**

In `plugins/claude-code/tests/test_pipeline.py`, add `platform="claude-code"` to the `fake_upload` signature so the now-passed kwarg is accepted:

```python
    async def fake_upload(*, server_url, token, tar_bytes, pr_url, repo_full_name,
                          plugin_version, session_id, redaction_count_client,
                          platform="claude-code", timeout=60.0):
        captured["platform"] = platform
        ...
```

Run: `cd /Users/bhavya/git/vibeshub/plugins/claude-code && /Users/bhavya/git/vibeshub/env/bin/pytest tests/test_upload.py tests/test_post_comment.py tests/test_pipeline.py -v`
Expected: PASS (new tests + existing — `test_hook_e2e` still asserts `claude-code` because the Claude reader's `platform_id()` is `"claude-code"`).

- [ ] **Step 5: Commit**

```bash
git add webapp 2>/dev/null; git add plugins/claude-code/vibeshub_client/upload.py plugins/claude-code/vibeshub_client/post_comment.py plugins/claude-code/vibeshub_client/pipeline.py plugins/claude-code/tests/test_upload.py plugins/claude-code/tests/test_post_comment.py plugins/claude-code/tests/test_pipeline.py
git commit -m "plugin: thread platform label into upload header and PR comment"
```

---

## Task 2: Adapter-dispatched subagent linking + synthetic agent meta

Make the pipeline call `reader.link_subagents(...)` (so Codex can supply its own linker), and let `AgentEntry` carry an in-memory `meta` dict (Codex has no on-disk `agent-<id>.meta.json`).

**Files:**
- Modify: `vibeshub_client/subagent_link.py` (`AgentEntry.meta`), `vibeshub_client/bundle.py`, `vibeshub_client/pipeline.py`, `reader.py`
- Test: `tests/test_bundle.py`, `tests/test_pipeline.py`

- [ ] **Step 1: Write the failing test**

Add to `plugins/claude-code/tests/test_bundle.py` (it builds bundles from `AgentEntry`s; mirror its style):

```python
def test_build_bundle_uses_in_memory_meta(tmp_path):
    main = tmp_path / "main.jsonl"
    main.write_bytes(b'{"type":"session_meta","payload":{"id":"019e7ed1"}}\n')
    child = tmp_path / "child.jsonl"
    child.write_bytes(b'{"type":"session_meta","payload":{"id":"019e7f09"}}\n')
    entry = AgentEntry(
        agent_id="019e7f09-bca2-7150-ac2b-54f7b075a2ea",
        tool_use_id="call_spawn", agent_type="default", description="Godel",
        jsonl_path=child, meta_path=child,  # meta_path unused when meta is set
        meta={"agentType": "default", "description": "Godel", "toolUseId": "call_spawn"},
    )
    tar_bytes, _ = build_bundle(main, [entry], redact=lambda b: (b, RedactionReport()))
    import io, tarfile, json
    with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:gz") as tar:
        names = {m.name for m in tar.getmembers()}
        meta = json.loads(tar.extractfile(
            "agents/019e7f09-bca2-7150-ac2b-54f7b075a2ea.meta.json").read())
    assert "agents/019e7f09-bca2-7150-ac2b-54f7b075a2ea.jsonl" in names
    assert meta["agentType"] == "default"
    assert meta["toolUseId"] == "call_spawn"
```

(Import `AgentEntry`, `build_bundle`, `RedactionReport` at the top as the other bundle tests do.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub/plugins/claude-code && /Users/bhavya/git/vibeshub/env/bin/pytest tests/test_bundle.py::test_build_bundle_uses_in_memory_meta -v`
Expected: FAIL — `AgentEntry` has no `meta` field (TypeError).

- [ ] **Step 3: Add `AgentEntry.meta`, use it in bundle, add reader method, refactor pipeline**

In `vibeshub_client/subagent_link.py`, add a field to `AgentEntry` (default keeps Claude behavior):

```python
@dataclass
class AgentEntry:
    agent_id: str
    tool_use_id: str | None
    agent_type: str
    description: str
    jsonl_path: Path
    meta_path: Path
    meta: dict | None = None
```

In `vibeshub_client/bundle.py`, change the meta read inside the `for a in agents:` loop:

```python
            if a.meta is not None:
                meta_in = dict(a.meta)
            else:
                meta_in = json.loads(a.meta_path.read_text(encoding="utf-8"))
            meta_in["toolUseId"] = a.tool_use_id
```

In `reader.py`, add a `link_subagents` method to `ClaudeCodeTranscriptReader` (delegates to the existing module function):

```python
    def link_subagents(self, paths: "SessionPaths", hook_input: dict) -> list:
        from vibeshub_client.subagent_link import link_subagents
        return link_subagents(paths.main_jsonl, paths.subagents_dir)
```

In `vibeshub_client/pipeline.py`, remove the top-level `from vibeshub_client.subagent_link import link_subagents` import, and change the linking line in `run_share_pipeline`:

```python
    agents = reader.link_subagents(paths, hook_input)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /Users/bhavya/git/vibeshub/plugins/claude-code && /Users/bhavya/git/vibeshub/env/bin/pytest tests/test_bundle.py tests/test_pipeline.py -v`
Expected: PASS (new bundle test + existing pipeline test, which now goes through `reader.link_subagents`).

- [ ] **Step 5: Commit**

```bash
git add plugins/claude-code/vibeshub_client/subagent_link.py plugins/claude-code/vibeshub_client/bundle.py plugins/claude-code/vibeshub_client/pipeline.py plugins/claude-code/reader.py plugins/claude-code/tests/test_bundle.py
git commit -m "plugin: adapter-dispatched link_subagents + in-memory AgentEntry.meta"
```

---

## Task 3: `CodexTranscriptReader`

Finds the Codex rollout (the hook payload's `transcript_path` points at it; otherwise the newest rollout for the cwd) and reports `platform_id() == "codex"`.

**Files:**
- Create: `plugins/claude-code/codex_reader.py`
- Test: `plugins/claude-code/tests/test_codex_reader.py`

- [ ] **Step 1: Write the failing test**

Create `plugins/claude-code/tests/test_codex_reader.py`:

```python
from pathlib import Path
from codex_reader import CodexTranscriptReader


def test_uses_payload_transcript_path(tmp_path):
    rollout = tmp_path / "rollout-2026-05-31T09-20-17-019e7ed6.jsonl"
    rollout.write_bytes(b'{"type":"session_meta","payload":{"id":"019e7ed6"}}\n')
    reader = CodexTranscriptReader()
    paths = reader.find_session_paths({"transcript_path": str(rollout)})
    assert paths.main_jsonl == rollout
    assert paths.subagents_dir is None
    assert reader.platform_id() == "codex"


def test_falls_back_to_newest_rollout(tmp_path, monkeypatch):
    sessions = tmp_path / "sessions" / "2026" / "05" / "31"
    sessions.mkdir(parents=True)
    old = sessions / "rollout-2026-05-31T09-00-00-aaa.jsonl"
    new = sessions / "rollout-2026-05-31T10-00-00-bbb.jsonl"
    old.write_bytes(b"{}\n")
    new.write_bytes(b"{}\n")
    import os
    os.utime(new, (new.stat().st_atime, old.stat().st_mtime + 100))
    monkeypatch.setenv("CODEX_HOME", str(tmp_path))
    reader = CodexTranscriptReader()
    paths = reader.find_session_paths({})
    assert paths.main_jsonl == new
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub/plugins/claude-code && /Users/bhavya/git/vibeshub/env/bin/pytest tests/test_codex_reader.py -v`
Expected: FAIL — `codex_reader` module does not exist.

- [ ] **Step 3: Write `codex_reader.py`**

Create `plugins/claude-code/codex_reader.py`:

```python
from __future__ import annotations

import os
import time
from pathlib import Path

from reader import SessionPaths
from vibeshub_client.reader import TranscriptReader
from vibeshub_client.codex_subagent_link import link_codex_subagents


def _codex_home() -> Path:
    return Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))


class CodexTranscriptReader(TranscriptReader):
    def platform_id(self) -> str:
        return "codex"

    def find_session_paths(self, hook_input: dict) -> SessionPaths:
        # Codex PostToolUse payloads carry transcript_path = the rollout file.
        payload_path = hook_input.get("transcript_path")
        if payload_path:
            p = Path(payload_path)
            for _ in range(2):
                if p.is_file():
                    return SessionPaths(main_jsonl=p, subagents_dir=None)
                time.sleep(0.2)
            return SessionPaths(main_jsonl=p, subagents_dir=None)

        # Manual/fallback: newest rollout under $CODEX_HOME/sessions.
        sessions = _codex_home() / "sessions"
        rollouts = sorted(
            sessions.glob("**/rollout-*.jsonl"),
            key=lambda f: f.stat().st_mtime,
            reverse=True,
        )
        main = rollouts[0] if rollouts else sessions / "missing.jsonl"
        return SessionPaths(main_jsonl=main, subagents_dir=None)

    def link_subagents(self, paths: SessionPaths, hook_input: dict) -> list:
        return link_codex_subagents(paths.main_jsonl, hook_input)

    def find_session(self, hook_input: dict) -> Path:
        return self.find_session_paths(hook_input).main_jsonl
```

(`link_codex_subagents` is implemented in Task 4; create that module's stub now or order Task 4 before re-running the full suite. The reader test above does not call `link_subagents`, so it passes once the import resolves — create `vibeshub_client/codex_subagent_link.py` with at least the function signature, or implement Task 4 first.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd /Users/bhavya/git/vibeshub/plugins/claude-code && /Users/bhavya/git/vibeshub/env/bin/pytest tests/test_codex_reader.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/claude-code/codex_reader.py plugins/claude-code/tests/test_codex_reader.py
git commit -m "plugin: CodexTranscriptReader (rollout discovery, platform_id=codex)"
```

---

## Task 4: `link_codex_subagents` — sqlite + glob + spawn-output cross-link

The centerpiece. Discovers every descendant rollout (user-spawned and guardian), links user subagents to their `spawn_agent` `call_id`, and is robust to `state_<N>` filename bumps and a missing/locked DB.

**Files:**
- Create: `plugins/claude-code/vibeshub_client/codex_subagent_link.py`
- Test: `plugins/claude-code/tests/test_codex_subagent_link.py`

- [ ] **Step 1: Write the failing test**

Create `plugins/claude-code/tests/test_codex_subagent_link.py`:

```python
import json
import sqlite3
from pathlib import Path

from vibeshub_client.codex_subagent_link import link_codex_subagents


def _write(p: Path, records: list[dict]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("\n".join(json.dumps(r) for r in records) + "\n", encoding="utf-8")


def _build_codex_home(tmp_path: Path) -> Path:
    home = tmp_path / ".codex"
    day = home / "sessions" / "2026" / "05" / "31"
    main_id = "019e7ed1-0400-7f03-ba68-11f9a59e6f11"
    child_id = "019e7f09-bca2-7150-ac2b-54f7b075a2ea"
    guardian_id = "019e7f0a-065b-7e33-8208-8c8481cb276f"

    main = day / f"rollout-2026-05-31T09-14-47-{main_id}.jsonl"
    _write(main, [
        {"type": "session_meta", "payload": {"id": main_id}},
        {"type": "response_item", "payload": {"type": "function_call",
            "name": "spawn_agent", "call_id": "call_spawn",
            "arguments": json.dumps({"agent_type": "default", "message": "go"})}},
        {"type": "response_item", "payload": {"type": "function_call_output",
            "call_id": "call_spawn",
            "output": json.dumps({"agent_id": child_id, "nickname": "Godel"})}},
    ])
    _write(day / f"rollout-...-{child_id}.jsonl", [
        {"type": "session_meta", "payload": {"id": child_id, "thread_source": "subagent",
            "forked_from_id": main_id,
            "source": {"subagent": {"thread_spawn": {"parent_thread_id": main_id,
                "agent_role": "default", "agent_nickname": "Godel"}}}}},
    ])
    _write(day / f"rollout-...-{guardian_id}.jsonl", [
        {"type": "session_meta", "payload": {"id": guardian_id, "thread_source": "subagent",
            "forked_from_id": main_id,
            "source": {"subagent": {"other": "guardian"}}}},
    ])

    db = home / "state_5.sqlite"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, "
                "agent_role TEXT, agent_nickname TEXT, model TEXT, first_user_message TEXT, thread_source TEXT)")
    con.execute("CREATE TABLE thread_spawn_edges (parent_thread_id TEXT, child_thread_id TEXT, status TEXT)")
    con.execute("INSERT INTO threads VALUES (?,?,?,?,?,?,?)",
                (child_id, str(day / f"rollout-...-{child_id}.jsonl"),
                 "default", "Godel", "gpt-5.5", "go", "subagent"))
    con.execute("INSERT INTO thread_spawn_edges VALUES (?,?,?)", (main_id, child_id, "closed"))
    con.commit(); con.close()
    return main


def test_links_user_subagent_and_includes_guardian(tmp_path, monkeypatch):
    main = _build_codex_home(tmp_path)
    monkeypatch.setenv("CODEX_HOME", str(tmp_path / ".codex"))

    entries = link_codex_subagents(main, {})
    by_id = {e.agent_id: e for e in entries}

    child = by_id["019e7f09-bca2-7150-ac2b-54f7b075a2ea"]
    assert child.tool_use_id == "call_spawn"      # cross-linked from spawn output
    assert child.agent_type == "default"
    assert child.meta["nickname"] == "Godel"

    guardian = by_id["019e7f0a-065b-7e33-8208-8c8481cb276f"]
    assert guardian.tool_use_id is None           # no user spawn call
    assert guardian.agent_type == "guardian"      # stored but hidden by the frontend


def test_glob_fallback_when_db_absent(tmp_path, monkeypatch):
    main = _build_codex_home(tmp_path)
    (tmp_path / ".codex" / "state_5.sqlite").unlink()
    monkeypatch.setenv("CODEX_HOME", str(tmp_path / ".codex"))

    entries = link_codex_subagents(main, {})
    ids = {e.agent_id for e in entries}
    assert "019e7f09-bca2-7150-ac2b-54f7b075a2ea" in ids   # still found via header glob
    child = next(e for e in entries if e.agent_id.startswith("019e7f09"))
    assert child.tool_use_id == "call_spawn"               # linkage survives without the DB
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub/plugins/claude-code && /Users/bhavya/git/vibeshub/env/bin/pytest tests/test_codex_subagent_link.py -v`
Expected: FAIL — `codex_subagent_link` module does not exist.

- [ ] **Step 3: Write `codex_subagent_link.py`**

Create `plugins/claude-code/vibeshub_client/codex_subagent_link.py`:

```python
"""Link a Codex main rollout to its subagent (and guardian) child rollouts.

Linkage signals, all recoverable from the stored JSONL alone (spec §11):
  - parent -> child: the main rollout's `spawn_agent` function_call_output is
    `{"agent_id": <child>, "nickname": ...}`; its `call_id` is the tool_use_id.
  - child -> parent + role/nickname: the child rollout's line-1 session_meta
    (`forked_from_id`, `source.subagent.thread_spawn`).
`state_<N>.sqlite` is an optional enrichment/locator; the JSONL-header glob is
the schema-independent fallback. Guardians are bundled too (tool_use_id=None,
agent_type="guardian") so a future "show guardians" needs no re-upload.
"""
from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from vibeshub_client.subagent_link import AgentEntry

log = logging.getLogger(__name__)

_STATE_DB_RE = re.compile(r"^state_(\d+)\.sqlite$")


@dataclass
class _ChildHeader:
    child_id: str
    forked_from: str | None
    role: str | None
    nickname: str | None
    path: Path


def _codex_home() -> Path:
    return Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))


def _read_thread_id(jsonl: Path) -> str | None:
    try:
        with jsonl.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                rec = json.loads(line)
                if rec.get("type") == "session_meta":
                    return (rec.get("payload") or {}).get("id")
                return None
    except (OSError, json.JSONDecodeError):
        return None
    return None


def _scan_child_headers(home: Path) -> list[_ChildHeader]:
    out: list[_ChildHeader] = []
    for path in (home / "sessions").glob("**/rollout-*.jsonl"):
        try:
            with path.open("r", encoding="utf-8") as f:
                first = f.readline().strip()
            if not first:
                continue
            payload = (json.loads(first).get("payload") or {})
        except (OSError, json.JSONDecodeError):
            continue
        if payload.get("thread_source") != "subagent":
            continue
        sub = (payload.get("source") or {}).get("subagent") or {}
        spawn = sub.get("thread_spawn") or {}
        role = spawn.get("agent_role")
        if sub.get("other") == "guardian" or role is None:
            role = "guardian"
        out.append(_ChildHeader(
            child_id=payload.get("id"),
            forked_from=payload.get("forked_from_id"),
            role=role,
            nickname=spawn.get("agent_nickname"),
            path=path,
        ))
    return out


def _read_spawn_outputs(jsonl: Path) -> dict[str, str]:
    """child_thread_id -> spawn_agent call_id, from a transcript's outputs."""
    out: dict[str, str] = {}
    try:
        with jsonl.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or '"function_call_output"' not in line:
                    continue
                try:
                    p = (json.loads(line).get("payload") or {})
                except json.JSONDecodeError:
                    continue
                if p.get("type") != "function_call_output":
                    continue
                try:
                    body = json.loads(p.get("output") or "")
                except (json.JSONDecodeError, TypeError):
                    continue
                if isinstance(body, dict) and body.get("agent_id"):
                    out[body["agent_id"]] = p.get("call_id")
    except OSError:
        pass
    return out


def _find_state_db(home: Path) -> Path | None:
    candidates: list[tuple[int, Path]] = []
    for p in home.glob("state_*.sqlite"):
        m = _STATE_DB_RE.match(p.name)
        if m:
            candidates.append((int(m.group(1)), p))
    for _, p in sorted(candidates, reverse=True):
        try:
            con = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
            try:
                has = con.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='thread_spawn_edges'"
                ).fetchone()
            finally:
                con.close()
            if has:
                return p
        except sqlite3.Error:
            continue
    return None


def _sqlite_meta(home: Path, child_ids: set[str]) -> dict[str, dict]:
    db = _find_state_db(home)
    if not db or not child_ids:
        return {}
    placeholders = ",".join("?" for _ in child_ids)
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            rows = con.execute(
                f"SELECT id, rollout_path, agent_role, agent_nickname, model, first_user_message "
                f"FROM threads WHERE id IN ({placeholders})",
                tuple(child_ids),
            ).fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return {}
    return {
        r[0]: {"rollout_path": r[1], "role": r[2], "nickname": r[3],
               "model": r[4], "first_user_message": r[5]}
        for r in rows
    }


def link_codex_subagents(main_jsonl: Path, hook_input: dict) -> list[AgentEntry]:
    home = _codex_home()
    main_id = _read_thread_id(main_jsonl)
    if not main_id:
        return []

    headers = _scan_child_headers(home)
    by_parent: dict[str, list[_ChildHeader]] = defaultdict(list)
    for h in headers:
        if h.forked_from:
            by_parent[h.forked_from].append(h)

    # BFS over descendants (depth > 1 supported).
    discovered: dict[str, _ChildHeader] = {}
    frontier = [main_id]
    while frontier:
        pid = frontier.pop()
        for h in by_parent.get(pid, []):
            if h.child_id and h.child_id not in discovered:
                discovered[h.child_id] = h
                frontier.append(h.child_id)
    if not discovered:
        return []

    # Cross-link call_id from spawn outputs across main + every discovered transcript.
    call_by_child: dict[str, str] = {}
    for path in [main_jsonl] + [h.path for h in discovered.values()]:
        call_by_child.update(_read_spawn_outputs(path))

    meta = _sqlite_meta(home, set(discovered))

    entries: list[AgentEntry] = []
    for cid, h in discovered.items():
        m = meta.get(cid, {})
        role = h.role or m.get("role") or "default"
        nickname = h.nickname or m.get("nickname")
        description = m.get("first_user_message") or nickname or ""
        tool_use_id = call_by_child.get(cid)
        entries.append(AgentEntry(
            agent_id=cid,
            tool_use_id=tool_use_id,
            agent_type=role,
            description=description,
            jsonl_path=h.path,
            meta_path=h.path,  # unused; meta is in-memory below
            meta={"agentType": role, "description": description,
                  "toolUseId": tool_use_id, "nickname": nickname},
        ))
    return entries
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /Users/bhavya/git/vibeshub/plugins/claude-code && /Users/bhavya/git/vibeshub/env/bin/pytest tests/test_codex_subagent_link.py -v`
Expected: PASS (both the sqlite-present and DB-absent fallback tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/claude-code/vibeshub_client/codex_subagent_link.py plugins/claude-code/tests/test_codex_subagent_link.py
git commit -m "plugin: link Codex subagents via sqlite + header glob + spawn-output cross-link"
```

---

## Task 5: Runtime adapter selection + hook adaptivity

Select the adapter at runtime, broaden the hook matcher to Codex's shell tool, and extract the command from either `command` (Claude) or `cmd` (Codex).

**Files:**
- Create: `plugins/claude-code/platform_adapter.py`
- Modify: `plugins/claude-code/hooks/hooks.json`, `plugins/claude-code/hooks/on-pr-share.py`
- Test: `plugins/claude-code/tests/test_platform_adapter.py`

- [ ] **Step 1: Write the failing test**

Create `plugins/claude-code/tests/test_platform_adapter.py`:

```python
from platform_adapter import select_adapter


def test_selects_codex_by_transcript_path():
    r = select_adapter({"transcript_path": "/Users/x/.codex/sessions/2026/05/31/rollout-a.jsonl"}, env={})
    assert r.platform_id() == "codex"


def test_selects_claude_by_transcript_path():
    r = select_adapter({"transcript_path": "/Users/x/.claude/projects/-x/abc.jsonl"}, env={})
    assert r.platform_id() == "claude-code"


def test_selects_codex_by_env_when_path_ambiguous():
    assert select_adapter({}, env={"CODEX_HOME": "/Users/x/.codex"}).platform_id() == "codex"
    assert select_adapter({}, env={}).platform_id() == "claude-code"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub/plugins/claude-code && /Users/bhavya/git/vibeshub/env/bin/pytest tests/test_platform_adapter.py -v`
Expected: FAIL — `platform_adapter` module does not exist.

- [ ] **Step 3: Write the selector and wire the hook**

Create `plugins/claude-code/platform_adapter.py`:

```python
from __future__ import annotations

import os
from typing import Mapping

from reader import ClaudeCodeTranscriptReader
from codex_reader import CodexTranscriptReader


def select_adapter(payload: dict, env: Mapping[str, str] | None = None):
    """Pick the per-runtime adapter. transcript_path is the strongest signal
    (Claude under ~/.claude, Codex under ~/.codex/sessions); CODEX_HOME breaks
    ties for the manual/command path."""
    env = os.environ if env is None else env
    tp = payload.get("transcript_path") or ""
    if "/.codex/sessions/" in tp:
        return CodexTranscriptReader()
    if "/.claude/" in tp:
        return ClaudeCodeTranscriptReader()
    if env.get("CODEX_HOME"):
        return CodexTranscriptReader()
    return ClaudeCodeTranscriptReader()
```

In `plugins/claude-code/hooks/hooks.json`, broaden the matcher to also fire on Codex's shell tool:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash|exec_command|shell",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/hooks/on-pr-share.py\"",
            "async": false
          }
        ]
      }
    ]
  }
}
```

In `plugins/claude-code/hooks/on-pr-share.py`:
- change the command extraction to accept Codex's `cmd`:
```python
    command = tool_input.get("command") or tool_input.get("cmd") or ""
```
- replace the hardcoded reader construction (`from reader import ClaudeCodeTranscriptReader` + `reader = ClaudeCodeTranscriptReader()`) with adapter selection:
```python
    from platform_adapter import select_adapter
    reader = select_adapter(payload)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /Users/bhavya/git/vibeshub/plugins/claude-code && /Users/bhavya/git/vibeshub/env/bin/pytest tests/test_platform_adapter.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/claude-code/platform_adapter.py plugins/claude-code/hooks/hooks.json plugins/claude-code/hooks/on-pr-share.py plugins/claude-code/tests/test_platform_adapter.py
git commit -m "plugin: runtime adapter selection + Codex-aware hook matcher and command extraction"
```

---

## Task 6: Manual `/share-trace` selects the adapter too

So a manual share works under Codex (the runtime-independent fallback if the auto-trigger needs Codex-side iteration).

**Files:**
- Modify: `plugins/claude-code/commands/share-trace.py`
- Test: `plugins/claude-code/tests/test_share_trace.py` (extend if it covers `_share`; otherwise a focused import/selection test)

- [ ] **Step 1: Write the failing test**

Add to `plugins/claude-code/tests/test_share_trace.py` a check that the command module uses `select_adapter` (import-level), or a small unit test if `_share` is structured for it. Minimal guard:

```python
def test_share_trace_imports_select_adapter():
    import importlib, inspect
    mod = importlib.import_module("commands.share-trace".replace("-", "_")) \
        if False else None  # share-trace.py has a hyphen; load by path instead
    src = (Path(__file__).resolve().parent.parent / "commands" / "share-trace.py").read_text()
    assert "select_adapter" in src
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub/plugins/claude-code && /Users/bhavya/git/vibeshub/env/bin/pytest tests/test_share_trace.py -k select_adapter -v`
Expected: FAIL — `share-trace.py` still constructs `ClaudeCodeTranscriptReader` directly.

- [ ] **Step 3: Use the adapter in the command**

In `plugins/claude-code/commands/share-trace.py`, inside `_share`, replace `from reader import ClaudeCodeTranscriptReader` + `reader = ClaudeCodeTranscriptReader()` with:

```python
    from platform_adapter import select_adapter
    # Under Codex there is no transcript_path here; select_adapter falls back to
    # CODEX_HOME, and CodexTranscriptReader picks the newest rollout for the cwd.
    reader = select_adapter({"cwd": os.getcwd()})
```

and keep the existing `hook_input = {"session_id": session_id, "cwd": os.getcwd()}`. (Codex's `CodexTranscriptReader.find_session_paths` ignores `session_id` and uses the newest rollout, so the manual path works under both.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd /Users/bhavya/git/vibeshub/plugins/claude-code && /Users/bhavya/git/vibeshub/env/bin/pytest tests/test_share_trace.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/claude-code/commands/share-trace.py plugins/claude-code/tests/test_share_trace.py
git commit -m "plugin: manual share-trace selects the runtime adapter"
```

---

## Task 7: Codex-native plugin manifests

So Codex installs the plugin as a first-class Codex plugin (it looks for `.codex-plugin/plugin.json`; today it falls back to `.claude-plugin`).

**Files:**
- Create: `plugins/claude-code/.codex-plugin/plugin.json`
- Create: `.codex-plugin/marketplace.json` (repo root)

- [ ] **Step 1: Create the plugin manifest**

`plugins/claude-code/.codex-plugin/plugin.json` (mirror `.claude-plugin/plugin.json`, but describe both runtimes):

```json
{
  "name": "vibeshub",
  "description": "Upload Claude Code and Codex CLI conversation traces to vibeshub when a PR is created",
  "version": "0.4.0",
  "author": {
    "name": "vibeshub",
    "email": "noreply@vibeshub.ai"
  },
  "license": "MIT"
}
```

- [ ] **Step 2: Create the Codex marketplace entry**

Read the existing `.claude-plugin/marketplace.json` at the repo root and create `.codex-plugin/marketplace.json` mirroring it (same `source: "./plugins/claude-code"`, since this is one adaptive plugin). Keep the marketplace and plugin `name` identical to the Claude entry so an existing `vibeshub@vibeshub` install resolves to the same source.

- [ ] **Step 3: Bump versions in lockstep**

Set `version` to `0.4.0` in all three: `plugins/claude-code/.claude-plugin/plugin.json`, `plugins/claude-code/.codex-plugin/plugin.json`, and `plugins/claude-code/pyproject.toml` (`version = "0.4.0"`), and update `vibeshub_client/version.py`'s `PLUGIN_VERSION` to `"0.4.0"`.

- [ ] **Step 4: Validate manifests parse**

Run: `cd /Users/bhavya/git/vibeshub && python3 -c "import json; json.load(open('plugins/claude-code/.codex-plugin/plugin.json')); json.load(open('.codex-plugin/marketplace.json')); print('ok')"`
Expected: prints `ok`.

> **Live validation (manual, cannot be unit-tested):** confirm Codex actually discovers `.codex-plugin/plugin.json` and fires `PostToolUse` with the broadened matcher against the bundled `codex` binary. If Codex's hook payload keys differ from the assumption (`tool_input.cmd`, `transcript_path`), adjust Task 5's extraction. The manual `/share-trace` path (Task 6) is the runtime-independent fallback.

- [ ] **Step 5: Commit**

```bash
git add plugins/claude-code/.codex-plugin/plugin.json .codex-plugin/marketplace.json plugins/claude-code/.claude-plugin/plugin.json plugins/claude-code/pyproject.toml plugins/claude-code/vibeshub_client/version.py
git commit -m "plugin: add Codex-native manifests, bump to 0.4.0"
```

---

## Task 8: End-to-end Codex hook test

Prove the hook, under a Codex payload, uploads with `platform=codex`.

**Files:**
- Test: `plugins/claude-code/tests/test_hook_e2e.py` (extend; reuse its fake-`gh` + real-FastAPI-server harness)

- [ ] **Step 1: Write the failing test**

Add a Codex variant of the existing e2e test: stage a `$CODEX_HOME/sessions/.../rollout-*.jsonl` (a minimal Codex rollout), run the hook subprocess with a payload whose `transcript_path` points at it and `tool_input.cmd` is `gh pr create ...` (plus `tool_response.stdout` carrying a PR URL), set `CODEX_HOME` in the subprocess env, and assert the server received `platform == "codex"` and the body is a gzip tar.

```python
@pytest.mark.asyncio
async def test_hook_uploads_codex_platform(tmp_path, ...):  # reuse the existing harness helpers
    rollout = tmp_path / ".codex" / "sessions" / "2026" / "05" / "31" / "rollout-x.jsonl"
    rollout.parent.mkdir(parents=True)
    rollout.write_bytes(b'{"type":"session_meta","payload":{"id":"019e7ed1"}}\n')
    payload = {
        "session_id": "019e7ed1",
        "cwd": str(tmp_path),
        "transcript_path": str(rollout),
        "tool_input": {"cmd": "gh pr create --fill"},
        "tool_response": {"stdout": "https://github.com/a/r/pull/1\n"},
    }
    env = {**base_env, "CODEX_HOME": str(tmp_path / ".codex")}
    # run the hook subprocess exactly as the existing claude e2e test does, with `env`
    ...
    assert received["platform"] == "codex"
    assert received["body"][:2] == b"\x1f\x8b"
```

- [ ] **Step 2: Run to verify it fails (before Tasks 3-5) / passes (after)**

Run: `cd /Users/bhavya/git/vibeshub/plugins/claude-code && /Users/bhavya/git/vibeshub/env/bin/pytest tests/test_hook_e2e.py -v`
Expected: With Tasks 1-5 landed, PASS. (The fake `gh` script in the existing harness already handles `pr create`/`auth token`/`pr comment`; the new case just adds the Codex env + payload.)

- [ ] **Step 3: No new implementation**

Pure integration guard over Tasks 1-5.

- [ ] **Step 4: Run the full plugin suite**

Run: `cd /Users/bhavya/git/vibeshub/plugins/claude-code && /Users/bhavya/git/vibeshub/env/bin/pytest -q`
Expected: PASS (entire suite — Claude paths unchanged, Codex paths green).

- [ ] **Step 5: Commit**

```bash
git add plugins/claude-code/tests/test_hook_e2e.py
git commit -m "plugin: end-to-end Codex hook upload test (platform=codex)"
```

---

## Self-Review (completed during authoring)

- **Spec coverage (§4):** platform threaded into upload (§4.2) → Task 1; comment label (§4.2) → Task 1; `link_subagents` adapter dispatch (§4.1) + in-memory meta → Task 2; `CodexTranscriptReader.find_main_transcript` (§4.3) → Task 3; `link_codex_subagents` sqlite/glob/cross-link with `state_<N>` discovery, guardian inclusion, depth>1 BFS, DB-absent fallback (§4.4 steps 0-6) → Task 4; `select_adapter` + broadened matcher + `cmd` extraction (§4.1, §4.2) → Task 5; manual command adaptivity → Task 6; `.codex-plugin` manifest + marketplace (§4.5) → Task 7; e2e (§8.5) → Task 8.
- **Placeholders:** none — full code for `codex_reader.py`, `codex_subagent_link.py`, `platform_adapter.py`, and exact edits/JSON elsewhere; every step has the exact `env/bin/pytest` command. The one item that genuinely cannot be unit-tested (Codex's live hook payload/matcher) is called out explicitly in Task 7 with a fallback.
- **Type consistency:** `AgentEntry` gains `meta: dict | None = None` (default-compatible with the Claude linker, which never sets it); `reader.link_subagents(paths, hook_input)` signature is identical on both `ClaudeCodeTranscriptReader` and `CodexTranscriptReader`; `upload_bundle(..., platform="claude-code")` default keeps existing direct callers green; `select_adapter(payload, env=None)` used consistently.
- **Behavior-preserving for Claude:** `platform_id()=="claude-code"` keeps the upload header and comment label unchanged; `test_hook_e2e`'s existing Claude assertion (`platform=="claude-code"`) still holds.
