# Converted Trace Blobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store a server-side Claude-shaped converted copy alongside the raw blob for codex/cursor uploads, serve and digest from the converted copy, and delete the frontend render-time converters.

**Architecture:** Ingest (`create_or_update_trace`) sniffs imported formats after redaction, stores `converted.jsonl` (and `agents/<id>.converted.jsonl`) next to the untouched raw blobs, sets `Trace.source_format`, and feeds the converted bytes to the digest. A new `GET /api/traces/{id}/session` endpoint serves converted-or-raw to the viewer (with an in-memory conversion fallback for pre-existing traces); `/raw` keeps serving the native original. `cursorExport.ts` is ported to `app/cursor_convert.py` (goldens captured from the frontend converter before deletion), then `codexExport.ts`/`cursorExport.ts` die and `sessionFromRaw.ts` becomes a pass-through (plus the terminal safety net).

**Tech Stack:** FastAPI + SQLAlchemy + pytest backend (`env/bin/pytest` from `webapp/backend` — repo-root `env/`, NOT the `.venv`); React + vitest frontend (`npm test` in `webapp/frontend`).

---

## Environment rules (read before every task)

- Backend tests: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest <args>`. The venv is at the **repo root** `env/`, not `webapp/backend/.venv`.
- Frontend tests: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test`.
- Other sessions switch branches in this same checkout. **Every commit must verify the branch in the same shell command**, e.g.
  `git branch --show-current | grep -qx converted-trace-blobs && git commit -m "..."`.
- Never use em-dashes ("—") in user-facing strings (UI copy, API error messages). Code comments/docstrings are fine but avoid them anyway.
- Do NOT use a git worktree: the repo-root `env/` venv and `webapp/frontend/node_modules` are checkout-local, so tests only run in this checkout. The per-commit branch check is the mitigation for the shared checkout.

## Facts discovered during planning (trust these; they correct the spec in places)

1. `Trace.source_format` (`app/storage/models.py:74-76`) currently only ever holds `"terminal"` (set in `app/api/uploads.py:87`) or NULL. Codex/cursor traces are identified by the `platform` column only. So ingest must START sniffing+setting `source_format`, and the serve path must ALSO sniff legacy rows whose `source_format` is NULL (otherwise old codex traces break once `codexExport.ts` dies).
2. `compute_digest` (`app/agents/digest/pipeline.py:39`) does not read blobs; `trace_service.py:200-210` passes bytes in. "Digest reads the converted blob" therefore means: `trace_service` passes the converted bytes it just produced.
3. `app/api/spa_seo.py` does NOT sniff raw blob bytes (only branches on the `platform` DB column in `_agent_label`, lines 200-206). Nothing to change there; note it in the PR.
4. `app/message_count.py` sniffs raw codex/cursor bytes to compute `message_count`. Leave it unchanged: `_count_codex` counts one per assistant message payload while the converter emits one record per content block, so counting converted bytes could drift from counts on already-stored traces. Note this in the PR ("left as-is deliberately").
5. `/api/traces/{id}/raw` (`traces.py:397`) is BOTH the viewer fetch and the "Raw JSONL" download link today. We keep `/raw` = native original and add `/session` for the viewer.
6. Pre-existing bug, in scope because converted subagent serving needs it: `traces.py:36` `_AGENT_ID_RE = ^a[0-9a-f]{16}$` rejects the UUID-shaped agent ids that codex/cursor bundles use (and that `app/redact/bundle.py:26` accepts at ingest), so `GET /agents/{uuid}` 404s. Fix by reusing `bundle.AGENT_ID_RE`.
7. Pre-existing gap: `delete_trace` (`traces.py:509-516`) never deletes `source_export.txt`. We are editing that key list anyway; add it.
8. Terminal traces are converted client-side at upload (`VibeViewer.tsx:189-207`) and stored Claude-shaped; `sessionFromRaw.ts`'s terminal branch is a defensive net only. Keep it.
9. Conversion happens AFTER redaction (decision per spec): `create_or_update_trace` receives already-redacted bytes in `UnpackedBundle`; converting those is correct and simplest.
10. Real codex rollouts for end-to-end verification: `~/.codex/sessions/2026/**/*.jsonl` (73 files). They are private local data: convert into `/tmp` only, never commit, never upload.

## File structure

Backend (webapp/backend):
- Create: `app/cursor_convert.py` (port of cursorExport.ts; mirrors `app/codex_convert.py` structure)
- Create: `app/convert.py` (sniff/convert dispatch shared by ingest + serving)
- Create: `tests/test_cursor_convert.py`, `tests/test_convert.py`, `tests/test_serve_session.py`
- Create: `tests/fixtures/cursor/{transcript,transcript_subagent,kitchen_sink}.jsonl` + `.golden.jsonl` (goldens captured from cursorExport.ts BEFORE it is deleted)
- Modify: `app/api/trace_service.py` (store converted copies, sniff source_format, pass converted bytes to digest)
- Modify: `app/agents/digest/pipeline.py` (drop the codex conversion block), `app/agents/digest/distill.py` (cursor tool names), `app/agents/digest/README.md` (flow step 2)
- Modify: `app/api/traces.py` (new `/session` endpoint, agent endpoint converted logic, agent-id regex, delete keys)
- Modify: `app/codex_convert.py` + `tests/test_codex_convert.py` (docstrings: parity contract -> determinism pin)
- Modify: `tests/agents/digest/test_pipeline.py`, `tests/agents/digest/test_distill.py`, `tests/test_trace_service.py`, `tests/api/test_traces_digest.py`

Frontend (webapp/frontend):
- Delete: `src/components/trace/codexExport.ts`, `src/components/trace/cursorExport.ts`, `src/tests/trace/codexExport.test.ts`, `src/tests/trace/cursorExport.test.ts`, fixtures `sample-codex.jsonl`, `sample-codex-subagent.jsonl`, `sample-cursor.jsonl`, `sample-cursor-subagent.jsonl`
- Create: `src/tests/trace/sessionFromRaw.test.ts`, fixtures `sample-codex-converted.jsonl`, `sample-cursor-converted.jsonl`
- Modify: `src/api.ts` (fetchSessionJsonl), `src/routes/TraceView.tsx` (fetch swap), `src/components/trace/sessionFromRaw.ts` (simplify)

---

### Task 1: Feature branch

- [ ] **Step 1: Create the branch**

```bash
cd /Users/bhavya/git/vibeshub && git checkout main && git pull --ff-only && git checkout -b converted-trace-blobs && git branch --show-current
```

Expected output: `converted-trace-blobs`.

---

### Task 2: Cursor fixtures + goldens captured from the live frontend converter

This MUST happen before any frontend deletion: the goldens are mechanical captures of `cursorToJsonl`.

**Files:**
- Create: `webapp/backend/tests/fixtures/cursor/transcript.jsonl` (copy of frontend `sample-cursor.jsonl`)
- Create: `webapp/backend/tests/fixtures/cursor/transcript_subagent.jsonl` (copy of `sample-cursor-subagent.jsonl`)
- Create: `webapp/backend/tests/fixtures/cursor/kitchen_sink.jsonl` (new, edge cases)
- Create (generated): the three `*.golden.jsonl` next to them
- Temporary: `webapp/frontend/src/tests/trace/__captureCursorGoldens.test.ts` (deleted after running)

- [ ] **Step 1: Copy the real-shape fixtures**

```bash
mkdir -p /Users/bhavya/git/vibeshub/webapp/backend/tests/fixtures/cursor
cp /Users/bhavya/git/vibeshub/webapp/frontend/src/tests/fixtures/sample-cursor.jsonl /Users/bhavya/git/vibeshub/webapp/backend/tests/fixtures/cursor/transcript.jsonl
cp /Users/bhavya/git/vibeshub/webapp/frontend/src/tests/fixtures/sample-cursor-subagent.jsonl /Users/bhavya/git/vibeshub/webapp/backend/tests/fixtures/cursor/transcript_subagent.jsonl
```

- [ ] **Step 2: Write the kitchen-sink fixture**

Write `webapp/backend/tests/fixtures/cursor/kitchen_sink.jsonl` with EXACTLY this content (it exercises: timestamp+query envelope with +5:30 offset, thinking, Task vs Subagent agent-id assignment, ReadFile path input, Shell, AwaitShell, blank line, invalid JSON line, string content skipped, unknown role ignored, unknown block type dropped, non-object block skipped, timestamp-without-query stripping, multi-text-block join):

```
{"role":"user","message":{"content":[{"type":"text","text":"<timestamp>Monday, Jun 1, 2026, 9:05 AM (UTC+5:30)</timestamp>\n<user_query>\nWire up the settings page.\n</user_query>"}]}}

{"role":"assistant","message":{"content":[{"type":"thinking","thinking":"Plan: read the router first."},{"type":"text","text":"Looking at the routes."},{"type":"tool_use","name":"Task","input":{"subagent_type":"explore","description":"Map the router","prompt":"Find route definitions."}}]}}
not json at all
{"role":"assistant","message":{"content":[{"type":"tool_use","name":"ReadFile","input":{"path":"/repo/src/router.tsx","limit":120}},{"type":"image","src":"x.png"},"stray-string"]}}
{"role":"assistant","message":{"content":[{"type":"tool_use","name":"Shell","input":{"command":"npm run lint"}},{"type":"tool_use","name":"AwaitShell","input":{"id":"sh-1"}}]}}
{"role":"system","message":{"content":[{"type":"text","text":"ignored"}]}}
{"role":"user","message":{"content":"plain string content"}}
{"role":"user","message":{"content":[{"type":"text","text":"<timestamp>Monday, Jun 1, 2026, 9:20 AM (UTC+5:30)</timestamp> Now add tests."},{"type":"text","text":"Cover the redirect case."}]}}
{"role":"assistant","message":{"content":[{"type":"tool_use","name":"Subagent","input":{"subagent_type":"test-writer","description":"Write settings tests","prompt":"Add tests."}}]}}
{"role":"assistant","message":{"content":[{"type":"text","text":"Done. Lint and tests pass."}]}}
```

