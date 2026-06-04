# Cursor Trace Support — Plugin Implementation Plan (Phase C of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the one adaptive vibeshub plugin discover, bundle, and upload Cursor agent transcripts (main + subagents) with `platform=cursor`, and auto-share on PR from inside Cursor via a user-level `~/.cursor/hooks.json`.

**Architecture:** A new `CursorTranscriptReader` discovers the file-based transcript at `~/.cursor/projects/<proj>/agent-transcripts/<uuid>/<uuid>.jsonl` (+ sibling `subagents/`). `select_adapter` routes to it. A new `link_cursor_subagents` links each `Task`/`Subagent` dispatch to its child file by prompt-prefix (tie-broken by file order) and assigns a deterministic `cursor-agent-<ordinal>` tool-use id (the exact id the frontend converter assigns the Nth dispatch, so subagents nest under their spawning card). The transcript is uploaded raw and verbatim; the existing `bundle.py`/`upload.py`/`redact` pipeline is reused unchanged. A user-level `~/.cursor/hooks.json` runs the existing `on-pr-share.py` after a `git push`, with `VIBESHUB_PLATFORM=cursor` set so the adapter routes reliably (no dependence on undocumented Cursor env vars). **Ships last**, since it begins emitting Cursor traces; behavior-preserving for Claude/Codex.

**Tech Stack:** Python 3.13, pytest. Tests run from the repo root via the project venv: `env/bin/pytest` (NOT the plugin-local `.venv`). The plugin root is on `sys.path` via `plugins/cli/conftest.py`, so `from reader import ...` / `from cursor_reader import ...` / `from platform_adapter import ...` work.

**Ships independently:** Yes, but deploy the backend (Phase A) and frontend (Phase B) first — this phase makes vibeshub start emitting Cursor traces that those phases must already understand.

**Spec:** `docs/superpowers/specs/2026-06-04-cursor-trace-support-design.md` (§4, §7).

**Cursor facts (load-bearing):** Transcript records are `{"role":...,"message":{"content":[...]}}`, no top-level id/timestamp (spec §3.2). `Task`/`Subagent` dispatch input is `{subagent_type, description, prompt, ...}` with no id (§3.5). Subagent files are `subagents/<uuid>.jsonl` with NO on-disk `.meta.json` — meta is synthesized in-memory (like the Codex linker). The child's first `user` record embeds the dispatch prompt inside a `<user_query>...</user_query>` envelope (§3.4). Cursor `afterShellExecution` hook input is a JSON object with the shell command at top-level `.command` (per Cursor's create-hook contract).

---

## File Structure

- Create: `plugins/cli/cursor_reader.py` — `CursorTranscriptReader` (model: `codex_reader.py`).
- Create: `plugins/cli/vibeshub_client/cursor_subagent_link.py` — `link_cursor_subagents` (content-based; in-memory meta).
- Modify: `plugins/cli/platform_adapter.py` — Cursor branch + `VIBESHUB_PLATFORM` signal.
- Modify: `plugins/cli/vibeshub_client/pipeline.py:17-18` — `_platform_label` Cursor branch.
- Modify: `plugins/cli/hooks/on-pr-share.py` — read the Cursor `.command` payload key.
- Create: `plugins/cli/commands/install-cursor.py` — merge the vibeshub hook into `~/.cursor/hooks.json`.
- Create: `plugins/cli/tests/test_cursor_reader.py`, `tests/test_cursor_subagent_link.py`, `tests/test_install_cursor.py`; extend `tests/test_platform_adapter.py`, `tests/test_hook_e2e.py`.
- Create: `plugins/cli/tests/fixtures/sessions/cursor-parallel/` and `cursor-single/` fixtures.

Unchanged (format-agnostic, reused): `bundle.py`, `upload.py`, `redact.py`, `share_trigger.py`, `vibeshub_client/subagent_link.py` (its `AgentEntry` is reused).

---

## Task 1: `link_cursor_subagents`

**Files:**
- Create: `plugins/cli/vibeshub_client/cursor_subagent_link.py`
- Create: `plugins/cli/tests/fixtures/sessions/cursor-parallel/` (a `session.jsonl` with 3 identical-prompt `Subagent` dispatches + a `subagents/` dir with 3 `<uuid>.jsonl` children)
- Test: `plugins/cli/tests/test_cursor_subagent_link.py`

