# Cursor Trace Support — Backend Implementation Plan (Phase A of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the vibeshub backend store and serve Cursor agent traces with the same fidelity as Claude Code / Codex traces, with no new render model and no schema migration.

**Architecture:** The backend is a dumb blob store: it stores the raw redacted transcript JSONL and serves it back unchanged. Cursor support needs only three additive touches: (1) a regression test proving Cursor's UUID subagent ids pass the (already UUID-aware) bundle validator, (2) count Cursor-shaped messages (Cursor records use `role`, not the top-level `type` the Claude counter keys off, so they need their own branch), (3) make the per-trace SEO/OG card name "Cursor". A fourth task is an end-to-end ingest guard. `platform` and `source_format` are already free-text `String(32)` columns, so no Alembic migration is required and no ingest/storage code changes.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy (async), pytest. Tests run from `webapp/backend/` via the repo-root venv: `../../env/bin/pytest`.

**Ships independently:** Yes. Backwards-compatible (Claude/Codex traces unaffected) and must land/deploy *before* the plugin starts emitting Cursor traces (see the frontend and plugin plans).

**Spec:** `docs/superpowers/specs/2026-06-04-cursor-trace-support-design.md` (§5).

**Cursor raw record shape (load-bearing — spec §3.2):** each JSONL line is `{"role": "user"|"assistant", "message": {"content": [<block>, ...]}}` with **no** top-level `type`, `uuid`, `timestamp`, or `message.id`. Blocks are `{"type":"text","text":...}` and `{"type":"tool_use","name":...,"input":...}`. There are no `tool_result` blocks.

---

## File Structure

- Modify: `webapp/backend/app/redact/bundle.py:25` — update the agent-id comment to name Cursor (no regex change; the UUID alternation already matches Cursor ids).
- Modify: `webapp/backend/app/message_count.py` — add a Cursor-shape detector + counter branch.
- Modify: `webapp/backend/app/api/spa_seo.py:200-204` — `_agent_label` names Cursor.
- Test: `webapp/backend/tests/test_bundle_unpack.py`, `tests/test_message_count.py`, `tests/test_spa_seo.py`, `tests/test_ingest.py` (extend each).

No new files, no models change, no migration.

---

## Task 1: Confirm the bundle validator accepts Cursor UUID subagent ids

Cursor subagent files are `agents/<uuid>.jsonl` (8-4-4-4-12 hex). The shared `_AGENT_ID` regex in `bundle.py` was widened for Codex to accept any such UUID, so Cursor ids already pass. This task locks that in with a regression test and updates the explanatory comment.

**Files:**
- Modify: `webapp/backend/app/redact/bundle.py:25`
- Test: `webapp/backend/tests/test_bundle_unpack.py`

- [ ] **Step 1: Write the test**

Add to `webapp/backend/tests/test_bundle_unpack.py` (reuse the existing `_make_tar` helper and `unpack_and_redact` import):

```python
def test_unpack_accepts_cursor_uuid_agent():
    uuid = "09fbacda-2df4-47a7-a12e-2534c6d55047"
    tar = _make_tar({
        "main.jsonl": b'{"role":"user","message":{"content":[{"type":"text","text":"hi"}]}}\n',
        f"agents/{uuid}.jsonl": b'{"role":"user","message":{"content":[{"type":"text","text":"sub"}]}}\n',
        f"agents/{uuid}.meta.json": (
            b'{"agentType":"explore","description":"Bug sweep","toolUseId":"cursor-agent-0"}'
        ),
    })
    bundle = unpack_and_redact(tar, max_total_bytes=10_000)
    assert len(bundle.agents) == 1
    assert bundle.agents[0].agent_id == uuid
    assert bundle.agents[0].meta["toolUseId"] == "cursor-agent-0"
```