(Line 2 is intentionally blank; line 3 is intentionally invalid JSON.)

- [ ] **Step 3: Write the temporary golden-capture vitest test**

`webapp/frontend/src/tests/trace/__captureCursorGoldens.test.ts`:

```ts
// TEMPORARY: captures cursorToJsonl output as backend goldens. Delete after running.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cursorToJsonl } from "../../components/trace/cursorExport";

const DIR = "/Users/bhavya/git/vibeshub/webapp/backend/tests/fixtures/cursor";

describe("capture cursor goldens", () => {
  const inputs = readdirSync(DIR).filter(
    (n) => n.endsWith(".jsonl") && !n.endsWith(".golden.jsonl"),
  );
  for (const name of inputs) {
    it(`captures ${name}`, () => {
      const out = cursorToJsonl(readFileSync(join(DIR, name), "utf8"));
      expect(out.length).toBeGreaterThan(0);
      writeFileSync(join(DIR, name.replace(/\.jsonl$/, ".golden.jsonl")), out);
    });
  }
});
```

- [ ] **Step 4: Run it and sanity-check the goldens**

```bash
cd /Users/bhavya/git/vibeshub/webapp/frontend && npx vitest run src/tests/trace/__captureCursorGoldens.test.ts
head -c 200 /Users/bhavya/git/vibeshub/webapp/backend/tests/fixtures/cursor/kitchen_sink.golden.jsonl
```

Expected: 3 tests pass; the golden's first record is `{"type":"cursor-meta","source":"cursor","uuid":"cursor-rec-0",...}`. Also verify in `kitchen_sink.golden.jsonl`: the Task tool_use has `"id":"cursor-agent-0"`, the Subagent has `"id":"cursor-agent-1"`, the first user record's timestamp is `2026-06-01T03:35:00.000Z` (9:05 IST = 03:35 UTC) and content is `Wire up the settings page.`, and uuids run `cursor-rec-0..N` with no gaps. If any of that is off, the fixture (not the converter) is wrong; fix the fixture and re-run.

- [ ] **Step 5: Delete the scratch test and commit the fixtures**

```bash
rm /Users/bhavya/git/vibeshub/webapp/frontend/src/tests/trace/__captureCursorGoldens.test.ts
cd /Users/bhavya/git/vibeshub && git add webapp/backend/tests/fixtures/cursor/ && git branch --show-current | grep -qx converted-trace-blobs && git commit -m "test: add cursor fixtures with goldens captured from cursorExport.ts"
```

---

### Task 3: `app/cursor_convert.py` (TDD)

**Files:**
- Create: `webapp/backend/app/cursor_convert.py`
- Test: `webapp/backend/tests/test_cursor_convert.py`

- [ ] **Step 1: Write the failing tests**

`webapp/backend/tests/test_cursor_convert.py`:

```python
"""Tests for app.cursor_convert, the backend port of the frontend's
former cursorExport.ts converter (deleted when conversion moved
server-side to ingest).

The *.golden.jsonl fixtures are the actual output of the frontend
converter (cursorToJsonl) over the matching *.jsonl transcript, captured
via a one-shot vitest run before that converter was removed. They pin
determinism: digest chapter anchor_uuids reference the synthetic
cursor-rec-<n> uuids and the viewer resolves them against the same
converted jsonl this module produces, so record order and uuid
assignment must never drift.
"""
import json
from pathlib import Path

import pytest

from app.cursor_convert import cursor_to_claude_jsonl, looks_like_cursor

FIXTURES = Path(__file__).parent / "fixtures" / "cursor"


def _records(blob: bytes) -> list[dict]:
    return [json.loads(line) for line in blob.splitlines() if line.strip()]


@pytest.mark.parametrize(
    "name", ["transcript", "transcript_subagent", "kitchen_sink"],
)
def test_conversion_matches_golden(name):
    raw = (FIXTURES / f"{name}.jsonl").read_bytes()
    golden = (FIXTURES / f"{name}.golden.jsonl").read_bytes()
    assert _records(cursor_to_claude_jsonl(raw)) == _records(golden)


def test_uuid_sequence_is_positional():
    # Anchors only resolve because uuids are assigned by record creation
    # order: cursor-rec-<n>, no gaps, no reordering.
    raw = (FIXTURES / "kitchen_sink.jsonl").read_bytes()
    recs = _records(cursor_to_claude_jsonl(raw))
    assert [r["uuid"] for r in recs] == [
        f"cursor-rec-{i}" for i in range(len(recs))
    ]


def test_user_envelope_is_stripped():
    raw = (FIXTURES / "transcript.jsonl").read_bytes()
    recs = _records(cursor_to_claude_jsonl(raw))
    users = [r for r in recs if r["type"] == "user"]
    assert users[0]["message"]["content"] == (
        "Review the frontend for likely bugs."
    )
    assert users[0]["timestamp"] == "2026-06-04T02:30:00.000Z"


def test_task_and_subagent_get_deterministic_agent_ids():
    raw = (FIXTURES / "kitchen_sink.jsonl").read_bytes()
    recs = _records(cursor_to_claude_jsonl(raw))
    tool_uses = [
        b
        for r in recs if r["type"] == "assistant"
        for b in r["message"]["content"] if b["type"] == "tool_use"
    ]
    agent_ids = [
        b["id"] for b in tool_uses if b["name"] in ("Task", "Subagent")
    ]
    assert agent_ids == ["cursor-agent-0", "cursor-agent-1"]


def test_looks_like_cursor_accepts_transcript():
    assert looks_like_cursor((FIXTURES / "transcript.jsonl").read_bytes())


def test_looks_like_cursor_rejects_claude_and_codex():
    claude = (
        Path(__file__).parent / "agents" / "digest" / "fixtures"
        / "short.jsonl"
    )
    assert not looks_like_cursor(claude.read_bytes())
    codex = Path(__file__).parent / "fixtures" / "codex" / "rollout.jsonl"
    assert not looks_like_cursor(codex.read_bytes())


def test_looks_like_cursor_rejects_garbage():
    assert not looks_like_cursor(b"")
    assert not looks_like_cursor(b"not json\n")
    # content must be a block list, not a string
    assert not looks_like_cursor(
        b'{"role":"user","message":{"content":"x"}}\n'
    )
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/test_cursor_convert.py -x -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.cursor_convert'`.

- [ ] **Step 3: Implement the converter**

`webapp/backend/app/cursor_convert.py`. This is a line-faithful port of `cursorExport.ts` (read it side by side; it still exists at this point). The `_s` helper is reused from `codex_convert` (same `String(x ?? "")` coercion).