- [ ] **Step 1: Build the fixture**

Create `plugins/cli/tests/fixtures/sessions/cursor-parallel/session.jsonl` (3 lines; an assistant turn dispatching 3 identical-prompt subagents):

```json
{"role":"user","message":{"content":[{"type":"text","text":"<user_query>fan out</user_query>"}]}}
{"role":"assistant","message":{"content":[{"type":"text","text":"Dispatching."},{"type":"tool_use","name":"Subagent","input":{"subagent_type":"explore","description":"Fetch #1","prompt":"Fetch https://example.com and report verbatim."}},{"type":"tool_use","name":"Subagent","input":{"subagent_type":"explore","description":"Fetch #2","prompt":"Fetch https://example.com and report verbatim."}},{"type":"tool_use","name":"Subagent","input":{"subagent_type":"explore","description":"Fetch #3","prompt":"Fetch https://example.com and report verbatim."}}]}}
{"role":"assistant","message":{"content":[{"type":"text","text":"Done."}]}}
```

Create three children under `cursor-parallel/subagents/` (filenames are any distinct 8-4-4-4-12 hex UUIDs; e.g. `11111111-1111-1111-1111-111111111111.jsonl`, `2222...`, `3333...`), each a single line whose first user record embeds the same prompt:

```json
{"role":"user","message":{"content":[{"type":"text","text":"<user_query>Fetch https://example.com and report verbatim.</user_query>"}]}}
```

- [ ] **Step 2: Write the failing test**

Create `plugins/cli/tests/test_cursor_subagent_link.py`:

```python
from pathlib import Path

from vibeshub_client.cursor_subagent_link import link_cursor_subagents

FIXTURES = Path(__file__).parent / "fixtures" / "sessions"


def test_links_parallel_identical_prompt_dispatches():
    base = FIXTURES / "cursor-parallel"
    entries = link_cursor_subagents(base / "session.jsonl", base / "subagents")
    assert len(entries) == 3
    # Each child gets a distinct deterministic id matching its dispatch ordinal.
    ids = sorted(e.tool_use_id for e in entries)
    assert ids == ["cursor-agent-0", "cursor-agent-1", "cursor-agent-2"]
    # Agent type comes from the dispatch input; meta is synthesized in-memory.
    assert all(e.agent_type == "explore" for e in entries)
    assert all(e.meta is not None and e.meta["toolUseId"] == e.tool_use_id for e in entries)
    # agent_id is the child file stem (UUID).
    assert all(len(e.agent_id) == 36 for e in entries)


def test_unmatched_child_is_orphan():
    # A subagents dir with a child whose prompt matches no dispatch.
    base = FIXTURES / "cursor-parallel"
    entries = link_cursor_subagents(Path("/nonexistent/session.jsonl"), base / "subagents")
    # No dispatches readable -> every child is an orphan (tool_use_id None).
    assert len(entries) == 3
    assert all(e.tool_use_id is None for e in entries)
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub && env/bin/pytest plugins/cli/tests/test_cursor_subagent_link.py -v`
Expected: FAIL — `cursor_subagent_link` module does not exist (import error).

- [ ] **Step 4: Write `cursor_subagent_link.py`**

Create `plugins/cli/vibeshub_client/cursor_subagent_link.py`:

```python
"""Link a Cursor main agent transcript to its subagents/ child transcripts.

Cursor's main transcript dispatches subagents via `Task`/`Subagent` tool_use
blocks that carry NO id, and the child files carry NO on-disk meta.json. We:
  - read the ordered dispatches (name in {Task, Subagent}) from the main jsonl,
  - read each child's first user message (envelope stripped) as its prompt,
  - match each dispatch to a child by prompt-prefix, tie-breaking identical
    prompts by file order (mtime, then name),
  - assign each child a deterministic tool_use_id = "cursor-agent-<ordinal>",
    where <ordinal> is the dispatch's document position. The frontend converter
    (cursorExport.ts) assigns the SAME id to the Nth Task/Subagent block, so the
    viewer nests the subagent under its spawning card.
Meta is synthesized in-memory (no .meta.json), as the Codex linker does;
bundle.py honors AgentEntry.meta when present.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path

from vibeshub_client.subagent_link import AgentEntry

log = logging.getLogger(__name__)

_QUERY_RE = re.compile(r"<user_query>\s*(.*?)\s*</user_query>", re.DOTALL)
_TS_RE = re.compile(r"<timestamp>.*?</timestamp>", re.DOTALL)
_PREFIX = 200


@dataclass
class _Dispatch:
    ordinal: int
    description: str
    subagent_type: str
    prompt: str


def _read_dispatches(main_jsonl: Path) -> list[_Dispatch]:
    out: list[_Dispatch] = []
    if not main_jsonl.is_file():
        return out
    n = 0
    with main_jsonl.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("role") != "assistant":
                continue
            for block in (rec.get("message") or {}).get("content") or []:
                if not isinstance(block, dict) or block.get("type") != "tool_use":
                    continue
                if block.get("name") not in ("Task", "Subagent"):
                    continue
                inp = block.get("input") or {}
                out.append(_Dispatch(
                    ordinal=n,
                    description=str(inp.get("description") or ""),
                    subagent_type=str(inp.get("subagent_type") or "default"),
                    prompt=str(inp.get("prompt") or ""),
                ))
                n += 1
    return out


def _child_prompt(jsonl_path: Path) -> str:
    try:
        with jsonl_path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if rec.get("role") != "user":
                    continue
                text = "\n".join(
                    str(b.get("text") or "")
                    for b in (rec.get("message") or {}).get("content") or []
                    if isinstance(b, dict)
                )
                q = _QUERY_RE.search(text)
                cleaned = q.group(1) if q else _TS_RE.sub("", text)
                return cleaned.strip()
    except OSError:
        pass
    return ""


def _entry(agent_id, tool_use_id, agent_type, description, path) -> AgentEntry:
    return AgentEntry(
        agent_id=agent_id,
        tool_use_id=tool_use_id,
        agent_type=agent_type,
        description=description,
        jsonl_path=path,
        meta_path=path,  # unused; meta is in-memory
        meta={"agentType": agent_type, "description": description, "toolUseId": tool_use_id},
    )


def link_cursor_subagents(main_jsonl: Path, subagents_dir: Path | None) -> list[AgentEntry]:
    if subagents_dir is None or not subagents_dir.is_dir():
        return []
    children = sorted(subagents_dir.glob("*.jsonl"), key=lambda p: (p.stat().st_mtime, p.name))
    if not children:
        return []
    dispatches = _read_dispatches(main_jsonl)
    child_prompt = {c: _child_prompt(c) for c in children}

    entries: list[AgentEntry] = []
    used: set[Path] = set()
    for d in dispatches:
        match = None
        for c in children:
            if c in used:
                continue
            cp = child_prompt[c]
            if cp and (cp.startswith(d.prompt[:_PREFIX]) or d.prompt.startswith(cp[:_PREFIX])):
                match = c
                break
        if match is None:
            log.warning("cursor dispatch #%d (%r) matched no child", d.ordinal, d.description)
            continue
        used.add(match)
        entries.append(_entry(
            match.stem, f"cursor-agent-{d.ordinal}", d.subagent_type,
            d.description or d.prompt[:80], match,
        ))

    for c in children:
        if c in used:
            continue
        log.warning("cursor subagent %s matched no dispatch; bundling as orphan", c.stem)
        entries.append(_entry(c.stem, None, "default", "", c))
    return entries
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/bhavya/git/vibeshub && env/bin/pytest plugins/cli/tests/test_cursor_subagent_link.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/cli/vibeshub_client/cursor_subagent_link.py plugins/cli/tests/test_cursor_subagent_link.py plugins/cli/tests/fixtures/sessions/cursor-parallel
git commit -m "plugin: link Cursor subagents by prompt with deterministic cursor-agent ids"
```

---

## Task 2: `CursorTranscriptReader`

