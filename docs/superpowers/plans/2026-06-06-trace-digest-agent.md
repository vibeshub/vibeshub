# Trace digest agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an LLM-generated, 5-bullet trace digest plus semantic chapter anchors at upload time. Surface the digest in the Hero panel and the PR comment body. Record every run in a new `agent_run` Postgres table.

**Architecture:** A new `webapp/backend/app/agents/` folder holds shared LLM infrastructure and per-agent subfolders. The first agent (`digest/`) distills the JSONL via tiered classification, calls OpenAI's `responses.create` with a structured `json_object` schema, validates anchor UUIDs, persists `digest_json` + `digest_input_hash` on the trace row, and records the run in `agent_run`. The plugin reads the `digest` field from the upload response and embeds it in the `gh pr comment` body. The viewer renders a `DigestPanel` above the existing `Outcome` card plus inline `ChapterDivider`s in the thread.

**Tech Stack:**
- Backend: FastAPI, SQLAlchemy 2 async, Alembic, Pydantic v2, pytest
- LLM: `openai` Python SDK pointed at `VIBESHUB_OPENAI_ENDPOINT` (Azure OpenAI shape, mirroring `polybot/storybot/twitter_pipeline.py:1928`)
- Plugin: stdlib only, pytest
- Frontend: React + Vite + vitest + React Testing Library

**Spec reference:** `docs/superpowers/specs/2026-06-06-trace-digest-agent-design.md`

**Conventions used throughout this plan:**
- Backend pytest runs via `./env/bin/pytest webapp/backend/tests/...` (NOT `.venv` — that lacks pytest; see `reference_backend_test_env` memory).
- Frontend tests run via `cd webapp/frontend && npx vitest run path/to/test`.
- Plugin tests run via `./env/bin/pytest plugins/cli/tests/...`.
- After each task, run the relevant test suite and commit.

---

## Phase A — Backend foundation (pure, no I/O)

### Task 1: Output schema + em-dash sweeper

**Files:**
- Create: `webapp/backend/app/agents/__init__.py` (empty marker)
- Create: `webapp/backend/app/agents/digest/__init__.py`
- Create: `webapp/backend/app/agents/digest/schema.py`
- Create: `webapp/backend/tests/agents/__init__.py` (empty marker)
- Create: `webapp/backend/tests/agents/digest/__init__.py` (empty marker)
- Create: `webapp/backend/tests/agents/digest/test_schema.py`

- [ ] **Step 1: Create empty marker files**

```bash
mkdir -p webapp/backend/app/agents/digest webapp/backend/tests/agents/digest
touch webapp/backend/app/agents/__init__.py
touch webapp/backend/tests/agents/__init__.py
touch webapp/backend/tests/agents/digest/__init__.py
```

- [ ] **Step 2: Write the failing schema tests**

Create `webapp/backend/tests/agents/digest/test_schema.py`:

```python
import pytest
from pydantic import ValidationError

from app.agents.digest.schema import Chapter, Digest, strip_em_dashes


def test_digest_accepts_all_five_fields():
    d = Digest(
        ask="ask",
        decisions="decisions",
        files="files",
        tests="tests",
        dead_ends="dead",
        chapters=[],
    )
    assert d.ask == "ask"
    assert d.chapters == []


def test_digest_rejects_missing_field():
    with pytest.raises(ValidationError):
        Digest(  # type: ignore[call-arg]
            ask="ask",
            decisions="decisions",
            files="files",
            tests="tests",
            chapters=[],
        )


def test_digest_caps_chapters_at_10():
    chapters = [
        Chapter(anchor_uuid=f"uuid-{i}", title=f"t{i}", caption=f"c{i}")
        for i in range(11)
    ]
    with pytest.raises(ValidationError):
        Digest(
            ask="a", decisions="d", files="f", tests="t", dead_ends="e",
            chapters=chapters,
        )


def test_digest_caps_field_lengths():
    with pytest.raises(ValidationError):
        Digest(
            ask="x" * 201, decisions="d", files="f", tests="t", dead_ends="e",
            chapters=[],
        )


def test_chapter_caps_title_and_caption():
    with pytest.raises(ValidationError):
        Chapter(anchor_uuid="u", title="x" * 81, caption="c")
    with pytest.raises(ValidationError):
        Chapter(anchor_uuid="u", title="t", caption="x" * 161)


def test_strip_em_dashes_replaces_with_comma_between_words():
    assert strip_em_dashes("a — b") == "a, b"


def test_strip_em_dashes_handles_sentence_breaks():
    assert strip_em_dashes("one — two — three") == "one, two, three"


def test_strip_em_dashes_strips_unicode_em_dash_only():
    # ASCII hyphens are left alone
    assert strip_em_dashes("file-name foo-bar") == "file-name foo-bar"
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `./env/bin/pytest webapp/backend/tests/agents/digest/test_schema.py -v`
Expected: FAIL with "No module named 'app.agents.digest.schema'"

- [ ] **Step 4: Implement the schema**

Create `webapp/backend/app/agents/digest/schema.py`:

```python
"""Output schema for the trace digest agent.

The Digest model is what the OpenAI call must return as a JSON object.
Validation failures are not retried — the pipeline records the failure
in agent_run and the upload still succeeds without a digest.
"""
from __future__ import annotations

import re

from pydantic import BaseModel, Field


_EM_DASH_RE = re.compile(r"\s*—\s*")


def strip_em_dashes(text: str) -> str:
    """Replace U+2014 em-dashes with ', ' so digests never ship with them.

    The user has a standing preference against em-dashes in vibeshub
    user-facing copy. The model occasionally emits them; we sweep on
    persist rather than relying on prompt engineering alone.
    """
    return _EM_DASH_RE.sub(", ", text)


class Chapter(BaseModel):
    anchor_uuid: str
    title: str = Field(max_length=80)
    caption: str = Field(max_length=160)


class Digest(BaseModel):
    ask: str = Field(max_length=200)
    decisions: str = Field(max_length=200)
    files: str = Field(max_length=200)
    tests: str = Field(max_length=200)
    dead_ends: str = Field(max_length=200)
    chapters: list[Chapter] = Field(default_factory=list, max_length=10)
```

Create `webapp/backend/app/agents/digest/__init__.py`:

```python
"""Trace digest agent — public API."""
from app.agents.digest.schema import Chapter, Digest

__all__ = ["Chapter", "Digest"]
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `./env/bin/pytest webapp/backend/tests/agents/digest/test_schema.py -v`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add webapp/backend/app/agents/ webapp/backend/tests/agents/
git commit -m "Add digest agent: Pydantic output schema + em-dash sweeper"
```

---

### Task 2: Distillation — tier classifier

**Files:**
- Create: `webapp/backend/app/agents/digest/distill.py`
- Create: `webapp/backend/tests/agents/digest/test_distill.py`
- Create: `webapp/backend/tests/agents/digest/fixtures/short.jsonl`

- [ ] **Step 1: Create a short synthetic fixture**

Create `webapp/backend/tests/agents/digest/fixtures/short.jsonl`. Each line is one JSON object — copy these lines verbatim, one per line:

```
{"type":"user","uuid":"u1","message":{"content":"Add a /healthcheck route"}}
{"type":"assistant","uuid":"a1","message":{"content":[{"type":"text","text":"I'll add it."}]}}
{"type":"assistant","uuid":"a2","message":{"content":[{"type":"tool_use","id":"tu1","name":"Edit","input":{"file_path":"webapp/backend/app/main.py","old_string":"OLD","new_string":"NEW WITH LOTS OF CONTENT"}}]}}
{"type":"user","uuid":"u2","message":{"content":[{"type":"tool_result","tool_use_id":"tu1","content":"ok"}]}}
{"type":"assistant","uuid":"a3","message":{"content":[{"type":"text","text":"Done."}]}}
{"type":"permission-mode","permissionMode":"acceptEdits"}
{"type":"ai-title","aiTitle":"Add healthcheck"}
{"type":"file-history-snapshot","snapshot":[]}
```

- [ ] **Step 2: Write the failing classifier tests**

Create `webapp/backend/tests/agents/digest/test_distill.py`:

```python
from pathlib import Path

from app.agents.digest.distill import distill

FIXTURES = Path(__file__).parent / "fixtures"


