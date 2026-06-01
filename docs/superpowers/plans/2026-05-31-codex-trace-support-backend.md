# Codex Trace Support — Backend Implementation Plan (Phase A of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the vibeshub backend store and serve OpenAI Codex CLI traces with the same fidelity as Claude Code traces, with no new render model and no schema migration.

**Architecture:** The backend is a dumb blob store: it stores the raw redacted transcript JSONL and serves it back unchanged. Codex support needs only four additive touches: (1) accept Codex UUID subagent ids in the bundle validator, (2) count Codex-shaped messages, (3) make the per-trace SEO/OG card name the right agent, (4) a regression test proving a `platform=codex` bundle with a UUID subagent round-trips. `platform` and `source_format` are already free-text `String(32)` columns, so no Alembic migration is required.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy (async), pytest. Tests run from `webapp/backend/` via the repo-root venv: `../../env/bin/pytest`.

**Ships independently:** Yes. These changes are backwards-compatible (Claude traces are unaffected) and must land/deploy *before* the plugin starts emitting Codex traces (see the frontend and plugin plans).

**Spec:** `docs/superpowers/specs/2026-05-31-codex-trace-support-design.md` (§5).

---

## File Structure

- Modify: `webapp/backend/app/redact/bundle.py` — widen the agent-id regexes (one shared constant).
- Modify: `webapp/backend/app/message_count.py` — add a Codex-shape branch.
- Modify: `webapp/backend/app/api/spa_seo.py` — per-trace head names the actual agent.
- Test: `webapp/backend/tests/test_bundle_unpack.py`, `tests/test_message_count.py`, `tests/test_spa_seo.py`, `tests/test_ingest.py` (extend each).

No new files, no models change, no migration.

---

## Task 1: Accept Codex UUID subagent ids in the bundle validator

Codex subagent ids are thread UUIDs (e.g. `019e7f09-bca2-7150-ac2b-54f7b075a2ea`), not Claude's `a<16hex>`. The bundle validator currently rejects them.

**Files:**
- Modify: `webapp/backend/app/redact/bundle.py:25-27`
- Test: `webapp/backend/tests/test_bundle_unpack.py`

- [ ] **Step 1: Write the failing test**

Add to `webapp/backend/tests/test_bundle_unpack.py` (it already has a `_make_tar` helper and imports `unpack_and_redact`; reuse them):

```python
def test_unpack_accepts_codex_uuid_agent():
    uuid = "019e7f09-bca2-7150-ac2b-54f7b075a2ea"
    tar = _make_tar({
        "main.jsonl": b'{"type":"session_meta","payload":{"id":"019e7ed1"}}\n',
        f"agents/{uuid}.jsonl": b'{"type":"session_meta","payload":{"id":"019e7f09"}}\n',
        f"agents/{uuid}.meta.json": (
            b'{"agentType":"default","description":"Godel","toolUseId":"call_x"}'
        ),
    })
    bundle = unpack_and_redact(tar, max_total_bytes=10_000)
    assert len(bundle.agents) == 1
    assert bundle.agents[0].agent_id == uuid
    assert bundle.agents[0].meta["toolUseId"] == "call_x"


def test_unpack_still_rejects_traversal_agent_name():
    tar = _make_tar({
        "main.jsonl": b"{}\n",
        "agents/../../etc/passwd.jsonl": b"{}\n",
    })
    with pytest.raises(BundleError):
        unpack_and_redact(tar, max_total_bytes=10_000)
```