**Files:**
- Create: `plugins/cli/cursor_reader.py`
- Create: `plugins/cli/tests/fixtures/sessions/cursor-single/` (a `<uuid>/<uuid>.jsonl` layout under an `agent-transcripts` tree, for the discovery test — or build it in the test with `tmp_path`)
- Test: `plugins/cli/tests/test_cursor_reader.py`

- [ ] **Step 1: Write the failing test**

Create `plugins/cli/tests/test_cursor_reader.py` (mirrors `test_codex_reader.py`: one explicit-path case, one newest-by-mtime fallback):

```python
import os
from pathlib import Path

from cursor_reader import CursorTranscriptReader


def _make_transcript(home: Path, slug: str, uuid: str, *, with_sub: bool = False) -> Path:
    d = home / ".cursor" / "projects" / slug / "agent-transcripts" / uuid
    d.mkdir(parents=True, exist_ok=True)
    main = d / f"{uuid}.jsonl"
    main.write_text('{"role":"user","message":{"content":[{"type":"text","text":"hi"}]}}\n', encoding="utf-8")
    if with_sub:
        sub = d / "subagents"
        sub.mkdir(exist_ok=True)
        (sub / "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl").write_text(
            '{"role":"user","message":{"content":[{"type":"text","text":"sub"}]}}\n', encoding="utf-8")
    return main


def test_platform_id():
    assert CursorTranscriptReader().platform_id() == "cursor"


def test_explicit_transcript_path(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    main = _make_transcript(tmp_path, "Repo", "11111111-1111-1111-1111-111111111111", with_sub=True)
    paths = CursorTranscriptReader().find_session_paths({"transcript_path": str(main)})
    assert paths.main_jsonl == main
    assert paths.subagents_dir == main.parent / "subagents"


def test_newest_by_mtime_fallback(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    older = _make_transcript(tmp_path, "RepoA", "22222222-2222-2222-2222-222222222222")
    newer = _make_transcript(tmp_path, "RepoB", "33333333-3333-3333-3333-333333333333")
    os.utime(older, (1, 1))
    os.utime(newer, (10_000, 10_000))
    paths = CursorTranscriptReader().find_session_paths({})
    assert paths.main_jsonl == newer
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub && env/bin/pytest plugins/cli/tests/test_cursor_reader.py -v`
Expected: FAIL — `cursor_reader` module does not exist.

- [ ] **Step 3: Write `cursor_reader.py`**

Create `plugins/cli/cursor_reader.py`:

```python
from __future__ import annotations

from pathlib import Path

from reader import SessionPaths
from vibeshub_client.reader import TranscriptReader
from vibeshub_client.cursor_subagent_link import link_cursor_subagents


def _projects_root() -> Path:
    return Path.home() / ".cursor" / "projects"


def _subagents_dir(main_jsonl: Path) -> Path | None:
    d = main_jsonl.parent / "subagents"
    return d if d.is_dir() else None


class CursorTranscriptReader(TranscriptReader):
    def platform_id(self) -> str:
        return "cursor"

    def find_session_paths(self, hook_input: dict) -> SessionPaths:
        # 1. Explicit transcript path in the payload.
        payload_path = hook_input.get("transcript_path")
        if payload_path:
            p = Path(payload_path)
            return SessionPaths(main_jsonl=p, subagents_dir=_subagents_dir(p))

        # 2. A session/conversation id -> agent-transcripts/<id>/<id>.jsonl.
        sid = hook_input.get("session_id") or hook_input.get("conversation_id")
        if sid:
            for cand in _projects_root().glob(f"*/agent-transcripts/{sid}/{sid}.jsonl"):
                return SessionPaths(main_jsonl=cand, subagents_dir=_subagents_dir(cand))

        # 3. Newest agent transcript by mtime (the just-finished session).
        transcripts = sorted(
            _projects_root().glob("*/agent-transcripts/*/*.jsonl"),
            key=lambda f: f.stat().st_mtime,
            reverse=True,
        )
        main = transcripts[0] if transcripts else _projects_root() / "missing.jsonl"
        return SessionPaths(main_jsonl=main, subagents_dir=_subagents_dir(main))

    def link_subagents(self, paths: SessionPaths, hook_input: dict) -> list:
        return link_cursor_subagents(paths.main_jsonl, paths.subagents_dir)

    def find_session(self, hook_input: dict) -> Path:
        return self.find_session_paths(hook_input).main_jsonl
```