- [ ] **Step 2: Run test to verify it passes (regex already UUID-aware)**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/test_bundle_unpack.py::test_unpack_accepts_cursor_uuid_agent -v`
Expected: PASS (the `_AGENT_ID` UUID alternation added for Codex already matches Cursor's id). If it FAILS, the regex was Claude-only — widen `_AGENT_ID` at `bundle.py:26` to include `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}` before proceeding.

- [ ] **Step 3: Update the comment to name Cursor**

In `webapp/backend/app/redact/bundle.py`, change the comment on line 25 from:

```python
# Claude Code subagent id (a<16hex>) OR Codex thread UUID (8-4-4-4-12 hex).
```

to:

```python
# Claude Code subagent id (a<16hex>) OR Codex/Cursor thread UUID (8-4-4-4-12 hex).
```

- [ ] **Step 4: Run the file's full suite**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/test_bundle_unpack.py -v`
Expected: PASS (new test + all existing).

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/redact/bundle.py webapp/backend/tests/test_bundle_unpack.py
git commit -m "backend: regression-test Cursor UUID subagent ids in bundle validator"
```

---

## Task 2: Count Cursor-shaped messages

The default Claude counter in `count_messages` filters on `rec.get("type") != "assistant"`. Cursor records use `role` and have no top-level `type`, so they count as **0** — list views would show "0 messages". Add a Cursor detector + counter, dispatched after the Codex check.

**Files:**
- Modify: `webapp/backend/app/message_count.py`
- Test: `webapp/backend/tests/test_message_count.py`

- [ ] **Step 1: Write the failing test**

Add to `webapp/backend/tests/test_message_count.py` (it imports `count_messages` and has a `_lines(*records)` helper that JSON-encodes each record into UTF-8 JSONL bytes, as used by `test_codex_counts_assistant_messages_and_tool_calls`):

```python
def test_cursor_counts_assistant_text_and_tool_calls():
    data = _lines(
        {"role": "user",
         "message": {"content": [{"type": "text", "text": "<user_query>hi</user_query>"}]}},
        {"role": "assistant",
         "message": {"content": [
             {"type": "text", "text": "on it"},
             {"type": "tool_use", "name": "Read", "input": {"path": "/x"}},
             {"type": "tool_use", "name": "Shell", "input": {"command": "ls"}},
         ]}},
        {"role": "assistant",
         "message": {"content": [{"type": "text", "text": "done"}]}},
    )
    # assistant content blocks rendered as cards: 1 text + 2 tool_use + 1 text = 4
    assert count_messages(data) == 4
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/test_message_count.py::test_cursor_counts_assistant_text_and_tool_calls -v`
Expected: FAIL — returns `0` (no `type=="assistant"` records), `assert 0 == 4`.

- [ ] **Step 3: Add the Cursor branch**

In `webapp/backend/app/message_count.py`, add these two helpers immediately after `_count_codex` (before `count_messages`):

```python
def _looks_like_cursor(lines: list[bytes]) -> bool:
    if not lines:
        return False
    try:
        rec = json.loads(lines[0])
    except ValueError:
        return False
    return (
        isinstance(rec, dict)
        and "type" not in rec
        and rec.get("role") in ("user", "assistant")
        and isinstance(rec.get("message"), dict)
        and isinstance(rec["message"].get("content"), list)
    )


def _count_cursor(lines: list[bytes]) -> int:
    count = 0
    for raw in lines:
        try:
            rec = json.loads(raw)
        except ValueError:
            continue
        if not isinstance(rec, dict) or rec.get("role") != "assistant":
            continue
        msg = rec.get("message")
        if not isinstance(msg, dict):
            continue
        for block in msg.get("content") or []:
            if isinstance(block, dict) and block.get("type") in ("text", "tool_use"):
                count += 1
    return count
```

Then add the Cursor dispatch in `count_messages` immediately after the existing Codex dispatch (after line 60):

```python
    if _looks_like_codex(lines):
        return _count_codex(lines)
    if _looks_like_cursor(lines):
        return _count_cursor(lines)
```

Leave the existing Claude body below unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/test_message_count.py -v`
Expected: PASS (the new Cursor test, the Codex test, and all existing Claude-shape tests — Claude records carry a top-level `type` so `_looks_like_cursor` returns False for them).

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/message_count.py webapp/backend/tests/test_message_count.py
git commit -m "backend: count Cursor-shaped messages (role-based assistant text + tool calls)"
```

---

## Task 3: Per-trace SEO/OG card names Cursor

`_agent_label` maps a trace's platform to a human agent name for the per-trace link-preview head. Extend it for Cursor. (Leave the aggregate user/repo/PR heads and `/vibeviewer` static copy unchanged — they are SEO-tuned for the "Claude Code trace viewer" keyword and list mixed traces.)

**Files:**
- Modify: `webapp/backend/app/api/spa_seo.py:200-204`
- Test: `webapp/backend/tests/test_spa_seo.py`

- [ ] **Step 1: Write the failing test**

`test_spa_seo.py` has a `_make_trace(...)` helper (defaults `platform="claude-code"`), inserts via `spa_client.app.state.session_maker`, and GETs the SPA path, asserting on `body`. Mirror the existing `test_trace_head_names_codex_agent`:

```python
@pytest.mark.asyncio
async def test_trace_head_names_cursor_agent(spa_client):
    trace = _make_trace(
        short_id="cursor01", owner_login="alice", platform="cursor",
        message_count=7,
    )
    async with spa_client.app.state.session_maker() as session:
        session.add(trace)
        await session.commit()

    body = spa_client.get("/cursor01").text
    assert "Cursor session by @alice" in body
    assert "Claude Code session" not in body
    assert "Codex CLI session" not in body
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/test_spa_seo.py::test_trace_head_names_cursor_agent -v`
Expected: FAIL — `_agent_label("cursor")` currently returns "Claude Code", so `assert "Claude Code session" not in body` fails.

- [ ] **Step 3: Add the Cursor branch to `_agent_label`**

In `webapp/backend/app/api/spa_seo.py`, replace `_agent_label` (lines 200-204):

```python
def _agent_label(platform: str | None) -> str:
    """Human label for the producing agent, derived from the trace platform."""
    if platform and platform.lower().startswith("codex"):
        return "Codex CLI"
    if platform and platform.lower() == "cursor":
        return "Cursor"
    return "Claude Code"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/test_spa_seo.py -v`
Expected: PASS (new Cursor test; existing Claude/Codex assertions still hold).

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/api/spa_seo.py webapp/backend/tests/test_spa_seo.py
git commit -m "backend: name Cursor in per-trace SEO head"
```