```python
"""Convert raw Cursor agent transcripts to Claude-shaped JSONL.

Python port of the frontend's former cursorExport.ts (deleted when
conversion moved server-side to ingest). Pure: bytes in, bytes out,
no I/O.

Cursor records are already close to canonical:
{ role, message: { content: [blocks] } }. The conversion adds a
synthetic top-level uuid per record, emits a cursor-meta marker, strips
the <user_query>/<timestamp> envelope from user text, parses coarse
timestamps, and assigns deterministic ids to Task/Subagent tool calls so
subagents nest under their spawning card (link_cursor_subagents in the
plugin uses the same cursor-agent-<n> scheme).

The synthetic uuids (cursor-rec-<n>) are load-bearing: digest chapter
anchor_uuids are generated against this conversion and resolved against
the same converted jsonl the API serves to the viewer. Changing the uuid
scheme or record order breaks chapter jumps on already-digested traces.
tests/test_cursor_convert.py pins the output against goldens captured
from cursorExport.ts before its removal.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta

from app.codex_convert import _s

_TS_RE = re.compile(r"<timestamp>(.*?)</timestamp>", re.DOTALL)
_QUERY_RE = re.compile(r"<user_query>\s*(.*?)\s*</user_query>", re.DOTALL)
_CURSOR_TS_RE = re.compile(
    r"([A-Za-z]+ \d{1,2}, \d{4}),?\s+(\d{1,2}:\d{2})\s*([AaPp][Mm])"
    r"\s*\(UTC([+-]\d{1,2})(?::?(\d{2}))?\)"
)


def looks_like_cursor(blob: bytes) -> bool:
    """True when the first line is a Cursor transcript record.

    Cursor records carry no top-level type (Claude/Codex/terminal records
    do), just { role, message: { content: [...] } }. Matches the former
    looksLikeCursor in cursorExport.ts and _looks_like_cursor in
    message_count.py.
    """
    nl = blob.find(b"\n")
    first = (blob if nl == -1 else blob[:nl]).strip()
    if not first:
        return False
    try:
        rec = json.loads(first)
    except ValueError:
        return False
    return (
        isinstance(rec, dict)
        and "type" not in rec
        and rec.get("role") in ("user", "assistant")
        and isinstance(rec.get("message"), dict)
        and isinstance(rec["message"].get("content"), list)
    )


def _parse_cursor_timestamp(raw: str) -> str | None:
    """"Wednesday, Jun 3, 2026, 7:30 PM (UTC-7)" -> ISO instant.

    Coarse (minute precision, user turns only). None when unparseable.
    """
    m = _CURSOR_TS_RE.search(raw)
    if m is None:
        return None
    date_s, hm, ap, off_h, off_m = m.groups()
    wall = None
    # JS Date.parse accepts both "Jun" and "June"; try both formats.
    for fmt in ("%b %d, %Y %I:%M %p", "%B %d, %Y %I:%M %p"):
        try:
            wall = datetime.strptime(f"{date_s} {hm} {ap.upper()}", fmt)
            break
        except ValueError:
            continue
    if wall is None:
        return None
    sign = -1 if off_h.startswith("-") else 1
    offset_min = int(off_h) * 60 + sign * int(off_m or "0")
    # Wall clock is in (UTC + offset); true UTC = wall - offset.
    utc = wall - timedelta(minutes=offset_min)
    return utc.strftime("%Y-%m-%dT%H:%M:%S") + ".000Z"


def _user_text(content: list) -> str:
    return "\n".join(
        _s(b.get("text"))
        for b in content
        if isinstance(b, dict) and b.get("type") == "text"
    )


def cursor_to_claude_jsonl(blob: bytes) -> bytes:
    """Walk the transcript once and emit Claude-shaped JSONL.

    One content block per assistant record (the canonical parser renders
    only the LAST block of each assistant record) and a unique truthy
    top-level uuid on every record, mirroring the former cursorToJsonl.
    """
    records: list[dict] = []
    rec_n = 0
    agent_n = 0  # ordinal of Task/Subagent dispatches, in document order
    last_ts = ""

    def uuid() -> str:
        nonlocal rec_n
        u = f"cursor-rec-{rec_n}"
        rec_n += 1
        return u

    def push_assistant(block: dict, ts: str) -> None:
        records.append({
            "type": "assistant",
            "uuid": uuid(),
            "timestamp": ts,
            "message": {
                # rec_n was just bumped by uuid(); cursorExport.ts had the
                # same post-increment quirk, so cursor-rec-N carries
                # cursor-msg-N+1.
                "id": f"cursor-msg-{rec_n}",
                "model": None,
                "content": [block],
            },
        })

    records.append({
        "type": "cursor-meta", "source": "cursor", "uuid": uuid(),
        "timestamp": "", "sessionId": None, "cwd": None,
    })

    for raw_line in blob.decode("utf-8", errors="replace").split("\n"):
        line = raw_line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if not isinstance(rec, dict):
            continue
        role = rec.get("role")
        msg = rec.get("message")
        if not isinstance(msg, dict):
            msg = {}
        content = msg.get("content")
        if content is None:
            content = []
        if not isinstance(content, list):
            continue

        if role == "user":
            raw_text = _user_text(content)
            ts_m = _TS_RE.search(raw_text)
            if ts_m:
                iso = _parse_cursor_timestamp(ts_m.group(1))
                if iso:
                    last_ts = iso
            q = _QUERY_RE.search(raw_text)
            clean = (q.group(1) if q else _TS_RE.sub("", raw_text)).strip()
            records.append({
                "type": "user", "uuid": uuid(), "timestamp": last_ts,
                "message": {"content": clean},
            })
            continue

        if role == "assistant":
            for b in content:
                if not isinstance(b, dict):
                    continue
                btype = b.get("type")
                if btype == "text":
                    push_assistant(
                        {"type": "text", "text": _s(b.get("text"))}, last_ts,
                    )
                elif btype == "thinking":
                    push_assistant(
                        {"type": "thinking",
                         "thinking": _s(b.get("thinking"))},
                        last_ts,
                    )
                elif btype == "tool_use":
                    if b.get("name") in ("Task", "Subagent"):
                        tool_id = f"cursor-agent-{agent_n}"
                        agent_n += 1
                    else:
                        tool_id = f"cursor-tool-{rec_n}"
                    inp = b.get("input")
                    push_assistant({
                        "type": "tool_use", "id": tool_id,
                        "name": _s(b.get("name")),
                        "input": inp if inp is not None else {},
                    }, last_ts)

    return (
        "\n".join(
            json.dumps(r, ensure_ascii=False, separators=(",", ":"))
            for r in records
        ) + "\n"
    ).encode("utf-8")
```

- [ ] **Step 4: Run the tests until green**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/test_cursor_convert.py -q`
Expected: all PASS. If a golden mismatch appears, diff the parsed records against the golden record-by-record; the bug is in the port (the golden is the captured truth). Common traps: the `cursor-tool-{rec_n}` id must use `rec_n` BEFORE `push_assistant` bumps it; `cursor-msg-{rec_n}` must use it AFTER; user `message.content` is a plain string; `q.group(1)` vs whole match; offset sign for `UTC+5:30`.

- [ ] **Step 5: Commit**

```bash
cd /Users/bhavya/git/vibeshub && git add webapp/backend/app/cursor_convert.py webapp/backend/tests/test_cursor_convert.py && git branch --show-current | grep -qx converted-trace-blobs && git commit -m "feat: port cursorExport.ts to app/cursor_convert.py"
```

---

### Task 4: Distiller learns Cursor tool names (TDD)

Cursor converted records keep native tool names (`Shell`, `Subagent`, `ReadFile`, `AwaitShell`); the distiller only special-cases the codex-normalized ones today.

**Files:**
- Modify: `webapp/backend/app/agents/digest/distill.py:22-33` (tool sets) and `:186-194` (`_tool_use_to_line` tail)
- Test: `webapp/backend/tests/agents/digest/test_distill.py` (append)

- [ ] **Step 1: Write the failing tests** (append to `tests/agents/digest/test_distill.py`, matching the style of `test_codex_shell_renders_command_like_bash` at line 217)

```python
def test_cursor_shell_renders_command_like_bash():
    # cursor_convert passes Cursor tool names through unchanged; Shell
    # carries the same input keys as Bash, so the command must survive.
    blob = (
        b'{"type":"assistant","uuid":"a1","message":{"content":[{"type":'
        b'"tool_use","id":"cursor-tool-1","name":"Shell","input":{'
        b'"command":"npm test --silent"}}]}}\n'
    )
    out = distill(blob, subagent_blobs={})
    assert "Shell: npm test --silent" in out


def test_cursor_subagent_dispatch_renders_like_task():
    # Cursor's Subagent tool uses the same input keys the Task branch
    # reads (subagent_type, description).
    blob = (
        b'{"type":"assistant","uuid":"a2","message":{"content":[{"type":'
        b'"tool_use","id":"cursor-agent-0","name":"Subagent","input":{'
        b'"subagent_type":"explore","description":"Frontend bug sweep",'
        b'"prompt":"Review the frontend."}}]}}\n'
    )
    out = distill(blob, subagent_blobs={})
    assert "Subagent[explore]: Frontend bug sweep" in out


def test_cursor_readfile_renders_path():
    # Cursor's ReadFile/Read carry path, not file_path; without the path
    # fallback this rendered as a bare tool name.
    blob = (
        b'{"type":"assistant","uuid":"a3","message":{"content":[{"type":'
        b'"tool_use","id":"cursor-tool-2","name":"ReadFile","input":{'
        b'"path":"/repo/src/router.tsx","limit":120}}]}}\n'
    )
    out = distill(blob, subagent_blobs={})
    assert "ReadFile /repo/src/router.tsx" in out
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/agents/digest/test_distill.py -q -k cursor`
Expected: 3 FAIL (`Shell: npm...` missing, `Subagent[explore]` missing, bare `ReadFile` line).

- [ ] **Step 3: Implement** (in `app/agents/digest/distill.py`)

Change the three sets (keep the comment style):

```python
# Tools whose presence we record but whose inputs are scratchpad noise.
# update_plan is Codex's TodoWrite (emitted by codex_convert).
_SCRATCH_TOOLS = {"TodoWrite", "update_plan"}

# Shell-style tools: render as "<name>: <command>". Bash is Claude Code's;
# shell is what codex_convert emits, Shell is Cursor's. All carry the same
# input keys.
_SHELL_TOOLS = {"Bash", "shell", "Shell"}

# Subagent dispatch tools: Claude Code's Task, the spawn_agent calls that
# codex_convert emits, and Cursor's Subagent. All carry the same input
# keys (subagent_type, description).
_SUBAGENT_TOOLS = {"Task", "spawn_agent", "Subagent"}
```

And in `_tool_use_to_line`, after the `if pattern:` branch and before the final `return name`:

```python
    if isinstance(path, str) and path:
        # Cursor's ReadFile/Read carry path instead of file_path.
        return f"{name} {path}"
    return name
```

(`AwaitShell` stays a bare-name label deliberately; its input has no command.)

- [ ] **Step 4: Run the whole distill suite**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/agents/digest/test_distill.py -q`
Expected: all PASS (the path fallback must not break `test_tool_use_collapses_to_one_liner` or the Grep/Glob pattern tests; Grep has `pattern` so it hits the earlier branch).

- [ ] **Step 5: Commit**

```bash
cd /Users/bhavya/git/vibeshub && git add webapp/backend/app/agents/digest/distill.py webapp/backend/tests/agents/digest/test_distill.py && git branch --show-current | grep -qx converted-trace-blobs && git commit -m "feat: teach distiller Cursor tool names (Shell, Subagent, path inputs)"
```