> The glob `*/agent-transcripts/*/*.jsonl` matches only main transcripts (`<proj>/agent-transcripts/<uuid>/<uuid>.jsonl`, 4 path segments); subagent files live one level deeper (`.../subagents/<uuid>.jsonl`) and are excluded automatically.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bhavya/git/vibeshub && env/bin/pytest plugins/cli/tests/test_cursor_reader.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/cli/cursor_reader.py plugins/cli/tests/test_cursor_reader.py
git commit -m "plugin: add CursorTranscriptReader (transcript discovery + subagents dir)"
```

---

## Task 3: Route Cursor in `select_adapter`

**Files:**
- Modify: `plugins/cli/platform_adapter.py`
- Test: `plugins/cli/tests/test_platform_adapter.py`

- [ ] **Step 1: Write the failing test**

Add to `plugins/cli/tests/test_platform_adapter.py`:

```python
def test_selects_cursor_by_transcript_path():
    from platform_adapter import select_adapter
    from cursor_reader import CursorTranscriptReader
    r = select_adapter({"transcript_path": "/Users/x/.cursor/projects/Repo/agent-transcripts/ID/ID.jsonl"}, env={})
    assert isinstance(r, CursorTranscriptReader)


def test_selects_cursor_by_env_signal():
    from platform_adapter import select_adapter
    from cursor_reader import CursorTranscriptReader
    r = select_adapter({"cwd": "/Users/x/repo"}, env={"VIBESHUB_PLATFORM": "cursor"})
    assert isinstance(r, CursorTranscriptReader)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub && env/bin/pytest plugins/cli/tests/test_platform_adapter.py -v`
Expected: FAIL — both return `ClaudeCodeTranscriptReader` today.

- [ ] **Step 3: Add the Cursor branches**

In `plugins/cli/platform_adapter.py`, add the import after the existing reader imports (after line 7):

```python
from cursor_reader import CursorTranscriptReader
```

and update `select_adapter` so it reads (the `VIBESHUB_PLATFORM` check first, because our Cursor hooks.json sets it explicitly; then the path/env signals):

```python
    env = os.environ if env is None else env
    tp = payload.get("transcript_path") or ""
    if env.get("VIBESHUB_PLATFORM") == "cursor":
        return CursorTranscriptReader()
    if "/.codex/sessions/" in tp:
        return CodexTranscriptReader()
    if "/.cursor/projects/" in tp:
        return CursorTranscriptReader()
    if "/.claude/" in tp:
        return ClaudeCodeTranscriptReader()
    if env.get("CODEX_HOME"):
        return CodexTranscriptReader()
    return ClaudeCodeTranscriptReader()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bhavya/git/vibeshub && env/bin/pytest plugins/cli/tests/test_platform_adapter.py -v`
Expected: PASS (new Cursor cases plus existing Claude/Codex routing).

- [ ] **Step 5: Commit**

```bash
git add plugins/cli/platform_adapter.py plugins/cli/tests/test_platform_adapter.py
git commit -m "plugin: route Cursor in select_adapter (transcript path + VIBESHUB_PLATFORM)"
```

---

## Task 4: Label Cursor in the PR comment

**Files:**
- Modify: `plugins/cli/vibeshub_client/pipeline.py:17-18`
- Test: `plugins/cli/tests/test_pipeline.py`

- [ ] **Step 1: Write the failing test**

Add to `plugins/cli/tests/test_pipeline.py`:

```python
def test_platform_label_cursor():
    from vibeshub_client.pipeline import _platform_label
    assert _platform_label("cursor") == "Cursor"
    assert _platform_label("codex") == "Codex CLI"
    assert _platform_label("claude-code") == "Claude Code"
```

(If `test_pipeline.py` does not import `_platform_label` elsewhere, this import line is sufficient.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub && env/bin/pytest plugins/cli/tests/test_pipeline.py::test_platform_label_cursor -v`
Expected: FAIL — `_platform_label("cursor")` returns "Claude Code".

- [ ] **Step 3: Add the Cursor branch**