---

## Task 4: End-to-end ingest of a Cursor bundle (regression guard)

Prove a `platform=cursor` tar with a Cursor-shaped main and a UUID subagent ingests, persists the right platform + agent summary + message count, and serves back.

**Files:**
- Test: `webapp/backend/tests/test_ingest.py` (extend; reuse `make_bundle`, `COMMON_HEADERS`, `_mock_alice_pr1`, `Trace`, `select`)

- [ ] **Step 1: Write the test**

Mirror `test_ingest_codex_platform_and_uuid_agent`, but with a Cursor-shaped main and a `cursor` platform header:

```python
@pytest.mark.asyncio
async def test_ingest_cursor_platform_and_uuid_agent(client, respx_mock):
    _mock_alice_pr1(respx_mock)

    uuid = "09fbacda-2df4-47a7-a12e-2534c6d55047"
    main = (
        b'{"role":"user","message":{"content":[{"type":"text",'
        b'"text":"<user_query>do a sweep</user_query>"}]}}\n'
        b'{"role":"assistant","message":{"content":['
        b'{"type":"text","text":"on it"},'
        b'{"type":"tool_use","name":"Subagent","input":{"subagent_type":"explore",'
        b'"description":"Bug sweep","prompt":"Find bugs"}}]}}\n'
    )
    body = make_bundle({
        "main.jsonl": main,
        f"agents/{uuid}.jsonl": (
            b'{"role":"user","message":{"content":[{"type":"text","text":"Find bugs"}]}}\n'
        ),
        f"agents/{uuid}.meta.json": (
            b'{"agentType":"explore","description":"Bug sweep","toolUseId":"cursor-agent-0"}'
        ),
    })
    headers = {**COMMON_HEADERS, "X-Vibeshub-Platform": "cursor"}
    r = client.post("/api/ingest", content=body, headers=headers)
    assert r.status_code == 201, r.text
    short_id = r.json()["short_id"]

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (
            await session.execute(select(Trace).where(Trace.short_id == short_id))
        ).scalar_one()

    assert trace.platform == "cursor"
    assert trace.message_count == 2  # 1 assistant text block + 1 tool_use block
    assert trace.agent_count == 1
    assert trace.agents[0]["agent_id"] == uuid
    assert trace.agents[0]["tool_use_id"] == "cursor-agent-0"
```

- [ ] **Step 2: Run test to verify it passes (after Tasks 1-3)**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/test_ingest.py::test_ingest_cursor_platform_and_uuid_agent -v`
Expected: PASS once Tasks 1-2 have landed (Task 1 makes the UUID member accepted; Task 2 makes `message_count == 2`). If run before Task 2, FAILS the `message_count == 2` assertion (returns 0).

- [ ] **Step 3: No new implementation**

Pure integration guard over Tasks 1-2; no code change.

- [ ] **Step 4: Run the full backend suite**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest -q`
Expected: PASS (entire suite green).

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/tests/test_ingest.py
git commit -m "backend: end-to-end test for Cursor platform + UUID subagent ingest"
```

---

## Self-Review (completed during authoring)

- **Spec coverage (§5):** UUID subagent ids → Task 1 (regression test + comment; regex already accepts them from the Codex work); Cursor `message_count` → Task 2 (dedicated branch, because raw Cursor is `role`-based, not `type`-based); source-aware SEO → Task 3; `platform=cursor` round-trip with no migration (free-text `String(32)` columns) → Task 4. No `source_format` change is needed on the CLI ingest path (raw Cursor is stored as `main.jsonl` and converted client-side); the web `/api/uploads` path is covered in the frontend plan.
- **Placeholders:** none — every step has the exact code/edit and the exact `../../env/bin/pytest` command.
- **Type consistency:** `_looks_like_cursor(list[bytes]) -> bool`, `_count_cursor(list[bytes]) -> int`, `_agent_label(platform: str | None) -> str`; `count_messages` keeps its `(bytes) -> int` signature; the synthetic subagent `tool_use_id` is `"cursor-agent-<ordinal>"`, matching the frontend converter and plugin linker contracts in the other two plans.