---

### Task 5: `app/convert.py` dispatch module (TDD)

**Files:**
- Create: `webapp/backend/app/convert.py`
- Test: `webapp/backend/tests/test_convert.py`

- [ ] **Step 1: Write the failing tests**

`webapp/backend/tests/test_convert.py`:

```python
"""Tests for app.convert, the imported-format dispatch shared by ingest
(store a converted copy) and serving (legacy in-memory fallback)."""
from pathlib import Path

from app.convert import (
    IMPORTED_FORMATS,
    convert_imported,
    sniff_import_format,
)

FIXTURES = Path(__file__).parent / "fixtures"


def test_sniffs_and_converts_codex():
    raw = (FIXTURES / "codex" / "rollout.jsonl").read_bytes()
    assert sniff_import_format(raw) == "codex"
    converted = convert_imported(raw)
    assert converted is not None
    assert b'"codex-meta"' in converted.splitlines()[0]


def test_sniffs_and_converts_cursor():
    raw = (FIXTURES / "cursor" / "transcript.jsonl").read_bytes()
    assert sniff_import_format(raw) == "cursor"
    converted = convert_imported(raw)
    assert converted is not None
    assert b'"cursor-meta"' in converted.splitlines()[0]


def test_claude_is_not_imported():
    raw = (FIXTURES / "sample-session.jsonl").read_bytes()
    assert sniff_import_format(raw) is None
    assert convert_imported(raw) is None
    assert "claude" not in IMPORTED_FORMATS
    assert "terminal" not in IMPORTED_FORMATS
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/test_convert.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.convert'`.

- [ ] **Step 3: Implement**

`webapp/backend/app/convert.py`:

```python
"""Dispatch imported-format traces (Codex, Cursor) to their converters.

Single sniff/convert entry point shared by ingest (which stores a
Claude-shaped converted copy next to the raw blob) and serving (which
converts in memory for traces uploaded before converted copies existed).
"""
from __future__ import annotations

from app.codex_convert import codex_to_claude_jsonl, looks_like_codex
from app.cursor_convert import cursor_to_claude_jsonl, looks_like_cursor

# source_format values whose traces carry a stored converted.jsonl copy.
IMPORTED_FORMATS = ("codex", "cursor")


def sniff_import_format(blob: bytes) -> str | None:
    """"codex" / "cursor" when the blob is in an imported native format."""
    if looks_like_codex(blob):
        return "codex"
    if looks_like_cursor(blob):
        return "cursor"
    return None


def convert_imported(blob: bytes) -> bytes | None:
    """Claude-shaped JSONL for an imported-format blob, None otherwise."""
    fmt = sniff_import_format(blob)
    if fmt == "codex":
        return codex_to_claude_jsonl(blob)
    if fmt == "cursor":
        return cursor_to_claude_jsonl(blob)
    return None
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/test_convert.py -q`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/bhavya/git/vibeshub && git add webapp/backend/app/convert.py webapp/backend/tests/test_convert.py && git branch --show-current | grep -qx converted-trace-blobs && git commit -m "feat: add imported-format sniff/convert dispatch"
```

---

### Task 6: Ingest stores converted copies; digest consumes them; pipeline stops converting

**Files:**
- Modify: `webapp/backend/app/api/trace_service.py` (after line 122 and the digest call at 200-210)
- Modify: `webapp/backend/app/agents/digest/pipeline.py` (delete lines 46-54 and the import at line 28)
- Modify: `webapp/backend/tests/agents/digest/test_pipeline.py` (the two codex tests at 272-334)
- Modify: `webapp/backend/app/codex_convert.py` (module docstring), `webapp/backend/tests/test_codex_convert.py` (module docstring + test name), `webapp/backend/app/agents/digest/README.md` (flow step 2)
- Test: `webapp/backend/tests/test_trace_service.py` (append)

- [ ] **Step 1: Write the failing trace_service tests** (append to `tests/test_trace_service.py`; add `import json` to its imports). The file's existing helpers `_bundle()` / `_fresh_db()` and the `create_or_update_trace(...)` kwargs shape are at lines 12-46; the new tests use a local kwargs helper:

```python
def _kwargs(**overrides):
    base = dict(
        owner_login="alice", platform="claude-code", plugin_version="0.2.0",
        session_id=None, redaction_count_client=0, repo_full_name=None,
        pr_number=None, pr_url=None, pr_title=None, is_private=False,
    )
    base.update(overrides)
    return base


CODEX_MAIN = (
    b'{"type":"session_meta","payload":{"id":"019e7ed1","cwd":"/x"}}\n'
    b'{"type":"event_msg","payload":{"type":"user_message",'
    b'"message":"Add a greet function"}}\n'
    b'{"type":"response_item","payload":{"type":"message","role":"assistant",'
    b'"content":[{"type":"output_text","text":"on it"}]}}\n'
)

CURSOR_MAIN = (
    b'{"role":"user","message":{"content":[{"type":"text",'
    b'"text":"<user_query>do a sweep</user_query>"}]}}\n'
    b'{"role":"assistant","message":{"content":[{"type":"text",'
    b'"text":"on it"}]}}\n'
)


@pytest.mark.asyncio
async def test_codex_upload_stores_converted_copy_and_source_format(tmp_path):
    SessionLocal = await _fresh_db()
    blob_store = LocalDirBlobStore(tmp_path / "blobs")
    bundle = UnpackedBundle(
        main_bytes=CODEX_MAIN, agents=[], total_redactions=0,
    )

    async with SessionLocal() as session:
        result = await create_or_update_trace(
            session=session, blob_store=blob_store, unpacked=bundle,
            **_kwargs(platform="codex"),
        )
        await session.commit()

    prefix = f"traces/{result.trace.short_id}/"
    assert result.trace.source_format == "codex"
    # The raw original is stored untouched.
    assert await blob_store.get(f"{prefix}main.jsonl") == CODEX_MAIN
    converted = await blob_store.get(f"{prefix}converted.jsonl")
    assert json.loads(converted.splitlines()[0])["type"] == "codex-meta"


@pytest.mark.asyncio
async def test_cursor_upload_stores_converted_copy_and_source_format(tmp_path):
    SessionLocal = await _fresh_db()
    blob_store = LocalDirBlobStore(tmp_path / "blobs")
    bundle = UnpackedBundle(
        main_bytes=CURSOR_MAIN, agents=[], total_redactions=0,
    )

    async with SessionLocal() as session:
        result = await create_or_update_trace(
            session=session, blob_store=blob_store, unpacked=bundle,
            **_kwargs(platform="cursor"),
        )
        await session.commit()

    prefix = f"traces/{result.trace.short_id}/"
    assert result.trace.source_format == "cursor"
    converted = await blob_store.get(f"{prefix}converted.jsonl")
    assert json.loads(converted.splitlines()[0])["type"] == "cursor-meta"


@pytest.mark.asyncio
async def test_claude_upload_gets_no_converted_copy(tmp_path):
    SessionLocal = await _fresh_db()
    blob_store = LocalDirBlobStore(tmp_path / "blobs")

    async with SessionLocal() as session:
        result = await create_or_update_trace(
            session=session, blob_store=blob_store, unpacked=_bundle(),
            **_kwargs(),
        )
        await session.commit()

    prefix = f"traces/{result.trace.short_id}/"
    assert result.trace.source_format is None
    with pytest.raises(FileNotFoundError):
        await blob_store.get(f"{prefix}converted.jsonl")


@pytest.mark.asyncio
async def test_terminal_source_format_is_not_overwritten(tmp_path):
    # Terminal uploads arrive already converted to Claude-shaped jsonl;
    # the sniff must not clobber the caller-provided source_format.
    SessionLocal = await _fresh_db()
    blob_store = LocalDirBlobStore(tmp_path / "blobs")

    async with SessionLocal() as session:
        result = await create_or_update_trace(
            session=session, blob_store=blob_store, unpacked=_bundle(),
            source_format="terminal", **_kwargs(platform="web"),
        )
        await session.commit()

    prefix = f"traces/{result.trace.short_id}/"
    assert result.trace.source_format == "terminal"
    with pytest.raises(FileNotFoundError):
        await blob_store.get(f"{prefix}converted.jsonl")


@pytest.mark.asyncio
async def test_codex_subagent_gets_converted_copy(tmp_path):
    SessionLocal = await _fresh_db()
    blob_store = LocalDirBlobStore(tmp_path / "blobs")
    aid = "019e7f09-bca2-7150-ac2b-54f7b075a2ea"
    bundle = UnpackedBundle(
        main_bytes=CODEX_MAIN,
        agents=[AgentPiece(
            agent_id=aid,
            jsonl_bytes=(
                b'{"type":"session_meta","payload":{"id":"019e7f09"}}\n'
            ),
            meta={
                "agentType": "default", "description": "d",
                "toolUseId": "call_spawn",
            },
        )],
        total_redactions=0,
    )

    async with SessionLocal() as session:
        result = await create_or_update_trace(
            session=session, blob_store=blob_store, unpacked=bundle,
            **_kwargs(platform="codex"),
        )
        await session.commit()

    prefix = f"traces/{result.trace.short_id}/"
    converted = await blob_store.get(
        f"{prefix}agents/{aid}.converted.jsonl"
    )
    assert json.loads(converted.splitlines()[0])["type"] == "codex-meta"