In `plugins/cli/vibeshub_client/pipeline.py`, replace `_platform_label` (lines 17-18):

```python
def _platform_label(platform_id: str) -> str:
    if platform_id == "codex":
        return "Codex CLI"
    if platform_id == "cursor":
        return "Cursor"
    return "Claude Code"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bhavya/git/vibeshub && env/bin/pytest plugins/cli/tests/test_pipeline.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/cli/vibeshub_client/pipeline.py plugins/cli/tests/test_pipeline.py
git commit -m "plugin: label Cursor in the PR comment"
```

---

## Task 5: Read the Cursor `.command` payload key in the share hook

Cursor's `afterShellExecution` payload carries the shell command at top-level `.command` (Claude/Codex carry it under `tool_input.command`/`.cmd`). Extend the extraction so the `git push` trigger fires under Cursor.

**Files:**
- Modify: `plugins/cli/hooks/on-pr-share.py` (the command-extraction line, ~line 72)
- Test: covered end-to-end in Task 7 (the e2e hook test). Add a focused unit test if `on-pr-share.py` exposes the extraction; otherwise the e2e guard suffices.

- [ ] **Step 1: Make the edit**

In `plugins/cli/hooks/on-pr-share.py`, change the command-extraction line from:

```python
    command = tool_input.get("command") or tool_input.get("cmd") or ""
```

to:

```python
    command = (
        tool_input.get("command")
        or tool_input.get("cmd")
        or payload.get("command")  # Cursor afterShellExecution payload
        or ""
    )
```

(`payload` is the parsed stdin JSON already read above; `tool_input` is `payload.get("tool_input") or {}`.)

- [ ] **Step 2: Run the existing hook suite to verify no regression**

Run: `cd /Users/bhavya/git/vibeshub && env/bin/pytest plugins/cli/tests/test_hook_e2e.py -v`
Expected: PASS (existing Claude/Codex hook tests unaffected — they set `tool_input.command`/`.cmd`, which still take precedence).

- [ ] **Step 3: Commit**

```bash
git add plugins/cli/hooks/on-pr-share.py
git commit -m "plugin: read Cursor afterShellExecution .command in share hook"
```

---

## Task 6: User-level `~/.cursor/hooks.json` installer

Cursor reads hooks from `~/.cursor/hooks.json` (user level). Ship an installer that merges the vibeshub `afterShellExecution` hook in without clobbering the user's existing hooks, pointing at the plugin's `on-pr-share.py` with `VIBESHUB_PLATFORM=cursor` set.

**Files:**
- Create: `plugins/cli/commands/install-cursor.py`
- Test: `plugins/cli/tests/test_install_cursor.py`

- [ ] **Step 1: Write the failing test**

Create `plugins/cli/tests/test_install_cursor.py`:

```python
import importlib.util
import json
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "install_cursor", Path(__file__).parents[1] / "commands" / "install-cursor.py"
)
install_cursor = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(install_cursor)


def test_creates_hooks_json(tmp_path):
    hooks = tmp_path / ".cursor" / "hooks.json"
    install_cursor.install(home=tmp_path, plugin_root=Path("/opt/vibeshub/plugins/cli"))
    data = json.loads(hooks.read_text())
    assert data["version"] == 1
    cmds = [h["command"] for h in data["hooks"]["afterShellExecution"]]
    assert any("VIBESHUB_PLATFORM=cursor" in c and "on-pr-share.py" in c for c in cmds)


def test_preserves_existing_hooks(tmp_path):
    hooks = tmp_path / ".cursor"
    hooks.mkdir(parents=True)
    (hooks / "hooks.json").write_text(json.dumps({
        "version": 1,
        "hooks": {"afterFileEdit": [{"command": "format.sh"}]},
    }))
    install_cursor.install(home=tmp_path, plugin_root=Path("/opt/vibeshub/plugins/cli"))
    data = json.loads((hooks / "hooks.json").read_text())
    assert data["hooks"]["afterFileEdit"] == [{"command": "format.sh"}]
    assert "afterShellExecution" in data["hooks"]


def test_idempotent(tmp_path):
    for _ in range(2):
        install_cursor.install(home=tmp_path, plugin_root=Path("/opt/vibeshub/plugins/cli"))
    data = json.loads((tmp_path / ".cursor" / "hooks.json").read_text())
    assert len(data["hooks"]["afterShellExecution"]) == 1
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub && env/bin/pytest plugins/cli/tests/test_install_cursor.py -v`
Expected: FAIL — `install-cursor.py` does not exist.