If `BundleError` is not already imported at the top of the test file, add it:
`from app.redact.bundle import unpack_and_redact, BundleError`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/test_bundle_unpack.py::test_unpack_accepts_codex_uuid_agent -v`
Expected: FAIL — the UUID member is rejected as a disallowed tar member (`BundleError`), so `unpack_and_redact` raises instead of returning a bundle.

- [ ] **Step 3: Widen the agent-id regexes**

In `webapp/backend/app/redact/bundle.py`, replace lines 25-27:

```python
AGENT_ID_RE = re.compile(r"^a[0-9a-f]{16}$")
AGENT_JSONL_RE = re.compile(r"^agents/(a[0-9a-f]{16})\.jsonl$")
AGENT_META_RE = re.compile(r"^agents/(a[0-9a-f]{16})\.meta\.json$")
```

with (a single shared sub-pattern that accepts both the Claude `a<16hex>` form and a Codex UUID, and nothing else — so path traversal like `../../etc/passwd` still fails):

```python
# Claude Code subagent id (a<16hex>) OR Codex thread UUID (8-4-4-4-12 hex).
_AGENT_ID = r"(?:a[0-9a-f]{16}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"
AGENT_ID_RE = re.compile(rf"^{_AGENT_ID}$")
AGENT_JSONL_RE = re.compile(rf"^agents/({_AGENT_ID})\.jsonl$")
AGENT_META_RE = re.compile(rf"^agents/({_AGENT_ID})\.meta\.json$")
```

Leave `LOCAL_AGENT_JSONL_RE` / `LOCAL_AGENT_META_RE` (lines 32-33) unchanged — those are the Claude-only on-disk `agent-<id>` naming used by the loose-files web path, which Codex does not use. The redundant `AGENT_ID_RE.match` re-checks inside `unpack_and_redact` now use the widened `AGENT_ID_RE`, so they stay consistent automatically.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/test_bundle_unpack.py -v`
Expected: PASS (the two new tests plus all existing `test_bundle_unpack.py` tests).

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/redact/bundle.py webapp/backend/tests/test_bundle_unpack.py
git commit -m "backend: accept Codex UUID subagent ids in bundle validator"
```

---

## Task 2: Count Codex-shaped messages

`count_messages` hard-assumes the Claude shape (`type=="assistant"` with `message.content[]`) and returns 0 for a Codex rollout, which would show "0 messages" in list views. Add a Codex branch.

**Files:**
- Modify: `webapp/backend/app/message_count.py`
- Test: `webapp/backend/tests/test_message_count.py`

- [ ] **Step 1: Write the failing test**

Add to `webapp/backend/tests/test_message_count.py` (it imports `count_messages` and has a `_lines(*records)` helper that JSON-joins records into UTF-8 JSONL bytes):

```python
def test_codex_counts_assistant_messages_and_tool_calls():
    data = _lines(
        {"type": "session_meta", "payload": {"id": "019e7ed1", "cwd": "/x"}},
        {"type": "turn_context", "payload": {"model": "gpt-5.5"}},
        {"type": "event_msg", "payload": {"type": "user_message", "message": "hi"}},
        {"type": "response_item",
         "payload": {"type": "message", "role": "assistant",
                     "content": [{"type": "output_text", "text": "on it"}]}},
        {"type": "response_item",
         "payload": {"type": "function_call", "name": "exec_command",
                     "arguments": "{\"cmd\":\"ls\"}", "call_id": "call_1"}},
        {"type": "response_item",
         "payload": {"type": "function_call_output", "call_id": "call_1",
                     "output": "Process exited with code 0\nOutput:\nfoo"}},
    )
    # 1 assistant message + 1 function_call = 2 rendered messages.
    assert count_messages(data) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/test_message_count.py::test_codex_counts_assistant_messages_and_tool_calls -v`
Expected: FAIL — returns `0` (no `type=="assistant"` records), `assert 0 == 2`.

- [ ] **Step 3: Add the Codex branch**

In `webapp/backend/app/message_count.py`, add these two helpers above `count_messages`, and dispatch to the Codex one when the file is a Codex envelope:

```python
def _looks_like_codex(lines: list[bytes]) -> bool:
    if not lines:
        return False
    try:
        rec = json.loads(lines[0])
    except ValueError:
        return False
    return (
        isinstance(rec, dict)
        and rec.get("type") == "session_meta"
        and isinstance(rec.get("payload"), dict)
        and "id" in rec["payload"]
    )


def _count_codex(lines: list[bytes]) -> int:
    count = 0
    for raw in lines:
        try:
            rec = json.loads(raw)
        except ValueError:
            continue
        if not isinstance(rec, dict) or rec.get("type") != "response_item":
            continue
        payload = rec.get("payload")
        if not isinstance(payload, dict):
            continue
        ptype = payload.get("type")
        if ptype == "message" and payload.get("role") == "assistant":
            count += 1
        elif ptype == "function_call":
            count += 1
    return count