@pytest.mark.asyncio
async def test_digest_receives_converted_bytes(tmp_path, monkeypatch):
    captured = {}

    async def fake_digest(session, trace, *, blob, subagent_blobs):
        captured["blob"] = blob
        captured["subagent_blobs"] = subagent_blobs
        return None

    monkeypatch.setattr("app.agents.digest.compute_digest", fake_digest)

    SessionLocal = await _fresh_db()
    blob_store = LocalDirBlobStore(tmp_path / "blobs")
    aid = "019e7f09-bca2-7150-ac2b-54f7b075a2ea"
    bundle = UnpackedBundle(
        main_bytes=CODEX_MAIN,
        agents=[AgentPiece(
            agent_id=aid,
            jsonl_bytes=(
                b'{"type":"session_meta","payload":{"id":"019e7f09"}}\n'
            ),
            meta={
                "agentType": "default", "description": "d",
                "toolUseId": "call_spawn",
            },
        )],
        total_redactions=0,
    )

    async with SessionLocal() as session:
        await create_or_update_trace(
            session=session, blob_store=blob_store, unpacked=bundle,
            **_kwargs(platform="codex"),
        )
        await session.commit()

    main = captured["blob"]
    assert json.loads(main.splitlines()[0])["type"] == "codex-meta"
    child = captured["subagent_blobs"]["call_spawn"]
    assert json.loads(child.splitlines()[0])["type"] == "codex-meta"
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/test_trace_service.py -q`
Expected: the six new tests FAIL (no converted blob, source_format None for codex); existing ones PASS.

- [ ] **Step 3: Implement in `trace_service.py`**

Add to imports (after `from app.api.pr_url import parse_pr_url`):

```python
from app.convert import IMPORTED_FORMATS, convert_imported, sniff_import_format
```

Replace lines 121-128 (blob_prefix + main.jsonl + source_export writes) with:

```python
    blob_prefix = f"traces/{sid}/"
    await blob_store.put(f"{blob_prefix}main.jsonl", unpacked.main_bytes)
    if source_export_bytes is not None:
        # Archived (already redacted by the caller) so an improved converter
        # can re-parse the original export later.
        await blob_store.put(
            f"{blob_prefix}source_export.txt", source_export_bytes
        )

    # Imported formats (Codex rollouts, Cursor transcripts) additionally get
    # a Claude-shaped converted copy stored next to the raw original. The
    # viewer and the digest read the converted copy; the raw stays the
    # canonical original. Bytes here are already redacted (bundle unpack
    # redacts before this function runs), so the converted copy is too.
    if source_format is None:
        source_format = sniff_import_format(unpacked.main_bytes)
    converted_main: bytes | None = None
    if source_format in IMPORTED_FORMATS:
        converted_main = convert_imported(unpacked.main_bytes)
    if converted_main is not None:
        await blob_store.put(f"{blob_prefix}converted.jsonl", converted_main)
```

In the agents loop (lines 130-146), add converted-copy handling. Replace the loop with:

```python
    agent_summaries: list[dict] = []
    converted_agents: dict[str, bytes] = {}
    for agent in unpacked.agents:
        await blob_store.put(
            f"{blob_prefix}agents/{agent.agent_id}.jsonl",
            agent.jsonl_bytes,
        )
        # Sniffed per blob: a codex/cursor trace's subagent threads are
        # stored in the same native format as its main transcript.
        converted = convert_imported(agent.jsonl_bytes)
        if converted is not None:
            converted_agents[agent.agent_id] = converted
            await blob_store.put(
                f"{blob_prefix}agents/{agent.agent_id}.converted.jsonl",
                converted,
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
```

(`count_messages` stays on the RAW bytes: it natively counts codex/cursor formats and counting converted bytes could drift from already-stored traces.)

Change the digest call (lines 202-210) to pass the converted bytes:

```python
        await compute_digest(
            session,
            trace,
            blob=(
                converted_main
                if converted_main is not None else unpacked.main_bytes
            ),
            subagent_blobs={
                a.meta.get("toolUseId", a.agent_id):
                    converted_agents.get(a.agent_id, a.jsonl_bytes)
                for a in unpacked.agents
            },
        )
```

- [ ] **Step 4: Remove the conversion from the digest pipeline**

In `app/agents/digest/pipeline.py`: delete line 28 (`from app.codex_convert import codex_to_claude_jsonl, looks_like_codex`) and lines 46-54 (the comment + `if looks_like_codex(blob): ...` block + the subagent dict-comprehension), so `compute_digest` starts directly with `distilled, uuids = distill_with_uuids(...)`.

- [ ] **Step 5: Update the pipeline tests** (`tests/agents/digest/test_pipeline.py`)

Add `from app.codex_convert import codex_to_claude_jsonl` to the imports. Then:

1. Rename `test_codex_rollout_is_converted_and_digested` to `test_converted_codex_blob_digests_with_codex_rec_anchors` and change the call to pass converted bytes (conversion now happens at ingest, in trace_service):

```python
    digest = await compute_digest(
        db_session, _seeded_trace,
        blob=codex_to_claude_jsonl(_codex_blob), subagent_blobs={},
    )
```

Update the explanatory comment to: `# trace_service converts at ingest; the anchor surface uses the synthetic codex-rec uuids the viewer resolves against the served converted blob.` Keep the three assertions (`USER: Add a greet function`, `[codex-rec-1]`, anchor list).

2. Rename `test_codex_subagent_blob_is_converted_for_summary` to `test_converted_codex_subagent_blob_is_summarized` and convert both blobs at the call site:

```python
    await compute_digest(
        db_session, _seeded_trace,
        blob=codex_to_claude_jsonl(_codex_blob),
        subagent_blobs={"c_spawn": codex_to_claude_jsonl(child)},
    )
```

3. Add a regression pin that the pipeline no longer converts:

```python
@pytest.mark.asyncio
async def test_raw_codex_blob_is_no_longer_converted_by_pipeline(
    monkeypatch, db_session, _codex_blob, _seeded_trace,
):
    # Conversion moved to ingest (trace_service); a raw codex blob fed
    # straight to the pipeline distills to nothing and records skip_empty.
    monkeypatch.setenv("VIBESHUB_OPENAI_API_KEY", "sk-x")
    monkeypatch.setenv("VIBESHUB_OPENAI_ENDPOINT", "https://e")
    monkeypatch.setenv("VIBESHUB_OPENAI_MODEL", "gpt-5.5")
    mock_client = MagicMock()
    monkeypatch.setattr(
        "app.agents.digest.pipeline.get_client", lambda: mock_client,
    )

    result = await compute_digest(
        db_session, _seeded_trace, blob=_codex_blob, subagent_blobs={},
    )

    assert result is None
    assert mock_client.responses.parse.call_count == 0
```

- [ ] **Step 6: Update docs and docstrings (the parity contract is dead; long live the determinism pin)**

`app/codex_convert.py` module docstring (lines 1-18), replace entirely with:

```python
"""Convert raw Codex rollouts to Claude-shaped JSONL.

Originally the backend mirror of the frontend's codexExport.ts, which
died when conversion moved server-side: ingest now stores this module's
output as {blob_prefix}converted.jsonl and the API serves it to the
viewer. Pure: bytes in, bytes out, no I/O.

The synthetic uuids (codex-rec-<n>) are load-bearing: digest chapter
anchor_uuids are generated against this conversion and resolved against
the same converted jsonl the API serves, and digests computed before
the converted-copy era already reference these uuids. Changing the uuid
scheme or record order breaks chapter jumps on existing digests.
tests/test_codex_convert.py pins the output against goldens (originally
captured from the frontend converter) as a determinism/regression
contract.
"""
```

`tests/test_codex_convert.py` module docstring, replace with:

```python
"""Tests for app.codex_convert.

The *.golden.jsonl fixtures were captured from the frontend's former
codexExport.ts converter (deleted when conversion moved server-side).
They now pin determinism: digest chapter anchor_uuids reference the
synthetic codex-rec-<n> uuids, and the viewer resolves them against the
same converted jsonl this module produces, so record order and uuid
assignment must never drift.
"""
```

Also rename `test_conversion_matches_frontend_golden` to `test_conversion_matches_golden` in that file.

`app/agents/digest/README.md` flow step 2 (lines 15-19 region), replace with:

```
2. Codex rollouts and Cursor transcripts are converted to Claude-shaped
   records at ingest by `app/codex_convert.py` / `app/cursor_convert.py`
   (`app/api/trace_service.py` stores the result as
   `{blob_prefix}converted.jsonl` and passes it here), so the distiller
   always sees Claude-shaped records. The synthetic uuids
   (`codex-rec-<n>`, `cursor-rec-<n>`) are the digest's chapter anchor
   surface, and the viewer resolves anchors against the same converted
   blob served by `GET /api/traces/{id}/session`; converter determinism
   is pinned by `tests/test_codex_convert.py` and
   `tests/test_cursor_convert.py`. Subagent blobs are converted the same
   way.
```

- [ ] **Step 7: Run the backend suite**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest -q`
Expected: all PASS. Watch specifically: `tests/api/test_traces_digest.py` (end-to-end ingest+digest; should still pass since trace_service now feeds converted bytes for codex, claude unchanged) and `tests/test_uploads.py::test_uploads_stores_redacted_source_export` (terminal source_format preserved).

- [ ] **Step 8: Commit**

```bash
cd /Users/bhavya/git/vibeshub && git add webapp/backend/app/api/trace_service.py webapp/backend/app/agents/digest/pipeline.py webapp/backend/app/codex_convert.py webapp/backend/app/agents/digest/README.md webapp/backend/tests/ && git branch --show-current | grep -qx converted-trace-blobs && git commit -m "feat: store converted copies at ingest; digest consumes them"
```

---

### Task 7: Serve the converted copy; keep /raw native (TDD)

**Files:**
- Modify: `webapp/backend/app/api/traces.py` (new `/session` route, `get_agent_raw` body, `_AGENT_ID_RE`, `delete_trace` keys)
- Test: `webapp/backend/tests/test_serve_session.py` (new)

- [ ] **Step 1: Write the failing tests**

`webapp/backend/tests/test_serve_session.py`:

```python
"""API tests for GET /api/traces/{id}/session (the viewer's converted
jsonl) and the converted-copy lifecycle (agent serving, deletion,
legacy fallbacks). /raw must keep returning the native original."""
import json
from pathlib import Path

import pytest
from sqlalchemy import select

from app.storage.models import Trace
from tests.test_ingest import COMMON_HEADERS, _mock_alice_pr1, make_bundle

CODEX_MAIN = (
    b'{"type":"session_meta","payload":{"id":"019e7ed1","cwd":"/x"}}\n'
    b'{"type":"event_msg","payload":{"type":"user_message",'
    b'"message":"Add a greet function"}}\n'
    b'{"type":"response_item","payload":{"type":"message","role":"assistant",'
    b'"content":[{"type":"output_text","text":"on it"}]}}\n'
)

CURSOR_MAIN = (
    b'{"role":"user","message":{"content":[{"type":"text",'
    b'"text":"<user_query>do a sweep</user_query>"}]}}\n'
    b'{"role":"assistant","message":{"content":[{"type":"text",'
    b'"text":"on it"}]}}\n'
)


def _ingest(client, main, platform, members=None):
    body = make_bundle({"main.jsonl": main, **(members or {})})
    headers = {**COMMON_HEADERS, "X-Vibeshub-Platform": platform}
    r = client.post("/api/ingest", content=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["short_id"]


def _first_record(text):
    return json.loads(text.splitlines()[0])


def test_session_serves_converted_codex_and_raw_stays_native(
    client, respx_mock,
):
    _mock_alice_pr1(respx_mock)
    sid = _ingest(client, CODEX_MAIN, "codex")

    session_r = client.get(f"/api/traces/{sid}/session")
    assert session_r.status_code == 200
    assert _first_record(session_r.text)["type"] == "codex-meta"

    raw_r = client.get(f"/api/traces/{sid}/raw")
    assert raw_r.status_code == 200
    assert _first_record(raw_r.text)["type"] == "session_meta"


def test_session_serves_converted_cursor(client, respx_mock):
    _mock_alice_pr1(respx_mock)
    sid = _ingest(client, CURSOR_MAIN, "cursor")

    r = client.get(f"/api/traces/{sid}/session")
    assert r.status_code == 200
    assert _first_record(r.text)["type"] == "cursor-meta"
    raw_r = client.get(f"/api/traces/{sid}/raw")
    assert "role" in _first_record(raw_r.text)


def test_session_serves_raw_for_claude(client, respx_mock):
    _mock_alice_pr1(respx_mock)
    main = b'{"type":"user","uuid":"u1","message":{"content":"hi"}}\n'
    sid = _ingest(client, main, "claude-code")

    r = client.get(f"/api/traces/{sid}/session")
    assert r.status_code == 200
    assert r.content == main


def test_session_converts_in_memory_when_converted_blob_missing(
    client, respx_mock,
):
    # source_format says codex but the converted blob is gone: serve-time
    # fallback converts in memory, no storage writes.
    _mock_alice_pr1(respx_mock)
    sid = _ingest(client, CODEX_MAIN, "codex")
    blob_dir = Path(client.app.state.settings.blob_dir)
    converted_path = blob_dir / "traces" / sid / "converted.jsonl"
    converted_path.unlink()

    r = client.get(f"/api/traces/{sid}/session")
    assert r.status_code == 200
    assert _first_record(r.text)["type"] == "codex-meta"
    assert not converted_path.exists()  # no backfill write


@pytest.mark.asyncio
async def test_session_sniffs_legacy_rows_without_source_format(
    client, respx_mock,
):
    # Traces uploaded before this feature: no converted blob AND
    # source_format NULL (it was never populated for codex/cursor).
    _mock_alice_pr1(respx_mock)
    sid = _ingest(client, CODEX_MAIN, "codex")
    blob_dir = Path(client.app.state.settings.blob_dir)
    (blob_dir / "traces" / sid / "converted.jsonl").unlink()
    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == sid)
        )).scalar_one()
        trace.source_format = None
        await session.commit()

    r = client.get(f"/api/traces/{sid}/session")
    assert r.status_code == 200
    assert _first_record(r.text)["type"] == "codex-meta"