- [ ] **Step 3: Write `install-cursor.py`**

Create `plugins/cli/commands/install-cursor.py`:

```python
#!/usr/bin/env python3
"""Install the vibeshub auto-share hook into the user's ~/.cursor/hooks.json.

Merges (does not clobber) an `afterShellExecution` hook that runs the plugin's
on-pr-share.py after a `git push`, with VIBESHUB_PLATFORM=cursor set so the
adapter routes to the Cursor reader. Idempotent.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

_MARKER = "on-pr-share.py"


def _hook_command(plugin_root: Path) -> str:
    script = plugin_root / "hooks" / "on-pr-share.py"
    return f'VIBESHUB_PLATFORM=cursor python3 "{script}"'


def install(home: Path | None = None, plugin_root: Path | None = None) -> Path:
    home = home or Path.home()
    plugin_root = plugin_root or Path(__file__).resolve().parents[1]
    hooks_path = home / ".cursor" / "hooks.json"
    hooks_path.parent.mkdir(parents=True, exist_ok=True)

    if hooks_path.is_file():
        try:
            data = json.loads(hooks_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
    else:
        data = {}
    if not isinstance(data, dict):
        data = {}
    data.setdefault("version", 1)
    hooks = data.setdefault("hooks", {})
    after = hooks.setdefault("afterShellExecution", [])

    after[:] = [h for h in after if not (isinstance(h, dict) and _MARKER in str(h.get("command", "")))]
    after.append({"command": _hook_command(plugin_root), "matcher": r"git\s+push"})

    hooks_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return hooks_path


if __name__ == "__main__":
    path = install()
    print(f"Installed vibeshub Cursor auto-share hook into {path}")
    print("Restart Cursor (or save hooks.json) to load it.")
    sys.exit(0)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bhavya/git/vibeshub && env/bin/pytest plugins/cli/tests/test_install_cursor.py -v`
Expected: PASS (creates, preserves, idempotent).

- [ ] **Step 5: Commit**

```bash
git add plugins/cli/commands/install-cursor.py plugins/cli/tests/test_install_cursor.py
git commit -m "plugin: add ~/.cursor/hooks.json installer for Cursor auto-share"
```

> NOTE (deferred): manual `/share-trace` from inside Cursor is a follow-up. It works today by running the existing share command with `VIBESHUB_PLATFORM=cursor` in the environment; packaging it as a first-class Cursor command/skill is out of scope for this phase (the auto-share-on-PR hook is the primary "in the plugin" deliverable).

---

## Task 7: End-to-end Cursor share hook test

Drive a full Cursor session through `on-pr-share.py` to the fake ingest server, asserting `platform=cursor` and that the subagent bundles.

**Files:**
- Test: `plugins/cli/tests/test_hook_e2e.py` (extend; reuse `fake_server`, `_write_fake_gh`, `_run_hook`)

- [ ] **Step 1: Write the test**

Add to `plugins/cli/tests/test_hook_e2e.py`, modeled on `test_hook_uploads_codex_platform`:

```python
def test_hook_uploads_cursor_platform(tmp_path, fake_server, monkeypatch):
    fake_home = tmp_path / "home"
    uuid = "09fbacda-2df4-47a7-a12e-2534c6d55047"
    tdir = fake_home / ".cursor" / "projects" / "Repo" / "agent-transcripts" / uuid
    tdir.mkdir(parents=True)
    (tdir / f"{uuid}.jsonl").write_text(
        '{"role":"user","message":{"content":[{"type":"text",'
        '"text":"<user_query>do a sweep</user_query>"}]}}\n'
        '{"role":"assistant","message":{"content":['
        '{"type":"tool_use","name":"Subagent","input":{"subagent_type":"explore",'
        '"description":"Bug sweep","prompt":"Find bugs"}}]}}\n',
        encoding="utf-8",
    )
    subdir = tdir / "subagents"
    subdir.mkdir()
    (subdir / "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl").write_text(
        '{"role":"user","message":{"content":[{"type":"text","text":"Find bugs"}]}}\n',
        encoding="utf-8",
    )

    payload = {"command": "git push origin HEAD", "cwd": str(tmp_path / "repo")}
    env = {
        "HOME": str(fake_home),
        "VIBESHUB_PLATFORM": "cursor",
        "VIBESHUB_INGEST_URL": fake_server.url,  # match the var the codex test uses
    }
    body = _run_hook(payload, env=env)  # adapt to the helper's actual signature

    assert body["platform"] == "cursor"
    assert len(body["agents"]) == 1
    assert body["agents"][0]["tool_use_id"] == "cursor-agent-0"
```

> Adapt env var names and the `_run_hook` invocation to match the existing Codex test (`test_hook_uploads_codex_platform`, ~lines 183-231): reuse the same fake-`gh` setup, the same ingest-URL env var, and the same subprocess/stdin mechanism. The only Cursor-specific differences are: payload uses top-level `command` (no `transcript_path`), `VIBESHUB_PLATFORM=cursor` in env, and the `~/.cursor/projects/...` transcript layout.

- [ ] **Step 2: Run the test**

Run: `cd /Users/bhavya/git/vibeshub && env/bin/pytest plugins/cli/tests/test_hook_e2e.py::test_hook_uploads_cursor_platform -v`
Expected: PASS once Tasks 1-5 have landed (reader discovers the transcript via newest-by-mtime under the fake HOME, linker bundles the subagent with `cursor-agent-0`, adapter routes via `VIBESHUB_PLATFORM=cursor`, label is "Cursor").

- [ ] **Step 3: Run the full plugin suite**

Run: `cd /Users/bhavya/git/vibeshub && env/bin/pytest plugins/cli -q`
Expected: PASS (entire plugin suite green; Claude/Codex paths unchanged).

- [ ] **Step 4: Commit**

```bash
git add plugins/cli/tests/test_hook_e2e.py
git commit -m "plugin: end-to-end Cursor share hook test (platform=cursor + subagent)"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** §4.1 `CursorTranscriptReader` (transcript discovery + sibling subagents dir) → Task 2; §4.2 `select_adapter` Cursor routing → Task 3; §4.3/§7 `link_cursor_subagents` (content-based prompt match, identical-prompt tie-break, deterministic `cursor-agent-<ordinal>` ids, in-memory meta) → Task 1; §4.4 user-level `~/.cursor/hooks.json` install surface (`afterShellExecution`, `git\s+push` matcher, `VIBESHUB_PLATFORM=cursor`) → Task 6; hook command extraction → Task 5; platform label threading → Task 4; e2e platform+subagent guard → Task 7. The manual `/share-trace`-from-Cursor command is explicitly deferred (Task 6 NOTE).
- **Placeholders:** none — complete code for both new modules and the installer, exact edits for the three modified files, and exact `env/bin/pytest` commands. Task 7 explicitly flags the one thing the engineer must reconcile against the existing Codex e2e test (the `_run_hook` signature + ingest-URL env var name), because that helper's exact API was not quoted verbatim here.
- **Type consistency:** `link_cursor_subagents(main_jsonl: Path, subagents_dir: Path | None) -> list[AgentEntry]` reuses the shared `AgentEntry`; `CursorTranscriptReader` implements `platform_id`/`find_session_paths`/`link_subagents`/`find_session` exactly like `CodexTranscriptReader`; `platform_id()` returns `"cursor"`; the synthetic id `"cursor-agent-<ordinal>"` is identical across the linker (here), the frontend converter (`cursorExport.ts`), and the backend e2e test. `install(home, plugin_root)` is the testable entry point; `__main__` wraps it.
- **Cross-phase contract:** the deterministic `cursor-agent-<N>` id (N = document-order ordinal of `Task`/`Subagent` dispatches) is the single coupling point between this plan, the frontend plan (Task 1), and the backend plan (Task 4). All three use the same scheme so subagents nest under their spawning card.