```

Then change the top of `count_messages` (currently it loops over `jsonl_bytes.splitlines()` directly) to compute the stripped non-empty lines once and dispatch:

```python
def count_messages(jsonl_bytes: bytes) -> int:
    """Count rendered messages (assistant text blocks + tool calls) in a
    trace JSONL. Unparseable lines are skipped, matching the parser."""
    lines = [raw.strip() for raw in jsonl_bytes.splitlines() if raw.strip()]
    if _looks_like_codex(lines):
        return _count_codex(lines)
    emitted: set[tuple[str, int, str]] = set()
    count = 0
    for line in lines:
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        # ... existing Claude logic unchanged, but iterate `lines` not
        # `jsonl_bytes.splitlines()`, and drop the now-redundant
        # `if not line: continue` (lines are already stripped & non-empty) ...
```

Keep the rest of the existing Claude body verbatim (the `rec.get("type") != "assistant"` filter through `count += 1`), just iterating the pre-stripped `lines`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/test_message_count.py -v`
Expected: PASS (the new Codex test plus all existing Claude-shape tests).

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/message_count.py webapp/backend/tests/test_message_count.py
git commit -m "backend: count Codex-shaped messages (response_item assistant + tool calls)"
```

---

## Task 3: Per-trace SEO/OG card names the actual agent

The per-trace link-preview head hardcodes "Claude Code session", so a shared Codex trace is mislabeled. Make it agent-aware. (Leave the aggregate user/repo/PR heads and the `/vibeviewer` static copy unchanged — those are SEO-tuned for the "Claude Code trace viewer" ad keyword and list mixed traces.)

**Files:**
- Modify: `webapp/backend/app/api/spa_seo.py:229-233`
- Test: `webapp/backend/tests/test_spa_seo.py`

- [ ] **Step 1: Write the failing test**

`test_spa_seo.py` has a `_make_trace(...)` helper (defaults `platform="claude-code"`), inserts via `client.app.state.session_maker`, and GETs the SPA path through a `spa_client` fixture, asserting on `resp.text`. Add a Codex variant mirroring the existing trace-head test:

```python
@pytest.mark.asyncio
async def test_trace_head_names_codex_agent(spa_client):
    trace = _make_trace(
        short_id="codex01", owner_login="alice", platform="codex",
        message_count=7,
    )
    async with spa_client.app.state.session_maker() as session:
        session.add(trace)
        await session.commit()

    body = spa_client.get("/codex01").text
    assert "Codex CLI session by @alice" in body
    assert "Claude Code session" not in body
```

If `_make_trace` does not already accept a `platform` kwarg, pass it through to the `Trace(...)` constructor in that helper (the column exists; the helper just needs to forward it).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/test_spa_seo.py::test_trace_head_names_codex_agent -v`
Expected: FAIL — body contains "Claude Code session by @alice" regardless of platform, so `assert "Claude Code session" not in body` fails.

- [ ] **Step 3: Make the trace head agent-aware**

In `webapp/backend/app/api/spa_seo.py`, add a small helper near the other module-level helpers:

```python
def _agent_label(platform: str | None) -> str:
    """Human label for the producing agent, derived from the trace platform."""
    if platform and platform.lower().startswith("codex"):
        return "Codex CLI"
    return "Claude Code"
```

Then in `_render_trace_head` replace lines 229-233:

```python
    desc_parts = [
        f"Claude Code session by @{trace.owner_login}"
        if trace.owner_login
        else "Claude Code session",
        f"{trace.message_count} messages",
    ]
```

with:

```python
    agent = _agent_label(trace.platform)
    desc_parts = [
        f"{agent} session by @{trace.owner_login}"
        if trace.owner_login
        else f"{agent} session",
        f"{trace.message_count} messages",
    ]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/test_spa_seo.py -v`