def test_agent_endpoint_serves_converted_for_uuid_agent(
    client, respx_mock,
):
    _mock_alice_pr1(respx_mock)
    aid = "019e7f09-bca2-7150-ac2b-54f7b075a2ea"
    members = {
        f"agents/{aid}.jsonl": (
            b'{"type":"session_meta","payload":{"id":"019e7f09"}}\n'
        ),
        f"agents/{aid}.meta.json": (
            b'{"agentType":"default","description":"d",'
            b'"toolUseId":"call_spawn"}'
        ),
    }
    sid = _ingest(client, CODEX_MAIN, "codex", members)

    # UUID-shaped agent ids used to 404 at the route regex even though
    # ingest accepts them (bundle.AGENT_ID_RE allows both forms).
    r = client.get(f"/api/traces/{sid}/agents/{aid}")
    assert r.status_code == 200
    assert _first_record(r.text)["type"] == "codex-meta"


def test_agent_endpoint_serves_raw_for_claude_agent(client, respx_mock):
    _mock_alice_pr1(respx_mock)
    aid = "a0123456789abcdef"
    agent_jsonl = b'{"type":"assistant","uuid":"x1"}\n'
    members = {
        f"agents/{aid}.jsonl": agent_jsonl,
        f"agents/{aid}.meta.json": (
            b'{"agentType":"Explore","description":"d",'
            b'"toolUseId":"toolu_01x"}'
        ),
    }
    main = b'{"type":"user","uuid":"u1","message":{"content":"hi"}}\n'
    sid = _ingest(client, main, "claude-code", members)

    r = client.get(f"/api/traces/{sid}/agents/{aid}")
    assert r.status_code == 200
    assert r.content == agent_jsonl


def test_delete_removes_converted_blobs(client, respx_mock):
    _mock_alice_pr1(respx_mock)
    aid = "019e7f09-bca2-7150-ac2b-54f7b075a2ea"
    members = {
        f"agents/{aid}.jsonl": (
            b'{"type":"session_meta","payload":{"id":"019e7f09"}}\n'
        ),
        f"agents/{aid}.meta.json": (
            b'{"agentType":"default","description":"d",'
            b'"toolUseId":"call_spawn"}'
        ),
    }
    sid = _ingest(client, CODEX_MAIN, "codex", members)
    trace_dir = Path(client.app.state.settings.blob_dir) / "traces" / sid
    assert (trace_dir / "converted.jsonl").exists()
    assert (trace_dir / "agents" / f"{aid}.converted.jsonl").exists()

    r = client.delete(
        f"/api/traces/{sid}",
        headers={"Authorization": "Bearer ghp_test"},
    )
    assert r.status_code == 204
    assert not (trace_dir / "main.jsonl").exists()
    assert not (trace_dir / "converted.jsonl").exists()
    assert not (trace_dir / "agents" / f"{aid}.converted.jsonl").exists()
```

Note: if `_mock_alice_pr1` does not already mock `GET /user` (needed by `delete_trace`'s `verify_token`), look at how the existing delete tests in `tests/test_traces.py` mock it and add the same respx route inside `test_delete_removes_converted_blobs`.

- [ ] **Step 2: Run to verify failures**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/test_serve_session.py -q`
Expected: `/session` tests FAIL with 404 (route missing); the UUID agent test FAILS with 404 (regex); delete test FAILS on the converted-blob assertions.

- [ ] **Step 3: Implement in `app/api/traces.py`**

Add imports:

```python
from app.convert import IMPORTED_FORMATS, convert_imported
from app.redact.bundle import AGENT_ID_RE
```