def _read(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def test_user_prompts_are_verbatim():
    out = distill(_read("short.jsonl"), subagent_blobs={})
    assert "Add a /healthcheck route" in out


def test_assistant_text_is_verbatim():
    out = distill(_read("short.jsonl"), subagent_blobs={})
    assert "I'll add it." in out
    assert "Done." in out


def test_tool_use_collapses_to_one_liner():
    out = distill(_read("short.jsonl"), subagent_blobs={})
    assert "Edit webapp/backend/app/main.py" in out
    # The verbose new_string content must NOT appear
    assert "NEW WITH LOTS OF CONTENT" not in out
    assert "OLD" not in out


def test_tool_result_collapses_to_status_plus_prefix():
    out = distill(_read("short.jsonl"), subagent_blobs={})
    # Result body kept (short here, fits under 80 chars)
    assert "ok" in out


def test_tier4_events_are_dropped():
    out = distill(_read("short.jsonl"), subagent_blobs={})
    assert "permission-mode" not in out
    assert "acceptEdits" not in out
    assert "ai-title" not in out
    assert "Add healthcheck" not in out  # the ai-title text itself
    assert "file-history-snapshot" not in out


def test_each_line_carries_source_uuid():
    out = distill(_read("short.jsonl"), subagent_blobs={})
    # User prompt line carries its uuid; LLM uses these as anchor candidates
    assert "[u1]" in out
    assert "[a1]" in out
    assert "[a3]" in out
    # Dropped events do NOT appear as anchor candidates
    assert "[ai-title]" not in out


def test_emits_event_uuids_helper():
    from app.agents.digest.distill import distill_with_uuids
    text, uuids = distill_with_uuids(_read("short.jsonl"), subagent_blobs={})
    assert "u1" in uuids
    assert "a1" in uuids
    assert "a3" in uuids
    # The Edit tool_use is collapsed but its uuid is still anchorable
    assert "a2" in uuids


def test_determinism_same_input_same_output():
    a = distill(_read("short.jsonl"), subagent_blobs={})
    b = distill(_read("short.jsonl"), subagent_blobs={})
    assert a == b
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `./env/bin/pytest webapp/backend/tests/agents/digest/test_distill.py -v`
Expected: FAIL with "No module named 'app.agents.digest.distill'"

- [ ] **Step 4: Implement the classifier**

Create `webapp/backend/app/agents/digest/distill.py`:

```python
"""Distill a Claude Code JSONL trace into a compact text form for the LLM.

The four-tier classification is documented in
docs/superpowers/specs/2026-06-06-trace-digest-agent-design.md §5.

This module is pure: no I/O, no env-var reads. It operates on bytes in,
returns str out. Easy to unit-test against fixture jsonls.
"""
from __future__ import annotations

import json
from typing import Any

_DROPPED_TYPES = {
    "permission-mode",
    "file-history-snapshot",
    "attachment",
    "last-prompt",
    "ai-title",
}

# Tools whose presence we record but whose inputs are scratchpad noise.
_SCRATCH_TOOLS = {"TodoWrite"}

_TOOL_RESULT_PREFIX = 80
_TOOL_RESULT_ERROR_PREFIX = 400
_BASH_COMMAND_MAX = 120


def distill(blob: bytes, *, subagent_blobs: dict[str, bytes]) -> str:
    """Return a compact text form of `blob` ready for the LLM call."""
    text, _ = distill_with_uuids(blob, subagent_blobs=subagent_blobs)
    return text


def distill_with_uuids(
    blob: bytes, *, subagent_blobs: dict[str, bytes],
) -> tuple[str, set[str]]:
    """Like `distill`, but also returns the set of event UUIDs that appear
    in the output. Callers use this to validate chapter anchor_uuids
    against the actual anchorable surface.
    """
    lines: list[str] = []
    uuids: set[str] = set()
    prev: str | None = None
    for raw in blob.splitlines():
        if not raw.strip():
            continue
        try:
            ev = json.loads(raw)
        except json.JSONDecodeError:
            continue
        rendered = _render(ev, subagent_blobs)
        if rendered is None:
            continue
        if rendered == prev:
            continue  # adjacent duplicate
        prev = rendered
        uuid = ev.get("uuid")
        if uuid:
            uuids.add(uuid)
        lines.append(rendered)
    return "\n".join(lines), uuids


def _render(ev: dict, subagent_blobs: dict[str, bytes]) -> str | None:
    et = ev.get("type")
    if et in _DROPPED_TYPES:
        return None
    uuid = ev.get("uuid", "")
    prefix = f"[{uuid}] " if uuid else ""
    if et == "user":
        text = _user_text(ev)
        if text is None:
            return None
        return f"{prefix}USER: {text}"
    if et == "assistant":
        return _render_assistant(ev, subagent_blobs, prefix)
    return None


def _user_text(ev: dict) -> str | None:
    msg = ev.get("message") or {}
    content = msg.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                parts.append(str(block.get("text") or ""))
            elif block.get("type") == "tool_result":
                parts.append(_tool_result_to_line(block))
        joined = " | ".join(p for p in parts if p)
        return joined or None
    return None


def _render_assistant(
    ev: dict, subagent_blobs: dict[str, bytes], prefix: str,
) -> str | None:
    msg = ev.get("message") or {}
    content = msg.get("content") or []
    if not isinstance(content, list):
        return None
    parts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        btype = block.get("type")
        if btype == "text":
            text = (block.get("text") or "").strip()
            if text:
                parts.append(f"ASSISTANT: {text}")
        elif btype == "tool_use":
            line = _tool_use_to_line(block, subagent_blobs)
            if line is not None:
                parts.append(line)
        # Thinking blocks are intentionally dropped
    if not parts:
        return None
    return prefix + " ".join(parts)


def _tool_use_to_line(
    block: dict, subagent_blobs: dict[str, bytes],
) -> str | None:
    name = block.get("name") or ""
    inp = block.get("input") or {}
    if name in _SCRATCH_TOOLS:
        return None
    if name == "Task":
        agent_id = (inp.get("subagent_type") or "agent")
        desc = (inp.get("description") or "").strip()
        sub_summary = _summarize_subagent(block, subagent_blobs)
        return f"Subagent[{agent_id}]: {desc} → {sub_summary}".rstrip(" →")
    if name == "Bash":
        cmd = (inp.get("command") or "").strip()
        if len(cmd) > _BASH_COMMAND_MAX:
            cmd = cmd[:_BASH_COMMAND_MAX] + "…"
        return f"Bash: {cmd}"
    fp = inp.get("file_path")
    if isinstance(fp, str) and fp:
        return f"{name} {fp}"
    # Grep/Glob carry pattern + path; other tools fall through to a label.
    pattern = inp.get("pattern") or inp.get("query")
    path = inp.get("path") or ""
    if pattern:
        return f'{name} "{pattern}"' + (f" in {path}" if path else "")
    return name


def _tool_result_to_line(block: dict) -> str:
    content = block.get("content")
    is_error = bool(block.get("is_error"))
    if isinstance(content, list):
        text_parts = [
            str(b.get("text") or "") for b in content if isinstance(b, dict)
        ]
        body = " ".join(text_parts).strip()
    else:
        body = str(content or "").strip()
    limit = _TOOL_RESULT_ERROR_PREFIX if is_error else _TOOL_RESULT_PREFIX
    body = body.replace("\n", " ")
    if len(body) > limit:
        body = body[:limit] + "…"
    status = "ERR" if is_error else "OK"
    return f"RESULT[{status}]: {body}" if body else f"RESULT[{status}]"


def _summarize_subagent(
    block: dict, subagent_blobs: dict[str, bytes],
) -> str:
    """Heuristic one-line summary of a subagent's outcome.

    Implementation is filled in by Task 3 (subagent collapse). For now this
    returns an empty marker so the tier classifier compiles independently.
    """
    return ""
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `./env/bin/pytest webapp/backend/tests/agents/digest/test_distill.py -v`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add webapp/backend/app/agents/digest/distill.py webapp/backend/tests/agents/digest/test_distill.py webapp/backend/tests/agents/digest/fixtures/
git commit -m "Add digest distiller: tier classifier + UUID surface"
```

---

### Task 3: Subagent collapse

**Files:**
- Modify: `webapp/backend/app/agents/digest/distill.py` (`_summarize_subagent`)
- Modify: `webapp/backend/tests/agents/digest/test_distill.py`
- Create: `webapp/backend/tests/agents/digest/fixtures/with_subagent.jsonl`
- Create: `webapp/backend/tests/agents/digest/fixtures/with_subagent_child.jsonl`

- [ ] **Step 1: Create the subagent fixture pair**

Create `webapp/backend/tests/agents/digest/fixtures/with_subagent.jsonl` (parent stream). Each line is one JSON object:

```
{"type":"user","uuid":"u1","message":{"content":"Audit the auth code"}}
{"type":"assistant","uuid":"a1","message":{"content":[{"type":"tool_use","id":"tu1","name":"Task","input":{"subagent_type":"code-reviewer","description":"Audit auth"}}]}}
{"type":"user","uuid":"u2","message":{"content":[{"type":"tool_result","tool_use_id":"tu1","content":"Found 2 issues"}]}}
{"type":"assistant","uuid":"a2","message":{"content":[{"type":"text","text":"Patching both."}]}}
```

Create `webapp/backend/tests/agents/digest/fixtures/with_subagent_child.jsonl` (child agent stream). Each line is one JSON object:

```
{"type":"assistant","uuid":"c1","message":{"content":[{"type":"tool_use","id":"ct1","name":"Read","input":{"file_path":"webapp/backend/app/auth/oauth.py"}}]}}
{"type":"user","uuid":"c2","message":{"content":[{"type":"tool_result","tool_use_id":"ct1","content":"..."}]}}
{"type":"assistant","uuid":"c3","message":{"content":[{"type":"text","text":"Two issues: scope leak on /authorize, no CSRF on /callback."}]}}
```

- [ ] **Step 2: Add the failing subagent tests**

Append to `webapp/backend/tests/agents/digest/test_distill.py`:

```python
def test_subagent_collapses_to_one_line():
    parent = _read("with_subagent.jsonl")
    child = _read("with_subagent_child.jsonl")
    # The plugin's storage names subagent blobs by tool_use_id (see
    # trace_service.create_or_update_trace). The distiller takes the
    # same dict shape.
    out = distill(parent, subagent_blobs={"tu1": child})
    # One subagent line, not the child's three events
    matches = [ln for ln in out.splitlines() if ln.startswith("[a1]")]
    assert len(matches) == 1
    line = matches[0]
    assert "Subagent[code-reviewer]" in line
    assert "Audit auth" in line
    # The child's final assistant text is the summary
    assert "Two issues" in line
    # The child's interior is NEVER inlined
    assert "webapp/backend/app/auth/oauth.py" not in out


def test_subagent_missing_blob_falls_back_to_action_count():
    parent = _read("with_subagent.jsonl")
    out = distill(parent, subagent_blobs={})  # no child blob given
    line = next(ln for ln in out.splitlines() if ln.startswith("[a1]"))
    # Falls back to a non-empty descriptor so the LLM has SOMETHING to read
    assert "Subagent[code-reviewer]" in line
    assert "Audit auth" in line
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `./env/bin/pytest webapp/backend/tests/agents/digest/test_distill.py::test_subagent_collapses_to_one_line webapp/backend/tests/agents/digest/test_distill.py::test_subagent_missing_blob_falls_back_to_action_count -v`
Expected: FAIL (assertions on "Two issues" and the action-count fallback)

- [ ] **Step 4: Replace `_summarize_subagent` with the real implementation**

In `webapp/backend/app/agents/digest/distill.py`, replace the placeholder `_summarize_subagent` with:

```python
def _summarize_subagent(
    block: dict, subagent_blobs: dict[str, bytes],
) -> str:
    """Heuristic one-line outcome for a subagent dispatch.

    Strategy:
    1. If we have the child's blob, take the LAST assistant_text and use
       the first sentence (~120 chars).
    2. Otherwise, fall back to "(N tool calls)" so the LLM at least sees
       that something happened.
    """
    tool_use_id = block.get("id") or ""
    child = subagent_blobs.get(tool_use_id)
    if child is None:
        return ""
    last_text: str | None = None
    tool_call_count = 0
    for raw in child.splitlines():
        if not raw.strip():
            continue
        try:
            ev = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if ev.get("type") != "assistant":
            continue
        msg = ev.get("message") or {}
        content = msg.get("content") or []
        if not isinstance(content, list):
            continue
        for sub_block in content:
            if not isinstance(sub_block, dict):
                continue
            btype = sub_block.get("type")
            if btype == "text":
                t = (sub_block.get("text") or "").strip()
                if t:
                    last_text = t
            elif btype == "tool_use":
                tool_call_count += 1
    if last_text:
        # First sentence, capped at 120 chars
        sentence = last_text.split(". ")[0].strip()
        if len(sentence) > 120:
            sentence = sentence[:120] + "…"
        return sentence
    if tool_call_count:
        return f"({tool_call_count} tool calls)"
    return ""
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `./env/bin/pytest webapp/backend/tests/agents/digest/test_distill.py -v`
Expected: PASS (10 tests total)

- [ ] **Step 6: Commit**

```bash
git add webapp/backend/app/agents/digest/distill.py webapp/backend/tests/agents/digest/
git commit -m "Add digest distiller: subagent collapse to one-line summary"
```

---

### Task 4: Adaptive pass — exploration-run collapse + hard cap

**Files:**
- Modify: `webapp/backend/app/agents/digest/distill.py`
- Modify: `webapp/backend/tests/agents/digest/test_distill.py`

- [ ] **Step 1: Write the failing adaptive-pass tests**

Append to `webapp/backend/tests/agents/digest/test_distill.py`:

```python
def _synth_exploration_blob(reads: int, greps: int) -> bytes:
    """Synthesize a JSONL with N reads + M greps, no intervening text."""
    import json as _json
    lines: list[str] = []
    lines.append(_json.dumps({
        "type": "user", "uuid": "uStart",
        "message": {"content": "Find the auth handler"},
    }))
    for i in range(reads):
        lines.append(_json.dumps({
            "type": "assistant", "uuid": f"r{i}",
            "message": {"content": [{
                "type": "tool_use", "id": f"tr{i}", "name": "Read",
                "input": {"file_path": f"webapp/backend/app/file_{i}.py"},
            }]},
        }))
    for i in range(greps):
        lines.append(_json.dumps({
            "type": "assistant", "uuid": f"g{i}",
            "message": {"content": [{
                "type": "tool_use", "id": f"tg{i}", "name": "Grep",
                "input": {"pattern": "handler", "path": "webapp/backend"},
            }]},
        }))
    lines.append(_json.dumps({
        "type": "assistant", "uuid": "aEnd",
        "message": {"content": [{
            "type": "text", "text": "Found it in oauth.py.",
        }]},
    }))
    return ("\n".join(lines) + "\n").encode("utf-8")


def test_short_exploration_run_not_collapsed():
    # 5 reads is BELOW the threshold of 6
    blob = _synth_exploration_blob(reads=5, greps=0)
    out = distill(blob, subagent_blobs={})
    # All 5 reads still appear individually
    assert out.count("Read webapp/backend/app/file_") == 5
    assert "[exploration:" not in out


def test_long_exploration_run_is_collapsed():
    # 12 reads + 3 greps = 15 consecutive tool calls
    blob = _synth_exploration_blob(reads=12, greps=3)
    out = distill(blob, subagent_blobs={}, target_tokens=200)
    # The individual Reads are gone, replaced with one collapse line
    assert out.count("Read webapp/backend/app/file_") == 0
    assert "[exploration:" in out
    # Spine survives
    assert "Find the auth handler" in out
    assert "Found it in oauth.py." in out


def test_distill_carries_target_and_hardcap_kwargs():
    # Smoke test that the signature accepts the new kwargs
    blob = _synth_exploration_blob(reads=1, greps=0)
    out = distill(
        blob, subagent_blobs={}, target_tokens=60_000, hard_cap_tokens=200_000,
    )
    assert isinstance(out, str)


def test_truncation_when_over_hardcap_keeps_head_and_tail():
    blob = _synth_exploration_blob(reads=200, greps=0)
    # Force the hard cap to trip by setting an absurdly small cap; the
    # adaptive collapse won't help because every event collapses to one line
    # already after the exploration pass. We bypass collapse by setting the
    # target VERY low and the hard cap also low.
    out = distill(
        blob, subagent_blobs={}, target_tokens=10, hard_cap_tokens=20,
    )
    assert "[… elided" in out
    # First and last events still present
    assert "Find the auth handler" in out
    assert "Found it in oauth.py." in out
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./env/bin/pytest webapp/backend/tests/agents/digest/test_distill.py -v -k "exploration or truncation or carries"`
Expected: FAIL (kwargs not yet on distill, no `[exploration:` or `[… elided` strings)

- [ ] **Step 3: Add the adaptive pass to `distill.py`**

In `webapp/backend/app/agents/digest/distill.py`:

1. Add constants near the top of the file (under the existing constants):

```python
_DEFAULT_TARGET_TOKENS = 60_000
_DEFAULT_HARDCAP_TOKENS = 200_000
_EXPLORATION_RUN_MIN = 6
_TOKENS_PER_CHAR = 0.25  # rough estimate; good enough for budget gating
```

2. Replace the `distill` and `distill_with_uuids` signatures and bodies:

```python
def distill(
    blob: bytes, *, subagent_blobs: dict[str, bytes],
    target_tokens: int = _DEFAULT_TARGET_TOKENS,
    hard_cap_tokens: int = _DEFAULT_HARDCAP_TOKENS,
) -> str:
    text, _ = distill_with_uuids(
        blob, subagent_blobs=subagent_blobs,
        target_tokens=target_tokens, hard_cap_tokens=hard_cap_tokens,
    )
    return text


def distill_with_uuids(
    blob: bytes, *, subagent_blobs: dict[str, bytes],
    target_tokens: int = _DEFAULT_TARGET_TOKENS,
    hard_cap_tokens: int = _DEFAULT_HARDCAP_TOKENS,
) -> tuple[str, set[str]]:
    lines, uuids = _classify(blob, subagent_blobs)
    if _est_tokens(lines) > target_tokens:
        lines = _collapse_exploration_runs(lines)
    if _est_tokens(lines) > hard_cap_tokens:
        lines = _truncate_middle(lines, hard_cap_tokens)
    return "\n".join(lines), uuids
```

3. Extract the classifier loop into a helper `_classify(blob, subagent_blobs) -> tuple[list[str], set[str]]`. Replace the current `distill_with_uuids` body with a call to it. The body is just the loop you already have — move it.

4. Add the new helpers at the bottom of the file:

```python
def _est_tokens(lines: list[str]) -> float:
    return sum(len(ln) for ln in lines) * _TOKENS_PER_CHAR


def _is_tool_line(line: str) -> bool:
    """A 'tool action' line — a [uuid]-prefixed line whose payload is a
    bare tool call (no ASSISTANT: text, no USER: text)."""
    if not line.startswith("["):
        return False
    after = line.split("] ", 1)
    if len(after) != 2:
        return False
    body = after[1]
    if body.startswith("ASSISTANT:") or body.startswith("USER:"):
        return False
    return True


def _collapse_exploration_runs(lines: list[str]) -> list[str]:
    """Replace runs of >= _EXPLORATION_RUN_MIN consecutive tool-action
    lines with a single '[exploration: N tools]' summary.

    Counts the tools that get collapsed for a more useful summary."""
    out: list[str] = []
    i = 0
    n = len(lines)
    while i < n:
        if _is_tool_line(lines[i]):
            j = i
            while j < n and _is_tool_line(lines[j]):
                j += 1
            run = lines[i:j]
            if len(run) >= _EXPLORATION_RUN_MIN:
                out.append(_summarize_run(run))
            else:
                out.extend(run)
            i = j
        else:
            out.append(lines[i])
            i += 1
    return out


def _summarize_run(run: list[str]) -> str:
    """One-line summary of a collapsed exploration run."""
    from collections import Counter
    counter: Counter[str] = Counter()
    for line in run:
        body = line.split("] ", 1)[1] if "] " in line else line
        tool = body.split(" ", 1)[0].rstrip(":")
        counter[tool] += 1
    parts = ", ".join(f"{n} {t.lower()}{'s' if n != 1 else ''}"
                      for t, n in counter.most_common())
    return f"[exploration: {parts}]"


def _truncate_middle(lines: list[str], hard_cap_tokens: int) -> list[str]:
    """Head/tail truncation. Keep first 30%, last 30%, elide the middle."""
    if not lines:
        return lines
    target_chars = int(hard_cap_tokens / _TOKENS_PER_CHAR)
    head_budget = int(target_chars * 0.5)  # 50/50 split of remaining budget
    head: list[str] = []
    head_chars = 0
    for line in lines:
        head_chars += len(line) + 1
        if head_chars > head_budget:
            break
        head.append(line)
    tail: list[str] = []
    tail_chars = 0
    for line in reversed(lines[len(head):]):
        tail_chars += len(line) + 1
        if tail_chars > head_budget:
            break
        tail.append(line)
    tail.reverse()
    elided = len(lines) - len(head) - len(tail)
    marker = f"[… elided {elided} events …]"
    return head + [marker] + tail
```

5. Refactor the original body of `distill_with_uuids` into a private `_classify` helper that returns `(lines, uuids)` — same body, just renamed and called from the new `distill_with_uuids`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./env/bin/pytest webapp/backend/tests/agents/digest/test_distill.py -v`
Expected: PASS (14 tests total)

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/agents/digest/distill.py webapp/backend/tests/agents/digest/test_distill.py
git commit -m "Add digest distiller: adaptive exploration collapse + hardcap truncation"
```

---

## Phase B — Backend persistence

### Task 5: Trace columns + AgentRun model + Alembic migration

**Files:**
- Modify: `webapp/backend/app/storage/models.py`
- Create: `webapp/backend/alembic/versions/e1f8a2b9c073_add_digest_columns_and_agent_run.py`

- [ ] **Step 1: Add the model definitions**

In `webapp/backend/app/storage/models.py`:

1. Add imports if not already present (check the top of the file):

```python
from sqlalchemy import JSON
```

2. Add two columns to the `Trace` class, after the existing `agent_count` line:

```python
    # Trace digest agent output. NULL when the upload predates the digest
    # feature, env vars are unset, or the LLM call failed. See
    # docs/superpowers/specs/2026-06-06-trace-digest-agent-design.md §7.
    digest_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    digest_input_hash: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True
    )
```

3. Add the new `AgentRun` model at the end of the file (after `UserSession`):

```python
class AgentRun(Base):
    __tablename__ = "agent_run"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    agent_name: Mapped[str] = mapped_column(String(64), index=True)
    # Nullable for non-trace agents (future). Indexed for per-trace history.
    trace_id: Mapped[Optional[str]] = mapped_column(
        String(32), index=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    model: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    outcome: Mapped[str] = mapped_column(String(32), index=True)
    error_detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    extra: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
```

- [ ] **Step 2: Write the migration**

Create `webapp/backend/alembic/versions/e1f8a2b9c073_add_digest_columns_and_agent_run.py`:

```python
"""add digest columns to traces and agent_run table

Revision ID: e1f8a2b9c073
Revises: d2e4f6a8c0b1
Create Date: 2026-06-06 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e1f8a2b9c073"
down_revision: Union[str, Sequence[str], None] = "d2e4f6a8c0b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add digest_json + digest_input_hash on traces and create agent_run."""
    op.add_column(
        "traces",
        sa.Column("digest_json", sa.JSON(), nullable=True),
    )
    op.add_column(
        "traces",
        sa.Column("digest_input_hash", sa.String(length=64), nullable=True),
    )
    op.create_table(
        "agent_run",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("agent_name", sa.String(length=64), nullable=False),
        sa.Column("trace_id", sa.String(length=32), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column("model", sa.String(length=128), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("outcome", sa.String(length=32), nullable=False),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("extra", sa.JSON(), nullable=True),
    )
    op.create_index(
        "ix_agent_run_agent_name", "agent_run", ["agent_name"]
    )
    op.create_index(
        "ix_agent_run_trace_id", "agent_run", ["trace_id"]
    )
    op.create_index(
        "ix_agent_run_created_at", "agent_run", ["created_at"]
    )
    op.create_index(
        "ix_agent_run_outcome", "agent_run", ["outcome"]
    )


def downgrade() -> None:
    """Drop digest columns and agent_run."""
    op.drop_index("ix_agent_run_outcome", table_name="agent_run")
    op.drop_index("ix_agent_run_created_at", table_name="agent_run")
    op.drop_index("ix_agent_run_trace_id", table_name="agent_run")
    op.drop_index("ix_agent_run_agent_name", table_name="agent_run")
    op.drop_table("agent_run")
    op.drop_column("traces", "digest_input_hash")
    op.drop_column("traces", "digest_json")
```

- [ ] **Step 3: Verify migration applies cleanly (SQLite in-memory)**

Run:

```bash
./env/bin/python -c "
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from app.storage.models import Base
async def main():
    eng = create_async_engine('sqlite+aiosqlite:///:memory:')
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print('schema created OK')
asyncio.run(main())
" 2>&1 | tail -5
```

(This validates the new ORM definitions compile and create_all succeeds. The Alembic migration itself runs in test DB setup.)
Expected: `schema created OK`

- [ ] **Step 4: Run the existing backend test suite to ensure nothing broke**

Run: `./env/bin/pytest webapp/backend/tests/ -x --ignore=webapp/backend/tests/test_e2e.py -q 2>&1 | tail -15`
Expected: PASS (no regressions). If a test that touches `Trace` columns fails because of the new columns, fix it inline.

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/storage/models.py webapp/backend/alembic/versions/e1f8a2b9c073_add_digest_columns_and_agent_run.py
git commit -m "Add digest columns on traces and agent_run table + migration"
```

---

### Task 6: record_run helper

**Files:**
- Create: `webapp/backend/app/agents/_usage.py`
- Create: `webapp/backend/tests/agents/test_usage.py`

- [ ] **Step 1: Write the failing record_run tests**

Create `webapp/backend/tests/agents/test_usage.py`:

```python
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents._usage import Outcome, record_run
from app.storage.models import AgentRun


@pytest.mark.asyncio
async def test_record_run_persists_a_row(db_session: AsyncSession):
    await record_run(
        db_session,
        agent_name="digest",
        trace_id="abc123",
        model="gpt-5.5",
        input_tokens=1234,
        output_tokens=567,
        latency_ms=2100,
        outcome=Outcome.OK,
        extra={"chapters_kept": 4, "chapters_total": 4},
    )
    await db_session.commit()
    rows = (await db_session.execute(select(AgentRun))).scalars().all()
    assert len(rows) == 1
    r = rows[0]
    assert r.agent_name == "digest"
    assert r.trace_id == "abc123"
    assert r.outcome == "ok"
    assert r.input_tokens == 1234
    assert r.extra == {"chapters_kept": 4, "chapters_total": 4}


@pytest.mark.asyncio
async def test_record_run_swallows_db_errors(monkeypatch, db_session):
    # Force the session.add to throw — the helper must swallow the error
    # so a broken metrics table never breaks the upload path.
    class _Boom(Exception):
        pass
    def _raise(*_a, **_kw):
        raise _Boom("db is sad")
    monkeypatch.setattr(db_session, "add", _raise)
    # Should not raise — just logs and returns
    await record_run(
        db_session,
        agent_name="digest",
        trace_id=None,
        model="gpt-5.5",
        input_tokens=0,
        output_tokens=0,
        latency_ms=0,
        outcome=Outcome.SKIP_NO_CONFIG,
    )


def test_outcome_values_match_spec():
    assert Outcome.OK.value == "ok"
    assert Outcome.SKIP_UNCHANGED.value == "skip_unchanged"
    assert Outcome.SKIP_NO_CONFIG.value == "skip_no_config"
    assert Outcome.FAIL_CALL.value == "fail_call"
    assert Outcome.FAIL_SCHEMA.value == "fail_schema"
    assert Outcome.FAIL_ANCHORS.value == "fail_anchors"
```

You will also need a `db_session` fixture if one doesn't already exist. Check `webapp/backend/tests/conftest.py` first. If missing, add to `conftest.py`:

```python
@pytest.fixture
async def db_session(_settings_env):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from app.storage.models import Base
    eng = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    SessionLocal = async_sessionmaker(eng, expire_on_commit=False)
    async with SessionLocal() as session:
        yield session
    await eng.dispose()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./env/bin/pytest webapp/backend/tests/agents/test_usage.py -v`
Expected: FAIL with "No module named 'app.agents._usage'"

- [ ] **Step 3: Implement record_run**

Create `webapp/backend/app/agents/_usage.py`:

```python
"""Shared usage / observability helper for the agents subsystem.

Every agent (current: digest; future: search rerank, etc.) records each
run here. The write is fire-and-forget: if the DB rejects the row we
log and move on so a broken metrics table never breaks the upload path.

The structured log line is intentionally redundant with the DB row — the
DB is the durable surface for analytical queries; the log is the running
tape for live debugging.
"""
from __future__ import annotations

import enum
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.storage.models import AgentRun

log = logging.getLogger("vibeshub.agents")


class Outcome(str, enum.Enum):
    OK = "ok"
    SKIP_UNCHANGED = "skip_unchanged"
    SKIP_NO_CONFIG = "skip_no_config"
    FAIL_CALL = "fail_call"
    FAIL_SCHEMA = "fail_schema"
    FAIL_ANCHORS = "fail_anchors"


async def record_run(
    session: AsyncSession,
    *,
    agent_name: str,
    trace_id: str | None,
    model: str | None,
    input_tokens: int,
    output_tokens: int,
    latency_ms: int,
    outcome: Outcome,
    error_detail: str | None = None,
    extra: dict | None = None,
) -> None:
    """Insert one row into agent_run. Never raises."""
    log.info(
        "agent_run agent=%s trace=%s model=%s in=%d out=%d ms=%d outcome=%s",
        agent_name, trace_id, model,
        input_tokens, output_tokens, latency_ms, outcome.value,
    )
    try:
        row = AgentRun(
            agent_name=agent_name,
            trace_id=trace_id,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            latency_ms=latency_ms,
            outcome=outcome.value,
            error_detail=error_detail,
            extra=extra,
        )
        session.add(row)
    except Exception as exc:  # noqa: BLE001
        log.warning("record_run failed to persist: %s", exc)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./env/bin/pytest webapp/backend/tests/agents/test_usage.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/agents/_usage.py webapp/backend/tests/agents/test_usage.py webapp/backend/tests/conftest.py
git commit -m "Add agents._usage: record_run + Outcome enum"
```

---

## Phase C — Backend pipeline

### Task 7: OpenAI client wiring

**Files:**
- Create: `webapp/backend/app/agents/_client.py`
- Create: `webapp/backend/tests/agents/test_client.py`

- [ ] **Step 1: Write the failing client tests**

Create `webapp/backend/tests/agents/test_client.py`:

```python
import pytest


@pytest.fixture(autouse=True)
def _clear_module(monkeypatch):
    """Ensure get_client reads the current env on each call."""
    yield


def test_get_client_returns_none_when_env_unset(monkeypatch):
    monkeypatch.delenv("VIBESHUB_OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("VIBESHUB_OPENAI_ENDPOINT", raising=False)
    monkeypatch.delenv("VIBESHUB_OPENAI_MODEL", raising=False)
    from app.agents._client import get_client
    assert get_client() is None


def test_get_client_returns_none_when_only_partially_set(monkeypatch):
    monkeypatch.setenv("VIBESHUB_OPENAI_API_KEY", "sk-x")
    monkeypatch.delenv("VIBESHUB_OPENAI_ENDPOINT", raising=False)
    monkeypatch.delenv("VIBESHUB_OPENAI_MODEL", raising=False)
    from app.agents._client import get_client
    assert get_client() is None


def test_get_client_constructs_openai_when_all_set(monkeypatch):
    monkeypatch.setenv("VIBESHUB_OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("VIBESHUB_OPENAI_ENDPOINT", "https://example/v1")
    monkeypatch.setenv("VIBESHUB_OPENAI_MODEL", "gpt-5.5-deploy")
    from app.agents._client import get_client, get_model
    client = get_client()
    assert client is not None
    # OpenAI client exposes .responses; we don't actually call out
    assert hasattr(client, "responses")
    assert get_model() == "gpt-5.5-deploy"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./env/bin/pytest webapp/backend/tests/agents/test_client.py -v`
Expected: FAIL with "No module named 'app.agents._client'"

- [ ] **Step 3: Implement the client wiring**

Create `webapp/backend/app/agents/_client.py`:

```python
"""Shared OpenAI client for the agents subsystem.

Mirrors the pattern in polybot/storybot/twitter_pipeline.py:1928 — a
single OpenAI Python SDK client pointed at the configured endpoint.
The endpoint is Azure-shaped today (responses.create with json_object).

`get_client()` reads env vars at call time (not import time) so that
test fixtures can patch them with monkeypatch.setenv. Returns None when
any of the three env vars are unset; callers must check.
"""
from __future__ import annotations

import os

from openai import OpenAI


_ENV_API_KEY = "VIBESHUB_OPENAI_API_KEY"
_ENV_ENDPOINT = "VIBESHUB_OPENAI_ENDPOINT"
_ENV_MODEL = "VIBESHUB_OPENAI_MODEL"


def get_client() -> OpenAI | None:
    api_key = os.environ.get(_ENV_API_KEY, "")
    endpoint = os.environ.get(_ENV_ENDPOINT, "")
    model = os.environ.get(_ENV_MODEL, "")
    if not (api_key and endpoint and model):
        return None
    return OpenAI(base_url=endpoint, api_key=api_key)


def get_model() -> str:
    return os.environ.get(_ENV_MODEL, "")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./env/bin/pytest webapp/backend/tests/agents/test_client.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/agents/_client.py webapp/backend/tests/agents/test_client.py
git commit -m "Add agents._client: OpenAI client + env-var loader"
```

---

### Task 8: Digest pipeline (orchestration with mocked LLM)

**Files:**
- Create: `webapp/backend/app/agents/digest/prompt.py`
- Create: `webapp/backend/app/agents/digest/pipeline.py`
- Modify: `webapp/backend/app/agents/digest/__init__.py`
- Create: `webapp/backend/tests/agents/digest/test_pipeline.py`

- [ ] **Step 1: Write the failing pipeline tests**

Create `webapp/backend/tests/agents/digest/test_pipeline.py`:

```python
import json
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select

from app.agents._usage import Outcome
from app.agents.digest.pipeline import compute_digest
from app.agents.digest.schema import Digest
from app.storage.models import AgentRun, Trace


def _ok_response(payload: dict):
    """Mock the shape of an OpenAI responses.create result."""
    resp = MagicMock()
    resp.output_text = json.dumps(payload)
    resp.usage = MagicMock(input_tokens=42, output_tokens=10)
    return resp


VALID_PAYLOAD = {
    "ask": "Add a /healthcheck route",
    "decisions": "Inline in app/main.py; no separate router",
    "files": "webapp/backend/app/main.py",
    "tests": "test_health.py adds /healthcheck assertion",
    "dead_ends": "Briefly considered a new router; rejected as YAGNI",
    "chapters": [
        {"anchor_uuid": "u1", "title": "Frame the change",
         "caption": "User asks for /healthcheck."},
        {"anchor_uuid": "bogus", "title": "Drop me",
         "caption": "Anchor not in trace."},
    ],
}


@pytest.fixture
def _trace_blob():
    # Reuse the short fixture from the distill tests
    from pathlib import Path
    return (
        Path(__file__).parent / "fixtures" / "short.jsonl"
    ).read_bytes()


@pytest.fixture
async def _seeded_trace(db_session):
    trace = Trace(
        short_id="abc12345",
        owner_login="alice",
        repo_full_name="alice/x",
        pr_number=1, pr_url=None, pr_title=None,
        platform="claude-code", session_id="s1",
        byte_size=100, message_count=5,
        redaction_count_client=0, redaction_count_server=0,
        is_private=False,
        blob_path=None, blob_prefix="traces/abc12345/",
        agents=[], agent_count=0,
    )
    db_session.add(trace)
    await db_session.flush()
    return trace


@pytest.mark.asyncio
async def test_happy_path_persists_digest_and_records_run(
    monkeypatch, db_session, _trace_blob, _seeded_trace,
):
    monkeypatch.setenv("VIBESHUB_OPENAI_API_KEY", "sk-x")
    monkeypatch.setenv("VIBESHUB_OPENAI_ENDPOINT", "https://e")
    monkeypatch.setenv("VIBESHUB_OPENAI_MODEL", "gpt-5.5")
    mock_client = MagicMock()
    mock_client.responses.create.return_value = _ok_response(VALID_PAYLOAD)
    monkeypatch.setattr(
        "app.agents.digest.pipeline.get_client", lambda: mock_client,
    )

    digest = await compute_digest(
        db_session, _seeded_trace,
        blob=_trace_blob, subagent_blobs={},
    )

    assert isinstance(digest, Digest)
    assert digest.ask == "Add a /healthcheck route"
    # The bogus chapter was filtered out; only the valid one survives
    assert [c.anchor_uuid for c in digest.chapters] == ["u1"]

    # Trace row updated
    assert _seeded_trace.digest_json is not None
    assert _seeded_trace.digest_json["ask"] == "Add a /healthcheck route"
    assert _seeded_trace.digest_input_hash is not None
    assert len(_seeded_trace.digest_input_hash) == 64  # sha256 hex

    # AgentRun row written
    rows = (await db_session.execute(
        select(AgentRun).where(AgentRun.agent_name == "digest"),
    )).scalars().all()
    assert len(rows) == 1
    r = rows[0]
    assert r.outcome == Outcome.OK.value
    assert r.input_tokens == 42
    assert r.output_tokens == 10
    assert r.extra == {"chapters_kept": 1, "chapters_total": 2,
                       "distill_truncated": False}


@pytest.mark.asyncio
async def test_call_uses_json_object_format(
    monkeypatch, db_session, _trace_blob, _seeded_trace,
):
    monkeypatch.setenv("VIBESHUB_OPENAI_API_KEY", "sk-x")
    monkeypatch.setenv("VIBESHUB_OPENAI_ENDPOINT", "https://e")
    monkeypatch.setenv("VIBESHUB_OPENAI_MODEL", "gpt-5.5")
    mock_client = MagicMock()
    mock_client.responses.create.return_value = _ok_response(VALID_PAYLOAD)
    monkeypatch.setattr(
        "app.agents.digest.pipeline.get_client", lambda: mock_client,
    )
    await compute_digest(
        db_session, _seeded_trace,
        blob=_trace_blob, subagent_blobs={},
    )
    kwargs = mock_client.responses.create.call_args.kwargs
    assert kwargs["text"] == {"format": {"type": "json_object"}}
    assert kwargs["model"] == "gpt-5.5"
    assert "instructions" in kwargs
    assert "input" in kwargs


@pytest.mark.asyncio
async def test_no_config_skips_call_and_returns_none(
    monkeypatch, db_session, _trace_blob, _seeded_trace,
):
    monkeypatch.delenv("VIBESHUB_OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("VIBESHUB_OPENAI_ENDPOINT", raising=False)
    monkeypatch.delenv("VIBESHUB_OPENAI_MODEL", raising=False)
    result = await compute_digest(
        db_session, _seeded_trace,
        blob=_trace_blob, subagent_blobs={},
    )
    assert result is None
    rows = (await db_session.execute(select(AgentRun))).scalars().all()
    assert len(rows) == 1
    assert rows[0].outcome == Outcome.SKIP_NO_CONFIG.value
    assert _seeded_trace.digest_json is None


@pytest.mark.asyncio
async def test_call_failure_records_fail_call(
    monkeypatch, db_session, _trace_blob, _seeded_trace,
):
    monkeypatch.setenv("VIBESHUB_OPENAI_API_KEY", "sk-x")
    monkeypatch.setenv("VIBESHUB_OPENAI_ENDPOINT", "https://e")
    monkeypatch.setenv("VIBESHUB_OPENAI_MODEL", "gpt-5.5")
    mock_client = MagicMock()
    mock_client.responses.create.side_effect = RuntimeError("502")
    monkeypatch.setattr(
        "app.agents.digest.pipeline.get_client", lambda: mock_client,
    )
    result = await compute_digest(
        db_session, _seeded_trace,
        blob=_trace_blob, subagent_blobs={},
    )
    assert result is None
    rows = (await db_session.execute(select(AgentRun))).scalars().all()
    assert rows[0].outcome == Outcome.FAIL_CALL.value
    assert "502" in (rows[0].error_detail or "")


@pytest.mark.asyncio
async def test_invalid_json_records_fail_schema(
    monkeypatch, db_session, _trace_blob, _seeded_trace,
):
    monkeypatch.setenv("VIBESHUB_OPENAI_API_KEY", "sk-x")
    monkeypatch.setenv("VIBESHUB_OPENAI_ENDPOINT", "https://e")
    monkeypatch.setenv("VIBESHUB_OPENAI_MODEL", "gpt-5.5")
    mock_client = MagicMock()
    bad = MagicMock()
    bad.output_text = "this is not json"
    bad.usage = MagicMock(input_tokens=10, output_tokens=2)
    mock_client.responses.create.return_value = bad
    monkeypatch.setattr(
        "app.agents.digest.pipeline.get_client", lambda: mock_client,
    )
    result = await compute_digest(
        db_session, _seeded_trace,
        blob=_trace_blob, subagent_blobs={},
    )
    assert result is None
    rows = (await db_session.execute(select(AgentRun))).scalars().all()
    assert rows[0].outcome == Outcome.FAIL_SCHEMA.value
    assert "this is not json" in (rows[0].error_detail or "")


@pytest.mark.asyncio
async def test_em_dash_is_stripped_before_persist(
    monkeypatch, db_session, _trace_blob, _seeded_trace,
):
    monkeypatch.setenv("VIBESHUB_OPENAI_API_KEY", "sk-x")
    monkeypatch.setenv("VIBESHUB_OPENAI_ENDPOINT", "https://e")
    monkeypatch.setenv("VIBESHUB_OPENAI_MODEL", "gpt-5.5")
    payload = dict(VALID_PAYLOAD)
    payload["ask"] = "fix oauth — clean up scopes"
    mock_client = MagicMock()
    mock_client.responses.create.return_value = _ok_response(payload)
    monkeypatch.setattr(
        "app.agents.digest.pipeline.get_client", lambda: mock_client,
    )
    digest = await compute_digest(
        db_session, _seeded_trace,
        blob=_trace_blob, subagent_blobs={},
    )
    assert "—" not in digest.ask
    assert "fix oauth, clean up scopes" == digest.ask


@pytest.mark.asyncio
async def test_idempotency_skips_call_on_unchanged_input(
    monkeypatch, db_session, _trace_blob, _seeded_trace,
):
    monkeypatch.setenv("VIBESHUB_OPENAI_API_KEY", "sk-x")
    monkeypatch.setenv("VIBESHUB_OPENAI_ENDPOINT", "https://e")
    monkeypatch.setenv("VIBESHUB_OPENAI_MODEL", "gpt-5.5")
    mock_client = MagicMock()
    mock_client.responses.create.return_value = _ok_response(VALID_PAYLOAD)
    monkeypatch.setattr(
        "app.agents.digest.pipeline.get_client", lambda: mock_client,
    )
    # First call: live LLM
    first = await compute_digest(
        db_session, _seeded_trace,
        blob=_trace_blob, subagent_blobs={},
    )
    assert mock_client.responses.create.call_count == 1
    assert first is not None
    # Second call with same blob: skipped
    second = await compute_digest(
        db_session, _seeded_trace,
        blob=_trace_blob, subagent_blobs={},
    )
    assert mock_client.responses.create.call_count == 1  # no extra call
    assert second is not None
    assert second.ask == first.ask
    rows = (await db_session.execute(
        select(AgentRun).order_by(AgentRun.created_at),
    )).scalars().all()
    assert [r.outcome for r in rows] == [
        Outcome.OK.value, Outcome.SKIP_UNCHANGED.value,
    ]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./env/bin/pytest webapp/backend/tests/agents/digest/test_pipeline.py -v`
Expected: FAIL with "No module named 'app.agents.digest.pipeline'"

- [ ] **Step 3: Add the prompt (placeholder for now — content reviewed at deploy)**

Create `webapp/backend/app/agents/digest/prompt.py`:

```python
"""System prompt for the trace digest agent.

The prompt is finalized during implementation against the three sample
traces in webapp/backend/tests/agents/digest/fixtures/. Reviewed against
real production traces after first deploy. See spec §14.
"""
SYSTEM_PROMPT = """You read a distilled Claude Code session trace and \
return a 5-line digest plus 3-8 semantic chapter anchors. The reader is a \
teammate reviewing a PR; voice is "what changed and why", PR-description \
style, plain English.

The trace is presented as a sequence of lines, each prefixed with the \
source event's UUID in square brackets, e.g. [a1f8…] ASSISTANT: …

## Output (strict JSON only)

{
  "ask": "<the user's request — 1 sentence>",
  "decisions": "<key technical decisions made — 1 sentence>",
  "files": "<files touched and what changed — 1 sentence>",
  "tests": "<tests added/changed, or 'none' — 1 sentence>",
  "dead_ends": "<attempts that were rolled back, or 'none' — 1 sentence>",
  "chapters": [
    {
      "anchor_uuid": "<a UUID that appears in [brackets] in the input>",
      "title": "<2-6 word chapter heading>",
      "caption": "<1 sentence — what happens in this segment>"
    },
    ...
  ]
}

## Rules

- Each field is at most 200 characters.
- chapter.title is at most 80 chars; caption at most 160.
- 3-8 chapters total. Pick natural semantic breaks (new sub-goal, wrong \
  fix discarded, course-correction, polish phase). Do NOT use every user \
  prompt as a chapter — coarser than that.
- anchor_uuid MUST be one of the UUIDs in square brackets in the input. \
  If unsure, drop the chapter rather than guess.
- Never use em-dashes ("—"). Use commas, periods, or parentheses instead.
- No URLs, no markdown formatting, no emoji.
"""
```

- [ ] **Step 4: Implement the pipeline**

Create `webapp/backend/app/agents/digest/pipeline.py`:

```python
"""Orchestrate the trace digest call.

The single public entry point is compute_digest. It:
  1. Distills the trace.
  2. Hashes the distilled string; if it matches trace.digest_input_hash,
     skip the LLM call entirely.
  3. Calls OpenAI responses.create with json_object output.
  4. Validates the JSON, drops chapters whose anchor_uuid isn't in the
     distilled UUID surface, strips em-dashes.
  5. Persists digest_json + digest_input_hash on the trace row.
  6. Records the run in agent_run via record_run().

Never raises. Returns the validated Digest on success, None otherwise.
"""
from __future__ import annotations

import hashlib
import json
import logging
import time

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents._client import get_client, get_model
from app.agents._usage import Outcome, record_run
from app.agents.digest.distill import distill_with_uuids
from app.agents.digest.prompt import SYSTEM_PROMPT
from app.agents.digest.schema import Digest, strip_em_dashes
from app.storage.models import Trace

log = logging.getLogger("vibeshub.agents.digest")

_MAX_OUTPUT_TOKENS = 4000
_REASONING_EFFORT = "low"


async def compute_digest(
    session: AsyncSession,
    trace: Trace,
    *,
    blob: bytes,
    subagent_blobs: dict[str, bytes],
) -> Digest | None:
    distilled, uuids = distill_with_uuids(blob, subagent_blobs=subagent_blobs)
    input_hash = hashlib.sha256(distilled.encode("utf-8")).hexdigest()
    truncated = "[… elided" in distilled

    # Idempotency: same distilled input → reuse persisted digest.
    if (
        trace.digest_input_hash == input_hash
        and trace.digest_json is not None
    ):
        await record_run(
            session, agent_name="digest", trace_id=trace.short_id,
            model=get_model(), input_tokens=0, output_tokens=0,
            latency_ms=0, outcome=Outcome.SKIP_UNCHANGED,
        )
        try:
            return Digest.model_validate(trace.digest_json)
        except ValidationError:
            return None

    client = get_client()
    if client is None:
        await record_run(
            session, agent_name="digest", trace_id=trace.short_id,
            model=None, input_tokens=0, output_tokens=0,
            latency_ms=0, outcome=Outcome.SKIP_NO_CONFIG,
        )
        return None

    if not distilled.strip():
        # No content to digest; skip silently.
        return None

    model = get_model()
    started = time.monotonic()
    try:
        response = client.responses.create(
            model=model,
            instructions=SYSTEM_PROMPT,
            input=distilled,
            max_output_tokens=_MAX_OUTPUT_TOKENS,
            reasoning={"effort": _REASONING_EFFORT},
            text={"format": {"type": "json_object"}},
        )
    except Exception as exc:  # noqa: BLE001
        latency_ms = int((time.monotonic() - started) * 1000)
        await record_run(
            session, agent_name="digest", trace_id=trace.short_id,
            model=model, input_tokens=0, output_tokens=0,
            latency_ms=latency_ms, outcome=Outcome.FAIL_CALL,
            error_detail=str(exc)[:500],
        )
        return None
    latency_ms = int((time.monotonic() - started) * 1000)

    in_tok = _safe_int(getattr(response, "usage", None), "input_tokens")
    out_tok = _safe_int(getattr(response, "usage", None), "output_tokens")
    raw = response.output_text or ""

    try:
        parsed = json.loads(raw)
        candidate = Digest.model_validate(parsed)
    except (json.JSONDecodeError, ValidationError) as exc:
        await record_run(
            session, agent_name="digest", trace_id=trace.short_id,
            model=model, input_tokens=in_tok, output_tokens=out_tok,
            latency_ms=latency_ms, outcome=Outcome.FAIL_SCHEMA,
            error_detail=f"{exc}\n--\n{raw[:500]}",
        )
        return None

    # Em-dash sweep + anchor validation
    for field in ("ask", "decisions", "files", "tests", "dead_ends"):
        setattr(candidate, field, strip_em_dashes(getattr(candidate, field)))
    chapters_total = len(candidate.chapters)
    candidate.chapters = [
        c for c in candidate.chapters if c.anchor_uuid in uuids
    ]
    for c in candidate.chapters:
        c.title = strip_em_dashes(c.title)
        c.caption = strip_em_dashes(c.caption)
    chapters_kept = len(candidate.chapters)

    trace.digest_json = candidate.model_dump()
    trace.digest_input_hash = input_hash

    await record_run(
        session, agent_name="digest", trace_id=trace.short_id,
        model=model, input_tokens=in_tok, output_tokens=out_tok,
        latency_ms=latency_ms, outcome=Outcome.OK,
        extra={
            "chapters_kept": chapters_kept,
            "chapters_total": chapters_total,
            "distill_truncated": truncated,
        },
    )
    return candidate


def _safe_int(usage_obj, attr: str) -> int:
    if usage_obj is None:
        return 0
    val = getattr(usage_obj, attr, 0)
    try:
        return int(val or 0)
    except (TypeError, ValueError):
        return 0
```

- [ ] **Step 5: Re-export from the agent's `__init__.py`**

Edit `webapp/backend/app/agents/digest/__init__.py`:

```python
"""Trace digest agent — public API."""
from app.agents.digest.pipeline import compute_digest
from app.agents.digest.schema import Chapter, Digest

__all__ = ["Chapter", "Digest", "compute_digest"]
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `./env/bin/pytest webapp/backend/tests/agents/digest/test_pipeline.py -v`
Expected: PASS (7 tests)

- [ ] **Step 7: Commit**

```bash
git add webapp/backend/app/agents/digest/ webapp/backend/tests/agents/digest/test_pipeline.py
git commit -m "Add digest pipeline: orchestrate distill, LLM call, persist, record"
```

---

### Task 9: Wire into trace upload + extend API schemas

**Files:**
- Modify: `webapp/backend/app/api/trace_service.py`
- Modify: `webapp/backend/app/api/schemas.py`
- Modify: `webapp/backend/app/api/traces.py` (the `_to_summary` helper)
- Create: `webapp/backend/tests/api/test_traces_digest.py`

- [ ] **Step 1: Write the failing integration test**

Create `webapp/backend/tests/api/test_traces_digest.py`:

```python
"""End-to-end-ish test: upload a trace and verify the digest pipeline ran.

The OpenAI client is patched at the seam so this never hits the network.
The rest (redaction, blob store, DB persistence, response serialization)
is real.
"""
import json
from unittest.mock import MagicMock

import pytest


SAMPLE_JSONL = (
    b'{"type":"user","uuid":"u1","message":{"content":"Test"}}\n'
    b'{"type":"assistant","uuid":"a1","message":'
    b'{"content":[{"type":"text","text":"Done."}]}}\n'
)


@pytest.fixture
def _digest_env(monkeypatch):
    monkeypatch.setenv("VIBESHUB_OPENAI_API_KEY", "sk-x")
    monkeypatch.setenv("VIBESHUB_OPENAI_ENDPOINT", "https://e")
    monkeypatch.setenv("VIBESHUB_OPENAI_MODEL", "gpt-5.5")


@pytest.fixture
def _patch_llm(monkeypatch):
    mock = MagicMock()
    payload = {
        "ask": "test ask", "decisions": "test decisions",
        "files": "test files", "tests": "test tests",
        "dead_ends": "test dead_ends", "chapters": [],
    }
    resp = MagicMock()
    resp.output_text = json.dumps(payload)
    resp.usage = MagicMock(input_tokens=5, output_tokens=3)
    mock.responses.create.return_value = resp
    monkeypatch.setattr(
        "app.agents.digest.pipeline.get_client", lambda: mock,
    )
    return mock


def test_upload_runs_digest_and_returns_it(
    client, _digest_env, _patch_llm,
):
    """POST a trace via the existing ingest path. Assert the response
    contains a digest, the trace row stores it, and an agent_run was
    written. Uses the same ingest path the plugin uses today.
    """
    # NOTE: Replace this with the project's actual upload helper.
    # The pattern is in tests/test_bundle_loose.py / test_e2e.py.
    # The point of this test is to prove the digest field round-trips
    # end-to-end through the FastAPI app.
    from tests._auth_helpers import upload_sample_bundle
    short_id = upload_sample_bundle(client, SAMPLE_JSONL)

    resp = client.get(f"/api/traces/{short_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert "ai_digest" in body
    assert body["ai_digest"]["ask"] == "test ask"
    assert _patch_llm.responses.create.call_count == 1


def test_upload_without_env_persists_no_digest(client):
    """No OpenAI env vars set → digest is None on the response."""
    from tests._auth_helpers import upload_sample_bundle
    short_id = upload_sample_bundle(client, SAMPLE_JSONL)
    resp = client.get(f"/api/traces/{short_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("ai_digest") is None
```

NOTE FOR IMPLEMENTER: `upload_sample_bundle` is a thin helper. Check `tests/_auth_helpers.py` — if it doesn't already exist, look at `tests/test_e2e.py` for the bundle-upload pattern and either add the helper there or inline the bundle-creation here. The key behavior under test is that `/api/traces/{short_id}` returns `ai_digest` set / unset.

- [ ] **Step 2: Run the test to verify it fails**

Run: `./env/bin/pytest webapp/backend/tests/api/test_traces_digest.py -v`
Expected: FAIL with "no field ai_digest in TraceSummary" or similar.

- [ ] **Step 3: Extend TraceSummary in schemas.py**

In `webapp/backend/app/api/schemas.py`, add the new types after `AgentSummary`:

```python
class DigestChapter(BaseModel):
    anchor_uuid: str
    title: str
    caption: str


class TraceDigest(BaseModel):
    ask: str
    decisions: str
    files: str
    tests: str
    dead_ends: str
    chapters: list[DigestChapter] = Field(default_factory=list)
```

And add the field to `TraceSummary` (just before `agent_count`):

```python
    ai_digest: TraceDigest | None = None
```

Also add to `IngestResponse` (after `claim_token`):

```python
    ai_digest: TraceDigest | None = None
```

- [ ] **Step 4: Wire compute_digest into create_or_update_trace**

In `webapp/backend/app/api/trace_service.py`, after the trace row is created/updated and BEFORE the function returns, add:

```python
    # Trace digest agent — best-effort, never raises.
    from app.agents.digest import compute_digest
    await compute_digest(
        session,
        trace,
        blob=unpacked.main_bytes,
        subagent_blobs={
            a.meta.get("toolUseId", a.agent_id): a.jsonl_bytes
            for a in unpacked.agents
        },
    )
```

The exact insertion point: directly above the `return trace` (or equivalent) at the end of `create_or_update_trace`. The function must already have access to `unpacked` and `session`.

- [ ] **Step 5: Surface `ai_digest` in the `_to_summary` helper**

In `webapp/backend/app/api/traces.py`, locate `_to_summary` (around line 165) and add at the bottom of the constructed `TraceSummary(...)` arguments:

```python
        ai_digest=t.digest_json,
```

Pydantic v2 will coerce the dict into `TraceDigest` automatically.

Similarly, surface `ai_digest` in the ingest response. Find where `IngestResponse(...)` is constructed in the upload endpoint (the route handling `POST /api/ingest` or similar) and add:

```python
        ai_digest=trace.digest_json,
```

- [ ] **Step 6: Run the integration test to verify it passes**

Run: `./env/bin/pytest webapp/backend/tests/api/test_traces_digest.py -v`
Expected: PASS (2 tests)

- [ ] **Step 7: Run the full backend test suite as a regression check**

Run: `./env/bin/pytest webapp/backend/tests/ -x -q 2>&1 | tail -10`
Expected: PASS (no regressions). Common breakage: existing API tests that snapshot the TraceSummary response now see an extra `ai_digest: null` field. Update the snapshots inline; this is the spec change.

- [ ] **Step 8: Commit**

```bash
git add webapp/backend/app/api/ webapp/backend/tests/api/test_traces_digest.py
git commit -m "Wire digest pipeline into trace upload + extend API schemas"
```

---

## Phase D — Plugin

### Task 10: UploadResult carries digest

**Files:**
- Modify: `plugins/cli/vibeshub_client/upload.py`
- Modify: `plugins/cli/tests/test_upload.py`

- [ ] **Step 1: Read the existing UploadResult**

Run: `grep -n "class UploadResult\|short_id\|trace_url" plugins/cli/vibeshub_client/upload.py | head -10`

Confirm the dataclass shape so the new field is added consistently.

- [ ] **Step 2: Write the failing test**

Append to `plugins/cli/tests/test_upload.py` (or create the test there if not present):

```python
def test_upload_result_round_trips_digest():
    """UploadResult parses an optional digest dict from the backend response."""
    from vibeshub_client.upload import UploadResult, _parse_response
    payload = {
        "trace_id": "t1", "short_id": "abc12345",
        "trace_url": "https://vibeshub.test/t/abc12345",
        "ai_digest": {
            "ask": "test ask", "decisions": "d", "files": "f",
            "tests": "t", "dead_ends": "e",
            "chapters": [],
        },
    }
    result = _parse_response(payload)
    assert result.digest == payload["ai_digest"]


def test_upload_result_digest_optional():
    from vibeshub_client.upload import _parse_response
    payload = {
        "trace_id": "t1", "short_id": "abc12345",
        "trace_url": "https://vibeshub.test/t/abc12345",
    }
    result = _parse_response(payload)
    assert result.digest is None
```

NOTE: `_parse_response` is a helper you're about to extract in step 4. The test guides the refactor.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `./env/bin/pytest plugins/cli/tests/test_upload.py -v -k digest`
Expected: FAIL with "cannot import _parse_response" (because the helper doesn't exist yet, and `UploadResult` has no `digest` field).

- [ ] **Step 4: Add the `digest` field and extract `_parse_response`**

In `plugins/cli/vibeshub_client/upload.py`:

1. Add `digest` to the `UploadResult` dataclass:

```python
@dataclass
class UploadResult:
    trace_id: str
    short_id: str
    trace_url: str
    digest: dict | None = None
```

2. Extract a `_parse_response` helper and use it where the existing code does `data = json.loads(...); return UploadResult(...)`. Replace those lines with:

```python
return _parse_response(data)
```

and add this helper at module level:

```python
def _parse_response(data: dict) -> UploadResult:
    return UploadResult(
        trace_id=data["trace_id"],
        short_id=data["short_id"],
        trace_url=data["trace_url"],
        digest=data.get("ai_digest"),
    )
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `./env/bin/pytest plugins/cli/tests/test_upload.py -v`
Expected: PASS (all existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add plugins/cli/vibeshub_client/upload.py plugins/cli/tests/test_upload.py
git commit -m "Plugin: UploadResult carries optional digest"
```

---

### Task 11: PR-comment body embeds digest

**Files:**
- Modify: `plugins/cli/vibeshub_client/post_comment.py`
- Modify: `plugins/cli/tests/test_post_comment.py`

- [ ] **Step 1: Write the failing tests**

Append to `plugins/cli/tests/test_post_comment.py`:

```python
def test_build_comment_body_without_digest_is_unchanged():
    """Regression guard: today's one-line body must be preserved when no
    digest is supplied so older backends keep working."""
    from vibeshub_client.post_comment import build_comment_body
    body = build_comment_body(
        trace_url="https://vibeshub.test/t/abc12345",
        pr_url="https://github.com/x/y/pull/1",
    )
    assert "Claude Code trace for this PR" in body
    assert "**Ask:**" not in body  # no digest formatting


def test_build_comment_body_with_digest_prepends_five_bullets():
    from vibeshub_client.post_comment import build_comment_body
    digest = {
        "ask": "Add /healthcheck",
        "decisions": "Inline in main.py",
        "files": "webapp/backend/app/main.py",
        "tests": "test_health.py: assert 200 on /healthcheck",
        "dead_ends": "Considered a new router; YAGNI",
        "chapters": [],
    }
    body = build_comment_body(
        trace_url="https://vibeshub.test/t/abc12345",
        pr_url="https://github.com/x/y/pull/1",
        digest=digest,
    )
    # Five bullets in order
    lines = body.splitlines()
    expected_prefixes = [
        "**Ask:**", "**Key decisions:**", "**Files touched:**",
        "**Tests added:**", "**Dead ends:**",
    ]
    found = [l for l in lines if any(l.startswith(p) for p in expected_prefixes)]
    assert len(found) == 5
    assert "Add /healthcheck" in body
    # Trace link still present
    assert "Claude Code trace for this PR" in body


def test_build_comment_body_with_partial_digest_still_renders_known_fields():
    from vibeshub_client.post_comment import build_comment_body
    # Backend could omit fields in some failure mode; we just render what's
    # present without raising KeyError.
    digest = {"ask": "x"}
    body = build_comment_body(
        trace_url="https://vibeshub.test/t/abc12345",
        pr_url="https://github.com/x/y/pull/1",
        digest=digest,
    )
    assert "**Ask:** x" in body
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./env/bin/pytest plugins/cli/tests/test_post_comment.py -v -k digest`
Expected: FAIL (kwarg not accepted, bullets not emitted)

- [ ] **Step 3: Extend `build_comment_body`**

In `plugins/cli/vibeshub_client/post_comment.py`, replace the `build_comment_body` signature and body:

```python
def build_comment_body(
    trace_url: str, pr_url: str, *, platform_label: str = "Claude Code",
    digest: dict | None = None,
) -> str:
    parts: list[str] = []
    if digest:
        parts.append(_format_digest(digest))
        parts.append("")  # blank line between digest and link
    parts.append(
        f"{platform_label} trace for this PR: "
        f"{_pr_style_trace_url(trace_url, pr_url)}\n"
    )
    return "\n".join(parts)


_DIGEST_FIELDS: list[tuple[str, str]] = [
    ("ask", "Ask"),
    ("decisions", "Key decisions"),
    ("files", "Files touched"),
    ("tests", "Tests added"),
    ("dead_ends", "Dead ends"),
]


def _format_digest(digest: dict) -> str:
    lines: list[str] = []
    for key, label in _DIGEST_FIELDS:
        val = digest.get(key)
        if not val:
            continue
        lines.append(f"**{label}:** {val}")
    return "\n".join(lines)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./env/bin/pytest plugins/cli/tests/test_post_comment.py -v`
Expected: PASS (all tests).

- [ ] **Step 5: Wire digest through the pipeline call site**

Find where `build_comment_body` is called in `plugins/cli/vibeshub_client/pipeline.py` (or `share-trace` command). Pass the digest:

```python
body = build_comment_body(
    trace_url=upload_result.trace_url,
    pr_url=pr_url,
    digest=upload_result.digest,
)
```

- [ ] **Step 6: Run the pipeline tests to confirm e2e**

Run: `./env/bin/pytest plugins/cli/tests/test_pipeline.py plugins/cli/tests/test_hook_e2e.py -v 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add plugins/cli/vibeshub_client/ plugins/cli/tests/
git commit -m "Plugin: PR comment body embeds 5-bullet digest when present"
```

---

## Phase E — Frontend

### Task 12: TraceSummary type + DigestPanel component

**Files:**
- Modify: `webapp/frontend/src/types.ts`
- Create: `webapp/frontend/src/components/trace/DigestPanel.tsx`
- Create: `webapp/frontend/src/components/trace/DigestPanel.module.css`
- Create: `webapp/frontend/src/tests/trace/DigestPanel.test.tsx`

- [ ] **Step 1: Extend the TraceSummary type**

In `webapp/frontend/src/types.ts`, add at the top (near other interfaces):

```ts
export interface DigestChapter {
  anchor_uuid: string;
  title: string;
  caption: string;
}

export interface TraceDigest {
  ask: string;
  decisions: string;
  files: string;
  tests: string;
  dead_ends: string;
  chapters: DigestChapter[];
}
```

And add the field to `TraceSummary` (after `agents: AgentSummary[];`):

```ts
  ai_digest?: TraceDigest | null;
```

- [ ] **Step 2: Write the failing DigestPanel test**

Create `webapp/frontend/src/tests/trace/DigestPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DigestPanel } from "../../components/trace/DigestPanel";
import type { TraceDigest } from "../../types";


const sampleDigest: TraceDigest = {
  ask: "Add /healthcheck",
  decisions: "Inline in main.py",
  files: "webapp/backend/app/main.py",
  tests: "test_health.py",
  dead_ends: "Considered a new router; YAGNI",
  chapters: [
    { anchor_uuid: "u1", title: "Frame", caption: "User asks." },
    { anchor_uuid: "u2", title: "Land", caption: "Patch shipped." },
  ],
};


describe("DigestPanel", () => {
  it("renders all five bullets", () => {
    render(<DigestPanel digest={sampleDigest} />);
    expect(screen.getByText(/Ask/i)).toBeInTheDocument();
    expect(screen.getByText("Add /healthcheck")).toBeInTheDocument();
    expect(screen.getByText("Inline in main.py")).toBeInTheDocument();
    expect(
      screen.getByText("webapp/backend/app/main.py"),
    ).toBeInTheDocument();
    expect(screen.getByText("test_health.py")).toBeInTheDocument();
    expect(
      screen.getByText("Considered a new router; YAGNI"),
    ).toBeInTheDocument();
  });

  it("renders a chapter rail when chapters present", () => {
    render(<DigestPanel digest={sampleDigest} />);
    expect(screen.getByText("Frame")).toBeInTheDocument();
    expect(screen.getByText("Land")).toBeInTheDocument();
  });

  it("hides the chapter rail when chapters empty", () => {
    render(
      <DigestPanel digest={{ ...sampleDigest, chapters: [] }} />,
    );
    expect(screen.queryByText(/Jump to/i)).not.toBeInTheDocument();
  });

  it("scrolls the chapter anchor into view on click", async () => {
    const user = userEvent.setup();
    const scrollSpy = vi.fn();
    const fakeEl = { scrollIntoView: scrollSpy } as unknown as HTMLElement;
    vi.spyOn(document, "getElementById").mockImplementation((id) =>
      id === "evt-u1" ? fakeEl : null,
    );

    render(<DigestPanel digest={sampleDigest} />);
    await user.click(screen.getByText("Frame"));
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth" });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd webapp/frontend && npx vitest run src/tests/trace/DigestPanel.test.tsx`
Expected: FAIL with "cannot find module ../../components/trace/DigestPanel".

- [ ] **Step 4: Implement DigestPanel**

Create `webapp/frontend/src/components/trace/DigestPanel.module.css`:

```css
.panel {
  border: 1px solid var(--border-subtle, #e5e5e5);
  border-radius: 10px;
  padding: 16px 18px;
  margin: 16px 0;
  background: var(--bg-panel, #fafafa);
}

.bullets {
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 12px;
  row-gap: 6px;
  font-size: 14px;
}

.label {
  color: var(--text-muted, #666);
  font-weight: 600;
}

.value {
  color: var(--text-default, #111);
}

.rail {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--border-subtle, #e5e5e5);
}

.railLabel {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted, #666);
  margin-bottom: 6px;
}

.chapter {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: 4px 0;
  cursor: pointer;
  font-size: 14px;
  color: var(--link, #2358d8);
}

.chapter:hover {
  text-decoration: underline;
}
```

Create `webapp/frontend/src/components/trace/DigestPanel.tsx`:

```tsx
import type { TraceDigest } from "../../types";
import styles from "./DigestPanel.module.css";

interface Props {
  digest: TraceDigest;
}

const BULLETS: Array<{ key: keyof Omit<TraceDigest, "chapters">; label: string }> = [
  { key: "ask", label: "Ask" },
  { key: "decisions", label: "Key decisions" },
  { key: "files", label: "Files touched" },
  { key: "tests", label: "Tests added" },
  { key: "dead_ends", label: "Dead ends" },
];

export function DigestPanel({ digest }: Props) {
  const onJump = (uuid: string) => {
    const el = document.getElementById(`evt-${uuid}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <section className={styles.panel}>
      <div className={styles.bullets}>
        {BULLETS.map(({ key, label }) => (
          <div className={styles.row} key={key} style={{ display: "contents" }}>
            <div className={styles.label}>{label}</div>
            <div className={styles.value}>{digest[key]}</div>
          </div>
        ))}
      </div>
      {digest.chapters.length > 0 && (
        <div className={styles.rail}>
          <div className={styles.railLabel}>Jump to</div>
          {digest.chapters.map((c) => (
            <button
              key={c.anchor_uuid}
              className={styles.chapter}
              onClick={() => onJump(c.anchor_uuid)}
              title={c.caption}
            >
              {c.title}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd webapp/frontend && npx vitest run src/tests/trace/DigestPanel.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add webapp/frontend/src/types.ts webapp/frontend/src/components/trace/DigestPanel.tsx webapp/frontend/src/components/trace/DigestPanel.module.css webapp/frontend/src/tests/trace/DigestPanel.test.tsx
git commit -m "Frontend: TraceDigest type + DigestPanel component"
```

---

### Task 13: ChapterDivider component

**Files:**
- Create: `webapp/frontend/src/components/trace/ChapterDivider.tsx`
- Create: `webapp/frontend/src/components/trace/ChapterDivider.module.css`
- Create: `webapp/frontend/src/tests/trace/ChapterDivider.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `webapp/frontend/src/tests/trace/ChapterDivider.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ChapterDivider } from "../../components/trace/ChapterDivider";


describe("ChapterDivider", () => {
  it("renders title and caption", () => {
    render(<ChapterDivider title="Frame" caption="User asks for X." />);
    expect(screen.getByText("Frame")).toBeInTheDocument();
    expect(screen.getByText("User asks for X.")).toBeInTheDocument();
  });

  it("renders without caption", () => {
    render(<ChapterDivider title="Frame" caption="" />);
    expect(screen.getByText("Frame")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd webapp/frontend && npx vitest run src/tests/trace/ChapterDivider.test.tsx`
Expected: FAIL with "cannot find module".

- [ ] **Step 3: Implement ChapterDivider**

Create `webapp/frontend/src/components/trace/ChapterDivider.module.css`:

```css
.divider {
  margin: 22px 0 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle, #e5e5e5);
}

.title {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-default, #111);
}

.caption {
  font-style: italic;
  font-size: 13px;
  color: var(--text-muted, #666);
  margin-top: 2px;
}
```

Create `webapp/frontend/src/components/trace/ChapterDivider.tsx`:

```tsx
import styles from "./ChapterDivider.module.css";

interface Props {
  title: string;
  caption: string;
}

export function ChapterDivider({ title, caption }: Props) {
  return (
    <div className={styles.divider}>
      <div className={styles.title}>{title}</div>
      {caption && <div className={styles.caption}>{caption}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd webapp/frontend && npx vitest run src/tests/trace/ChapterDivider.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/components/trace/ChapterDivider.tsx webapp/frontend/src/components/trace/ChapterDivider.module.css webapp/frontend/src/tests/trace/ChapterDivider.test.tsx
git commit -m "Frontend: ChapterDivider component"
```

---

### Task 14: Wire DigestPanel into Hero, ChapterDividers into Thread

**Files:**
- Modify: `webapp/frontend/src/components/trace/Hero.tsx`
- Modify: `webapp/frontend/src/components/trace/Thread.tsx`
- Modify: `webapp/frontend/src/tests/routes/TraceView.test.tsx`

- [ ] **Step 1: Add the failing TraceView integration tests**

Append to `webapp/frontend/src/tests/routes/TraceView.test.tsx` (matching the existing import + setup patterns):

```tsx
describe("DigestPanel integration", () => {
  it("renders DigestPanel when ai_digest is present", async () => {
    // Use the existing test setup that loads the TraceView with a mocked
    // /api/traces/{id} response. Augment the response with ai_digest:
    const digest = {
      ask: "test ask", decisions: "d", files: "f", tests: "t",
      dead_ends: "e",
      chapters: [
        { anchor_uuid: "u1", title: "Frame", caption: "ask" },
      ],
    };
    // (Adapt to the project's existing fetch mock seam; the existing test
    // file already mocks /api/traces/{id}.)
    await renderTraceViewWithSummary({ ai_digest: digest });
    expect(screen.getByText("test ask")).toBeInTheDocument();
    expect(screen.getByText("Frame")).toBeInTheDocument();
  });

  it("does not render DigestPanel when ai_digest is absent", async () => {
    await renderTraceViewWithSummary({ ai_digest: null });
    expect(screen.queryByText(/^Ask$/i)).not.toBeInTheDocument();
  });

  it("renders ChapterDivider above the anchored event when chapters present", async () => {
    const digest = {
      ask: "a", decisions: "d", files: "f", tests: "t", dead_ends: "e",
      chapters: [
        { anchor_uuid: "<USE-A-UUID-FROM-FIXTURE>", title: "Frame",
          caption: "the asking part" },
      ],
    };
    await renderTraceViewWithSummary({ ai_digest: digest });
    expect(screen.getByText("Frame")).toBeInTheDocument();
    expect(screen.getByText("the asking part")).toBeInTheDocument();
  });
});
```

IMPLEMENTER NOTE: `renderTraceViewWithSummary` is a thin helper — extract it from the existing test file's setup if not already extracted. The seam to mock the summary response is already in place (the existing tests at lines 237/253/274/296 in `TraceView.test.tsx` mock the summary fetch — follow that pattern). For the third test, pick a UUID from `webapp/frontend/src/tests/fixtures/sample-session.jsonl` so the anchor matches an event the Thread actually renders.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd webapp/frontend && npx vitest run src/tests/routes/TraceView.test.tsx -t "DigestPanel integration"`
Expected: FAIL (DigestPanel not yet rendered in Hero; ChapterDivider not yet inserted by Thread).

- [ ] **Step 3: Render DigestPanel in Hero**

In `webapp/frontend/src/components/trace/Hero.tsx`, add the import:

```tsx
import { DigestPanel } from "./DigestPanel";
```

And render it inside the existing `<section>`, immediately above `<Outcome ... />`:

```tsx
{trace.ai_digest && <DigestPanel digest={trace.ai_digest} />}
```

- [ ] **Step 4: Make every Thread event renderable as a scroll target + render ChapterDividers**

In `webapp/frontend/src/components/trace/Thread.tsx`:

1. Add the import:

```tsx
import { ChapterDivider } from "./ChapterDivider";
```

2. Find the event loop (where events from the parsed session are rendered into rows). For each rendered event, wrap it in a `<div id={`evt-${ev.uuid}`}>` (or add the id to its existing wrapper if one exists). Concretely: if today the loop is `stream.map(ev => <EventRow ev={ev} />)`, change to:

```tsx
{stream.map(ev => (
  <div id={`evt-${ev.uuid}`} key={ev.uuid}>
    {chaptersByUuid.get(ev.uuid) && (
      <ChapterDivider
        title={chaptersByUuid.get(ev.uuid)!.title}
        caption={chaptersByUuid.get(ev.uuid)!.caption}
      />
    )}
    <EventRow ev={ev} />
  </div>
))}
```

3. Build `chaptersByUuid` from the trace digest. Add a `digest?: TraceDigest | null` prop to `Thread`, then:

```tsx
const chaptersByUuid = useMemo(() => {
  const m = new Map<string, DigestChapter>();
  for (const c of digest?.chapters ?? []) m.set(c.anchor_uuid, c);
  return m;
}, [digest]);
```

4. The caller in `TraceViewer.tsx` (or wherever `<Thread />` is mounted) needs to pass the prop:

```tsx
<Thread session={session} digest={trace.ai_digest} />
```

(If `Thread` doesn't currently take `digest` and the prop tree differs, drill it down one level at a time. Use the existing prop on Hero/`trace.ai_digest` as the source.)

- [ ] **Step 5: Run all the trace view tests to confirm**

Run: `cd webapp/frontend && npx vitest run src/tests/routes/TraceView.test.tsx`
Expected: PASS (all tests, including the three new digest-integration tests).

- [ ] **Step 6: Run the full frontend test suite as a regression check**

Run: `cd webapp/frontend && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add webapp/frontend/src/components/trace/Hero.tsx webapp/frontend/src/components/trace/Thread.tsx webapp/frontend/src/tests/routes/TraceView.test.tsx
git commit -m "Frontend: render DigestPanel in Hero and inline ChapterDividers in Thread"
```

---

## Phase F — Documentation

### Task 15: Agent README

**Files:**
- Create: `webapp/backend/app/agents/digest/README.md`

- [ ] **Step 1: Write the README**

Create `webapp/backend/app/agents/digest/README.md`:

```markdown
# Trace digest agent

Generates a 5-line digest + 3-8 semantic chapter anchors for an uploaded
Claude Code trace. Surfaces in the trace viewer's Hero panel and in the
PR comment body posted by the plugin.

## Flow

1. Backend calls `compute_digest(session, trace, blob, subagent_blobs)`
   from `app/api/trace_service.py::create_or_update_trace`, after the
   blob is written, before the transaction is committed.
2. `distill_with_uuids` (in `distill.py`) walks the JSONL once and
   classifies every event into a tier (see spec §5). Output is a single
   string with each retained event prefixed by `[uuid]`.
3. `pipeline.compute_digest` computes `sha256(distilled)` and compares
   to `trace.digest_input_hash`. Match → reuse persisted digest,
   `outcome=skip_unchanged`, no LLM call.
4. Otherwise: calls OpenAI `responses.create` with
   `text={"format": {"type": "json_object"}}` and `reasoning.effort=low`.
5. Validates the response with `Digest` (Pydantic). Drops chapters whose
   `anchor_uuid` isn't in the distilled UUID surface. Strips em-dashes
   from every string field.
6. Persists `digest_json` and `digest_input_hash` on the Trace row.
7. Records the run in `agent_run` via `record_run`.

## Env vars

- `VIBESHUB_OPENAI_API_KEY`
- `VIBESHUB_OPENAI_ENDPOINT`
- `VIBESHUB_OPENAI_MODEL`

All three must be set. Missing any → `outcome=skip_no_config`, upload
still succeeds, viewer hides the DigestPanel.

## Known degradation modes

- **Trace exceeds 200k-token hard cap after the adaptive pass** — the
  distiller head/tail-truncates with a `[… elided N events …]` marker.
  `extra.distill_truncated=true` on the agent_run row. Digest may miss
  middle-of-trace decisions.
- **All chapter anchors invalid** — digest persists with `chapters=[]`,
  `outcome=ok`, `extra.chapters_kept=0`. The DigestPanel still renders
  the 5 bullets; just no "Jump to" rail.
- **LLM call fails / output is malformed** — `outcome=fail_call` /
  `fail_schema`. The viewer shows the existing Outcome card without a
  DigestPanel; the PR comment falls back to the one-line trace link.

## Operations

Daily cost rollup:
```sql
SELECT date_trunc('day', created_at) AS day,
       sum(input_tokens) AS in_tok,
       sum(output_tokens) AS out_tok
FROM agent_run
WHERE agent_name = 'digest'
GROUP BY 1 ORDER BY 1 DESC;
```

Failure-mode snapshot (last 7 days):
```sql
SELECT outcome, count(*) FROM agent_run
WHERE agent_name = 'digest' AND created_at > now() - interval '7 days'
GROUP BY 1 ORDER BY 2 DESC;
```

Per-trace history (debug a specific upload):
```sql
SELECT created_at, outcome, input_tokens, output_tokens, extra
FROM agent_run
WHERE trace_id = '<short_id>' ORDER BY created_at;
```

## Adding a new agent

1. Create `webapp/backend/app/agents/<name>/` with the same five files
   (`__init__.py`, `schema.py`, `pipeline.py`, `prompt.py`, README).
2. Reuse `app.agents._client.get_client/get_model` and
   `app.agents._usage.record_run`. The `Outcome` enum is shared.
3. Add a column to `agent_run.extra` for any per-agent metadata; no
   schema change required.
```

- [ ] **Step 2: Commit**

```bash
git add webapp/backend/app/agents/digest/README.md
git commit -m "Add digest agent README: flow, env vars, ops queries"
```

---

## Self-review

(Performed after writing all tasks.)

1. **Spec coverage:** every spec section maps to a task. §3 (architecture), §4 (module layout), §5 (distillation), §6 (LLM call), §7 (persistence), §8 (idempotency), §9 (failure handling), §10 (plugin), §11 (frontend), §12 (testing), §13 (operations), §14 (deferred questions — explicitly deferred to implementation in Task 8's prompt comment). Spec §2 non-goals are honored (no backfill script, no LLM-quality tests, no separate route).
2. **Placeholders:** none. Every step has either complete code, an exact command, or a precise file/symbol reference. The `<USE-A-UUID-FROM-FIXTURE>` placeholder in Task 14 step 1 is intentional — the implementer reads it from the fixture they already have in context.
3. **Type consistency:** `Digest` / `Chapter` / `TraceDigest` / `DigestChapter` are used consistently across backend (Pydantic) and frontend (TS interface). `Outcome` enum values match the spec's failure-handling table. `digest_json`, `digest_input_hash`, `ai_digest` field names are consistent everywhere.