Expected: PASS (the new Codex test; existing Claude-trace assertions like `"Claude Code session by @alice"` still hold because `_agent_label(None)` / `_agent_label("claude-code")` returns "Claude Code").

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/api/spa_seo.py webapp/backend/tests/test_spa_seo.py
git commit -m "backend: name the actual agent in per-trace SEO head (Codex vs Claude Code)"
```

---

## Task 4: End-to-end ingest of a Codex bundle (regression guard)

Prove a `platform=codex` tar with a UUID subagent ingests, persists the right platform + agent summary, and serves back.

**Files:**
- Test: `webapp/backend/tests/test_ingest.py` (extend; reuse `make_bundle`, `COMMON_HEADERS`, `_mock_alice_pr1`, `Trace`, `select`)

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.asyncio
async def test_ingest_codex_platform_and_uuid_agent(client, respx_mock):
    _mock_alice_pr1(respx_mock)

    uuid = "019e7f09-bca2-7150-ac2b-54f7b075a2ea"
    main = (
        b'{"type":"session_meta","payload":{"id":"019e7ed1","cwd":"/x"}}\n'
        b'{"type":"response_item","payload":{"type":"message","role":"assistant",'
        b'"content":[{"type":"output_text","text":"on it"}]}}\n'
        b'{"type":"response_item","payload":{"type":"function_call",'
        b'"name":"exec_command","arguments":"{\\"cmd\\":\\"ls\\"}","call_id":"c1"}}\n'
    )
    body = make_bundle({
        "main.jsonl": main,
        f"agents/{uuid}.jsonl": b'{"type":"session_meta","payload":{"id":"019e7f09"}}\n',
        f"agents/{uuid}.meta.json": (
            b'{"agentType":"default","description":"Godel","toolUseId":"call_spawn"}'
        ),
    })
    headers = {**COMMON_HEADERS, "X-Vibeshub-Platform": "codex"}
    r = client.post("/api/ingest", content=body, headers=headers)
    assert r.status_code == 201, r.text
    short_id = r.json()["short_id"]

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (
            await session.execute(select(Trace).where(Trace.short_id == short_id))
        ).scalar_one()

    assert trace.platform == "codex"
    assert trace.message_count == 2  # 1 assistant msg + 1 function_call
    assert trace.agent_count == 1
    assert trace.agents[0]["agent_id"] == uuid
    assert trace.agents[0]["tool_use_id"] == "call_spawn"
```

- [ ] **Step 2: Run test to verify it fails (before Tasks 1-2) / passes (after)**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/test_ingest.py::test_ingest_codex_platform_and_uuid_agent -v`
Expected: With Tasks 1-2 already landed, this PASSES. (If run before Task 1, it FAILS at ingest with a 400 disallowed-member error; before Task 2, it FAILS the `message_count == 2` assertion.)

- [ ] **Step 3: No new implementation**

This task is a pure integration guard over Tasks 1-2; no code change. If it fails, the failure points at which prior task regressed.

- [ ] **Step 4: Run the full backend suite**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest -q`
Expected: PASS (entire suite green).

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/tests/test_ingest.py
git commit -m "backend: end-to-end test for Codex platform + UUID subagent ingest"
```

---

## Self-Review (completed during authoring)

- **Spec coverage (§5):** agent-id regex relax → Task 1; Codex `message_count` → Task 2; source-aware SEO → Task 3 (scoped to the per-trace head, since the aggregate/static copy is intentionally SEO-tuned per the "Claude Code trace viewer" ad keyword); accept `platform=codex` (no migration; columns are free-text `String(32)`) → verified end-to-end in Task 4. `source_format="codex"` is **not** needed on the CLI ingest path (raw Codex is stored as `main.jsonl` and rendered client-side); the web `/api/uploads` `source_format` handling is addressed in the frontend plan.
- **Placeholders:** none — every step has the exact code/edit and the exact `../../env/bin/pytest` command.
- **Type consistency:** `_agent_label(platform: str | None)`, `_looks_like_codex(list[bytes])`, `_count_codex(list[bytes])` are used consistently; `count_messages` keeps its `(bytes) -> int` signature.