Replace the module-level `_AGENT_ID_RE = re.compile(r"^a[0-9a-f]{16}$")` (line 36) with nothing, and change its use at line 440 to `AGENT_ID_RE.match(agent_id)`. (bundle's pattern accepts both `a`+16hex and UUID forms, the same set ingest accepts; remove the now-unused `re` import only if nothing else in the file uses it.)

Add a helper above `get_trace_raw`:

```python
async def _claude_shaped(
    blob_store: BlobStore,
    *,
    raw_key: str,
    converted_key: str,
    source_format: str | None,
) -> bytes:
    """Claude-shaped bytes for the viewer.

    Imported formats serve the stored converted copy. Traces uploaded
    before converted copies existed have neither the blob nor (usually)
    a source_format, so fall through to an in-memory conversion: sniff
    the raw bytes and convert, no storage writes. Everything else is
    already Claude-shaped and serves raw.
    """
    if source_format in IMPORTED_FORMATS:
        try:
            return await blob_store.get(converted_key)
        except FileNotFoundError:
            pass
    raw = await blob_store.get(raw_key)
    return convert_imported(raw) or raw
```

Add the new route directly after `get_trace_raw` (same shape as `get_trace_raw`, lines 397-425, with only the data line changed):

```python
@router.get("/api/traces/{short_id}/session")
async def get_trace_session(
    short_id: str,
    session: AsyncSession = Depends(get_session),
    blob_store: BlobStore = Depends(get_blob_store),
    user: User | None = Depends(get_current_user),
    settings: Settings = Depends(get_app_settings),
    access: RepoAccessChecker = Depends(get_repo_access),
):
    """The Claude-shaped jsonl the viewer renders: the converted copy for
    imported formats (codex, cursor), the raw blob otherwise. /raw keeps
    serving the native original for the Raw JSONL download."""
    if not looks_like_short_id(short_id):
        raise HTTPException(status_code=404, detail="not found")
    stmt = select(Trace).where(
        Trace.short_id == short_id,
        Trace.deleted_at.is_(None),
    )
    trace = (await session.execute(stmt)).scalar_one_or_none()
    if trace is None:
        raise HTTPException(status_code=404, detail="not found")
    await _require_trace_access(trace, user, settings, access)
    if trace.blob_prefix is None:
        raise HTTPException(status_code=500, detail="trace not migrated to v2 layout")
    data = await _claude_shaped(
        blob_store,
        raw_key=f"{trace.blob_prefix}main.jsonl",
        converted_key=f"{trace.blob_prefix}converted.jsonl",
        source_format=trace.source_format,
    )
    headers = (
        {"Cache-Control": "private, no-store"} if trace.is_private else None
    )
    return Response(
        content=data, media_type="application/x-ndjson", headers=headers
    )
```

In `get_agent_raw`, replace the data line (458) with:

```python
    data = await _claude_shaped(
        blob_store,
        raw_key=f"{trace.blob_prefix}agents/{agent_id}.jsonl",
        converted_key=f"{trace.blob_prefix}agents/{agent_id}.converted.jsonl",
        source_format=trace.source_format,
    )
```

In `delete_trace`, replace the key-list block (509-516) with:

```python
    keys_to_delete = []
    if trace.blob_prefix:
        keys_to_delete.append(f"{trace.blob_prefix}main.jsonl")
        keys_to_delete.append(f"{trace.blob_prefix}converted.jsonl")
        keys_to_delete.append(f"{trace.blob_prefix}source_export.txt")
        for a in (trace.agents or []):
            keys_to_delete.append(f"{trace.blob_prefix}agents/{a['agent_id']}.jsonl")
            keys_to_delete.append(f"{trace.blob_prefix}agents/{a['agent_id']}.converted.jsonl")
            keys_to_delete.append(f"{trace.blob_prefix}agents/{a['agent_id']}.meta.json")
    elif trace.blob_path:
        keys_to_delete.append(trace.blob_path)
```

(The loop already swallows `FileNotFoundError`, so absent converted/source_export keys are fine.)

- [ ] **Step 4: Run the serve tests, then the whole backend suite**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/test_serve_session.py -q && ../../env/bin/pytest -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/bhavya/git/vibeshub && git add webapp/backend/app/api/traces.py webapp/backend/tests/test_serve_session.py && git branch --show-current | grep -qx converted-trace-blobs && git commit -m "feat: serve converted jsonl at /session; keep /raw native; fix uuid agent ids"
```

---

### Task 8: End-to-end digest anchor tests (codex + cursor)

Definition-of-done coverage: an upload's digest chapter anchors must resolve against what `/session` serves.

**Files:**
- Modify: `webapp/backend/tests/api/test_traces_digest.py` (append; FIRST read the file to reuse its existing OpenAI mock helpers and ingest pattern — it already does ingest-then-digest with a patched client)

- [ ] **Step 1: Write the tests** (adapt helper names to that file's existing ones; the bodies below assume a `_mock_openai(monkeypatch, payload)`-style setup exists or can be lifted from the file's existing test; the digest payload must include a chapter anchored at `codex-rec-1` / `cursor-rec-1` and otherwise reuse the file's valid payload shape)

```python
def _session_uuids(client, sid):
    text = client.get(f"/api/traces/{sid}/session").text
    return {
        json.loads(line)["uuid"]
        for line in text.splitlines() if line.strip()
    }


@pytest.mark.asyncio
async def test_codex_digest_anchors_resolve_against_session(
    client, respx_mock, monkeypatch,
):
    # <set up the OpenAI mock exactly like the existing happy-path test in
    # this file, but with chapters = [{"anchor_uuid": "codex-rec-1",
    # "title": "Frame the change", "caption": "User asks for a helper."}]>
    rollout = (
        Path(__file__).parent.parent / "fixtures" / "codex"
        / "rollout.jsonl"
    ).read_bytes()
    sid = <ingest rollout via the file's ingest pattern, platform codex>

    head = client.get(f"/api/traces/{sid}").json()
    chapters = head["ai_digest"]["chapters"]
    anchors = [c["anchor_uuid"] for c in chapters]
    assert anchors == ["codex-rec-1"]
    # The viewer resolves anchors against /session records.
    assert set(anchors) <= _session_uuids(client, sid)


@pytest.mark.asyncio
async def test_cursor_digest_anchors_resolve_against_session(
    client, respx_mock, monkeypatch,
):
    # <same OpenAI mock, chapters anchored at "cursor-rec-1">
    transcript = (
        Path(__file__).parent.parent / "fixtures" / "cursor"
        / "transcript.jsonl"
    ).read_bytes()
    sid = <ingest transcript via the file's ingest pattern, platform cursor>

    head = client.get(f"/api/traces/{sid}").json()
    anchors = [c["anchor_uuid"] for c in head["ai_digest"]["chapters"]]
    assert anchors == ["cursor-rec-1"]
    assert set(anchors) <= _session_uuids(client, sid)
```

The `<...>` parts are NOT placeholders to skip: resolve them by copying the concrete mock/ingest code from the existing test in the same file (it exists; the explorer confirmed `tests/api/test_traces_digest.py` is an end-to-end ingest-then-digest test with a patched OpenAI client). `cursor-rec-1` is the converted user record ("do a sweep" in `transcript.jsonl`... note: transcript.jsonl's user record is "Review the frontend for likely bugs."), a Tier-1 USER line that is always in the distilled anchor surface. If the digest pipeline drops the chapter (anchor not in surface), print the distilled text from the mock call args to see the actual surface and pick the right uuid; do not loosen the assertion to `<=` on an empty set (`assert anchors == [...]` first).

- [ ] **Step 2: Run them**

Run: `cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest tests/api/test_traces_digest.py -q`
Expected: PASS. The cursor test doubles as proof that cursor traces now get digests at all (formerly impossible: the distiller saw raw cursor records and produced an empty distillate).

- [ ] **Step 3: Commit**

```bash
cd /Users/bhavya/git/vibeshub && git add webapp/backend/tests/api/test_traces_digest.py && git branch --show-current | grep -qx converted-trace-blobs && git commit -m "test: pin digest chapter anchors resolve against /session for codex and cursor"
```

---

### Task 9: Frontend: fetch /session, delete the converters

**Files:**
- Modify: `webapp/frontend/src/api.ts`, `src/routes/TraceView.tsx`, `src/components/trace/sessionFromRaw.ts`
- Delete: `src/components/trace/codexExport.ts`, `src/components/trace/cursorExport.ts`, `src/tests/trace/codexExport.test.ts`, `src/tests/trace/cursorExport.test.ts`, `src/tests/fixtures/sample-codex.jsonl`, `sample-codex-subagent.jsonl`, `sample-cursor.jsonl`, `sample-cursor-subagent.jsonl`
- Create: `src/tests/trace/sessionFromRaw.test.ts`, `src/tests/fixtures/sample-codex-converted.jsonl`, `src/tests/fixtures/sample-cursor-converted.jsonl`

- [ ] **Step 1: Add the converted fixtures (copies of backend goldens)**

```bash
cp /Users/bhavya/git/vibeshub/webapp/backend/tests/fixtures/codex/rollout.golden.jsonl /Users/bhavya/git/vibeshub/webapp/frontend/src/tests/fixtures/sample-codex-converted.jsonl
cp /Users/bhavya/git/vibeshub/webapp/backend/tests/fixtures/cursor/transcript.golden.jsonl /Users/bhavya/git/vibeshub/webapp/frontend/src/tests/fixtures/sample-cursor-converted.jsonl
```

- [ ] **Step 2: Write the failing pass-through test**

`src/tests/trace/sessionFromRaw.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSessionFromRaw } from "../../components/trace/sessionFromRaw";

const FIXTURES = join(__dirname, "..", "fixtures");
const read = (name: string) =>
  readFileSync(join(FIXTURES, name), "utf8");

// The backend serves Claude-shaped jsonl for every format (codex/cursor
// converted server-side at ingest); buildSessionFromRaw must render the
// converted output with no frontend converter in the loop.
describe("buildSessionFromRaw pass-through", () => {
  it("renders server-converted codex jsonl", () => {
    const session = buildSessionFromRaw(read("sample-codex-converted.jsonl"));
    expect(session.meta.sourceFormat).toBe("codex");
    expect(session.stream.length).toBeGreaterThan(0);
  });

  it("renders server-converted cursor jsonl", () => {
    const session = buildSessionFromRaw(read("sample-cursor-converted.jsonl"));
    expect(session.meta.sourceFormat).toBe("cursor");
    expect(session.stream.length).toBeGreaterThan(0);
  });

  it("renders claude jsonl unchanged", () => {
    const session = buildSessionFromRaw(read("sample-session.jsonl"));
    expect(session.meta.sourceFormat).toBeNull();
    expect(session.stream.length).toBeGreaterThan(0);
  });
});
```

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npx vitest run src/tests/trace/sessionFromRaw.test.ts`
Expected: PASS already (pass-through works today for converted text). This is the safety net for the deletion; if `session.stream` is not the right property name, check `src/components/trace/types.ts` for the `Session` shape and fix the test, not the code.

- [ ] **Step 3: Switch the viewer fetch to /session**

In `src/api.ts`, replace `fetchRawJsonl` (lines 51-59) with:

```ts
export async function fetchSessionJsonl(shortId: string): Promise<string> {
  const r = await fetch(`/api/traces/${shortId}/session`, {
    credentials: "same-origin",
  });
  if (!r.ok) {
    throw new ApiError(r.status, await r.text());
  }
  return r.text();
}
```

First check nothing else uses `fetchRawJsonl`: `grep -rn "fetchRawJsonl" src/`. Expected: only `api.ts` and `TraceView.tsx`. If a test mocks it, update the mock to `fetchSessionJsonl`. In `src/routes/TraceView.tsx`, update the import and the call at line 57 (`fetchRawJsonl(shortId)` -> `fetchSessionJsonl(shortId)`). Do NOT touch `rawHref` (line 123): the Raw JSONL download keeps pointing at `/raw`.

- [ ] **Step 4: Simplify the dispatcher and delete the converters**

Replace `src/components/trace/sessionFromRaw.ts` entirely with:

```ts
import { buildSession, parseJsonl } from "./parser";
import { looksLikeTerminalExport, terminalExportToJsonl } from "./terminalExport";
import type { Session } from "./types";

// The single entry point for turning stored transcript text into a Session.
// The backend serves Claude-shaped jsonl for every format (Codex and Cursor
// are converted server-side at ingest and served from /session). The
// terminal branch survives as a safety net for raw terminal text that
// predates upload-time conversion.
export function buildSessionFromRaw(text: string): Session {
  let jsonl = text;
  if (looksLikeTerminalExport(text)) {
    jsonl = terminalExportToJsonl(text).jsonl;
  }
  return buildSession(parseJsonl(jsonl));
}
```

Then delete:

```bash
cd /Users/bhavya/git/vibeshub/webapp/frontend
git rm src/components/trace/codexExport.ts src/components/trace/cursorExport.ts src/tests/trace/codexExport.test.ts src/tests/trace/cursorExport.test.ts
grep -rln "sample-codex.jsonl\|sample-codex-subagent\|sample-cursor.jsonl\|sample-cursor-subagent" src/ e2e/ || true
```

If that grep shows no remaining references (expected: none after the test deletions), also:

```bash
git rm src/tests/fixtures/sample-codex.jsonl src/tests/fixtures/sample-codex-subagent.jsonl src/tests/fixtures/sample-cursor.jsonl src/tests/fixtures/sample-cursor-subagent.jsonl
```

Finally `grep -rn "codexExport\|cursorExport" src/ e2e/` must return nothing.

- [ ] **Step 5: Run the frontend suite and typecheck**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test && npm run build`
Expected: vitest green (codexExport/cursorExport suites gone, sessionFromRaw suite passing), `tsc`/vite build clean (catches any dangling imports). If `npm run build` is not the typecheck script, check `package.json` scripts for the tsc invocation and run that.

- [ ] **Step 6: Commit**

```bash
cd /Users/bhavya/git/vibeshub && git add -A webapp/frontend/src && git branch --show-current | grep -qx converted-trace-blobs && git commit -m "feat: render from /session; delete render-time codex/cursor converters"
```

---

### Task 10: Real-rollout verification (73 local Codex sessions)

Not committed code; evidence gathering. The rollouts are private local data: outputs go to /tmp only.

- [ ] **Step 1: Convert + distill every local rollout**

Write `/tmp/verify_rollouts.py`:

```python
import glob
import os
import sys

sys.path.insert(0, "/Users/bhavya/git/vibeshub/webapp/backend")
from app.codex_convert import codex_to_claude_jsonl, looks_like_codex
from app.agents.digest.distill import distill_with_uuids

files = sorted(glob.glob(
    os.path.expanduser("~/.codex/sessions/2026/**/*.jsonl"), recursive=True,
))
outdir = "/tmp/converted-rollouts"
os.makedirs(outdir, exist_ok=True)
ok = empty = notcodex = failed = 0
for i, f in enumerate(files):
    raw = open(f, "rb").read()
    if not looks_like_codex(raw):
        notcodex += 1
        print(f"NOT-CODEX {f}")
        continue
    try:
        conv = codex_to_claude_jsonl(raw)
    except Exception as e:  # noqa: BLE001
        failed += 1
        print(f"CONVERT-FAIL {f}: {e}")
        continue
    distilled, uuids = distill_with_uuids(conv, subagent_blobs={})
    if not distilled.strip():
        empty += 1
        print(f"EMPTY-DISTILL {f}")
        continue
    open(os.path.join(outdir, f"r{i:03d}.jsonl"), "wb").write(conv)
    ok += 1
print(f"{ok} ok, {empty} empty-distill, {notcodex} not-codex, "
      f"{failed} convert-failed, of {len(files)} files")
```

Run: `/Users/bhavya/git/vibeshub/env/bin/python /tmp/verify_rollouts.py`
Expected: `73 ok, 0 empty-distill, 0 not-codex, 0 convert-failed, of 73 files` (a handful of empty-distill or not-codex files MAY legitimately exist, e.g. zero-content sessions; investigate each non-ok line and record the explanation; convert-failed must be 0).

- [ ] **Step 2: Round-trip every converted rollout through the frontend parser**

Write `webapp/frontend/src/tests/trace/__realRollouts.test.ts` (TEMPORARY):

```ts
// TEMPORARY: round-trips real converted rollouts through buildSession.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSessionFromRaw } from "../../components/trace/sessionFromRaw";

const DIR = "/tmp/converted-rollouts";

describe("real converted rollouts round-trip", () => {
  for (const name of readdirSync(DIR)) {
    it(`parses ${name}`, () => {
      const session = buildSessionFromRaw(
        readFileSync(join(DIR, name), "utf8"),
      );
      expect(session.meta.sourceFormat).toBe("codex");
      expect(session.stream.length).toBeGreaterThan(0);
    });
  }
});
```

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npx vitest run src/tests/trace/__realRollouts.test.ts`
Expected: one passing test per converted rollout, zero failures (this is the "converted blob round-trips through buildSession without the deleted converters" requirement).

- [ ] **Step 3: Clean up scratch artifacts**

```bash
rm /Users/bhavya/git/vibeshub/webapp/frontend/src/tests/trace/__realRollouts.test.ts /tmp/verify_rollouts.py
rm -rf /tmp/converted-rollouts
```

Record the two result summaries (counts) for the PR description.

---

### Task 11: Full verification and PR

- [ ] **Step 1: Run both full suites and capture output**

```bash
cd /Users/bhavya/git/vibeshub/webapp/backend && ../../env/bin/pytest -q
cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test
```

Expected: both fully green. Fix anything that is not before proceeding (use superpowers:systematic-debugging for failures, not guess-and-rerun).

- [ ] **Step 2: Push and open the PR**

```bash
cd /Users/bhavya/git/vibeshub && git branch --show-current | grep -qx converted-trace-blobs && git push -u origin converted-trace-blobs
gh pr create --title "Store converted Claude-shaped traces alongside raw; serve and digest from the converted copy" --body "<body>"
```

PR body must cover: the dual-blob scheme (`converted.jsonl` + `agents/<id>.converted.jsonl`, raw untouched); `/session` (viewer) vs `/raw` (download) split; serve-time in-memory fallback for old traces (both missing-blob and NULL-source_format cases, no backfill); digest now consumes converted bytes and cursor traces gain digests via the new `app/cursor_convert.py`; frontend converters deleted, goldens repinned as backend determinism contracts; the agent-id regex fix (UUID subagent blobs no longer 404); deliberate non-changes (message_count.py still counts raw native formats since converted counts could drift; spa_seo.py never read raw bytes); real-rollout verification numbers from Task 10. End with the Claude Code attribution footer. No em-dashes anywhere in the body.

---

## Self-review (done at planning time)

- Spec coverage: ingest dual-store (Task 6), viewer serves converted incl. subagents (Task 7, plus the agent-id regex fix without which subagent serving is unreachable for codex/cursor), Raw JSONL keeps native (Task 7 test), old-trace serve-time fallback with test (Task 7, two variants), digest reads converted + pipeline conversion removed (Task 6), cursor port + cursor digests + distill awareness (Tasks 2-4, 8), converters deleted + sessionFromRaw simplified + suites green (Task 9), golden meaning change documented (Task 6 Step 6), README flow updated (Task 6 Step 6), spa_seo/message_count checked with explicit leave-and-note outcome (Facts 3-4, PR body), real rollouts end-to-end (Task 10), branch + PR (Tasks 1, 11).
- Known judgment calls already decided: endpoint name `/session`; converted blob keys `converted.jsonl` / `agents/<id>.converted.jsonl`; sniff-on-NULL source_format at serve time (required for legacy traces, since source_format was never populated for codex/cursor); `count_messages` stays on raw bytes.
