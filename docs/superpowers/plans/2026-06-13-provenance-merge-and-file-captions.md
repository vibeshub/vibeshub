# Provenance Merge + Digest File Captions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render each changed file in the Provenance Blame view as one merged, file-position-ordered diff block headed by a digest-written prose caption, and teach the digest agent to write those captions.

**Architecture:** Backend digest agent gains a `file_notes` output (per-file caption, validated against the trace's edited paths) and feeds the model a short preview of each edit's content so captions are grounded. Frontend drops per-edit hunk boxes: a file's surviving edit regions are sorted by file position and rendered as one continuous blame block, with retries shown as a quiet gutter marker and per-line provenance on click.

**Tech Stack:** Python (Pydantic, pytest), TypeScript/React (Vitest, Testing Library).

---

## Spec

`docs/superpowers/specs/2026-06-13-provenance-merge-and-file-captions-design.md`

## Deviation from spec (deliberate)

The spec proposed renaming `BlameFile.hunks` -> `regions` / `BlameHunk` -> `BlameRegion`. **This plan keeps the `BlameHunk` type and `hunks` field name.** The unit is unchanged (one entry per surviving edit op); only ordering and rendering change. Renaming would churn ~30 assertions in `provenance.test.ts` for no behavior gain. The new ordering/flatten logic lives in pure helpers (`orderRegions`, `regionPos`) that the view calls at render time, so the model keeps edit order and existing model tests stay valid. We call them "regions" in prose, but the type stays `BlameHunk`.

## Shared-checkout safety

Other sessions switch branches and push in this same checkout. **Before any commit, verify the branch in the same command.** Do all work on a dedicated branch.

Setup (run once before Task 1):

```bash
cd /Users/bhavya/git/vibeshub && git branch --show-current
# if this prints "main", create the feature branch:
git checkout -b provenance-merge-file-captions && git branch --show-current
```

Every commit step uses this pattern (shown in full in Task 1, abbreviated after):

```bash
cd /Users/bhavya/git/vibeshub && test "$(git branch --show-current)" = "provenance-merge-file-captions" && git add <files> && git commit -m "<msg>"
```

If the `test` fails (wrong branch), STOP and re-checkout the feature branch before committing.

## File map

- `webapp/backend/app/agents/digest/distill.py` — edit-content previews in the distillate + `edited_paths()` helper.
- `webapp/backend/app/agents/digest/schema.py` — `FileNote` model + `Digest.file_notes`.
- `webapp/backend/app/agents/digest/prompt.py` — instruction for `file_notes`.
- `webapp/backend/app/agents/digest/pipeline.py` — validate `file_notes` paths, em-dash sweep, `extra` metadata.
- `webapp/backend/tests/agents/digest/{test_distill,test_schema,test_pipeline}.py` — tests.
- `webapp/frontend/src/types.ts` — `FileNote` + optional `TraceDigest.file_notes`.
- `webapp/frontend/src/components/trace/provenance.ts` — `retried` field, retire `hunkTitle`, add `regionPos`/`orderRegions`.
- `webapp/frontend/src/components/trace/ProvenanceView.tsx` — merged file blocks, caption, retry marker, keyboard-accessible rows, `digest` prop.
- `webapp/frontend/src/components/trace/TraceViewer.tsx` — pass `ai_digest` to `ProvenanceView`.
- `webapp/frontend/src/styles/viewer.css` — remove box chrome, add caption/summary/retry/focus styles.
- `webapp/frontend/src/tests/trace/provenance.test.ts` — helper tests + `retried` test, drop `hunkTitle` tests.
- `webapp/frontend/src/tests/trace/ProvenanceView.test.tsx` — new render test.

---

## Task 1: Distiller edit previews + edited-path helper

**Files:**
- Modify: `webapp/backend/app/agents/digest/distill.py`
- Test: `webapp/backend/tests/agents/digest/test_distill.py`

- [ ] **Step 1: Update the existing test that asserts edit content is hidden**

In `test_distill.py`, replace `test_tool_use_collapses_to_one_liner` with:

```python
def test_edit_line_shows_path_counts_and_preview():
    out = distill(_read("short.jsonl"), subagent_blobs={})
    # Path + approximate add/remove counts
    assert "Edit webapp/backend/app/main.py (+1 -1)" in out
    # The first added line now appears as a grounding preview
    assert "NEW WITH LOTS OF CONTENT" in out
    # old_string content is never shown
    assert "OLD" not in out
```

- [ ] **Step 2: Add tests for the 3-line / per-line caps and the edited-path helper**

Append to `test_distill.py`:

```python
def test_edit_preview_caps_at_three_lines_and_line_length():
    import json
    new_string = "\n".join(["line one", "line two", "line three", "line four"])
    rec = {
        "type": "assistant", "uuid": "a9",
        "message": {"content": [{
            "type": "tool_use", "name": "Write",
            "input": {"file_path": "x/y.py", "content": new_string},
        }]},
    }
    blob = (json.dumps(rec) + "\n").encode("utf-8")
    out = distill(blob, subagent_blobs={})
    assert "line one" in out
    assert "line three" in out
    assert "line four" not in out  # 4th line dropped by the 3-line cap


def test_edited_paths_collects_edit_tool_targets():
    from app.agents.digest.distill import edited_paths
    paths = edited_paths(_read("short.jsonl"), subagent_blobs={})
    assert paths == {"webapp/backend/app/main.py"}


def test_edited_paths_includes_subagent_edits():
    import json
    from app.agents.digest.distill import edited_paths
    child = {
        "type": "assistant", "uuid": "s1",
        "message": {"content": [{
            "type": "tool_use", "name": "Edit",
            "input": {"file_path": "child/only.ts",
                      "old_string": "a", "new_string": "b"},
        }]},
    }
    child_blob = (json.dumps(child) + "\n").encode("utf-8")
    paths = edited_paths(_read("short.jsonl"), subagent_blobs={"tu1": child_blob})
    assert "webapp/backend/app/main.py" in paths
    assert "child/only.ts" in paths
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd webapp/backend && env/bin/pytest tests/agents/digest/test_distill.py -q`
Expected: FAIL — `edited_paths` import error, preview assertions fail (content currently hidden).

- [ ] **Step 4: Implement the edit preview + `edited_paths` in `distill.py`**

Add near the other module constants (after `_TOKENS_PER_CHAR`):

```python
_EDIT_TOOLS = {"Write", "Edit", "MultiEdit"}
_EDIT_PREVIEW_LINES = 3
_EDIT_PREVIEW_LINE_MAX = 80
```

Add these helpers above `_tool_use_to_line`:

```python
def _new_lines(inp: dict) -> list[str]:
    """Non-blank lines an edit introduces (Write content / Edit & MultiEdit
    new_string), used for the grounding preview and the +count."""
    texts: list[str] = []
    if isinstance(inp.get("content"), str):
        texts.append(inp["content"])
    if isinstance(inp.get("new_string"), str):
        texts.append(inp["new_string"])
    if isinstance(inp.get("edits"), list):
        for e in inp["edits"]:
            if isinstance(e, dict) and isinstance(e.get("new_string"), str):
                texts.append(e["new_string"])
    out: list[str] = []
    for t in texts:
        for ln in t.split("\n"):
            s = ln.strip()
            if s:
                out.append(s)
    return out


def _removed_count(inp: dict) -> int:
    n = 0
    if isinstance(inp.get("old_string"), str):
        n += sum(1 for ln in inp["old_string"].split("\n") if ln.strip())
    if isinstance(inp.get("edits"), list):
        for e in inp["edits"]:
            if isinstance(e, dict) and isinstance(e.get("old_string"), str):
                n += sum(1 for ln in e["old_string"].split("\n") if ln.strip())
    return n


def _edit_preview(name: str, inp: dict, path: str) -> str:
    added = _new_lines(inp)
    head = f"{name} {path} (+{len(added)} -{_removed_count(inp)})"
    if not added:
        return head
    shown = [ln[:_EDIT_PREVIEW_LINE_MAX] for ln in added[:_EDIT_PREVIEW_LINES]]
    return head + ": " + " / ".join(shown)
```

In `_tool_use_to_line`, change the file_path branch (currently `fp = inp.get("file_path")` ... `return f"{name} {fp}"`) to:

```python
    fp = inp.get("file_path")
    if isinstance(fp, str) and fp:
        if name in _EDIT_TOOLS:
            return _edit_preview(name, inp, fp)
        return f"{name} {fp}"
```

Add the module-level `edited_paths` function (after `distill_with_uuids`):

```python
def edited_paths(blob: bytes, *, subagent_blobs: dict[str, bytes]) -> set[str]:
    """Set of file paths touched by edit tools in the main and subagent
    streams. The digest pipeline validates file_notes paths against this."""
    paths: set[str] = set()
    for b in (blob, *subagent_blobs.values()):
        for raw in b.splitlines():
            if not raw.strip():
                continue
            try:
                ev = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if ev.get("type") != "assistant":
                continue
            content = (ev.get("message") or {}).get("content") or []
            if not isinstance(content, list):
                continue
            for block in content:
                if (
                    isinstance(block, dict)
                    and block.get("type") == "tool_use"
                    and block.get("name") in _EDIT_TOOLS
                ):
                    fp = (block.get("input") or {}).get("file_path")
                    if isinstance(fp, str) and fp:
                        paths.add(fp)
    return paths
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd webapp/backend && env/bin/pytest tests/agents/digest/test_distill.py -q`
Expected: PASS (all distill tests, including the rewritten and new ones).

- [ ] **Step 6: Commit**

```bash
cd /Users/bhavya/git/vibeshub && test "$(git branch --show-current)" = "provenance-merge-file-captions" && git add webapp/backend/app/agents/digest/distill.py webapp/backend/tests/agents/digest/test_distill.py && git commit -m "digest: edit-content previews in distillate + edited_paths helper"
```

---

## Task 2: FileNote schema + prompt instruction

**Files:**
- Modify: `webapp/backend/app/agents/digest/schema.py`
- Modify: `webapp/backend/app/agents/digest/prompt.py`
- Test: `webapp/backend/tests/agents/digest/test_schema.py`

- [ ] **Step 1: Write the failing tests**

Append to `test_schema.py`:

```python
def test_digest_defaults_file_notes_to_empty():
    from app.agents.digest.schema import Digest
    d = Digest.model_validate({
        "ask": "a", "decisions": "b", "files": "c",
        "tests": "d", "dead_ends": "e",
    })
    assert d.file_notes == []


def test_file_note_round_trips():
    from app.agents.digest.schema import Digest, FileNote
    d = Digest.model_validate({
        "ask": "a", "decisions": "b", "files": "c",
        "tests": "d", "dead_ends": "e",
        "file_notes": [{"path": "src/x.ts", "caption": "Tighten the loop"}],
    })
    assert d.file_notes == [FileNote(path="src/x.ts", caption="Tighten the loop")]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd webapp/backend && env/bin/pytest tests/agents/digest/test_schema.py -q`
Expected: FAIL — `FileNote` does not exist; `file_notes` not a field.

- [ ] **Step 3: Add the model + field in `schema.py`**

Add the class above `Chapter`:

```python
class FileNote(BaseModel):
    path: str
    caption: str = Field(max_length=140)
```

Add the field to `Digest` (after `chapters`):

```python
    file_notes: list[FileNote] = Field(default_factory=list, max_length=20)
```

- [ ] **Step 4: Add the prompt instruction in `prompt.py`**

In the JSON template in `SYSTEM_PROMPT`, add after the `chapters` block (before the closing `}`):

```
  ,
  "file_notes": [
    {
      "path": "<a file path that appears in the input>",
      "caption": "<1 sentence: what changed in this file and why>"
    },
    ...
  ]
```

In the `## Rules` section, add these bullets:

```
- file_notes: one caption per significant changed file, PR-review voice \
  ("what changed here and why"). caption is at most 140 chars. Up to 20 \
  files; skip trivial/unchanged ones.
- file_notes[].path MUST be a file path that appears in the input (the \
  "Edit <path>" / "Write <path>" lines). If unsure, drop it rather than guess.
```

- [ ] **Step 5: Run to verify the tests pass**

Run: `cd webapp/backend && env/bin/pytest tests/agents/digest/test_schema.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/bhavya/git/vibeshub && test "$(git branch --show-current)" = "provenance-merge-file-captions" && git add webapp/backend/app/agents/digest/schema.py webapp/backend/app/agents/digest/prompt.py webapp/backend/tests/agents/digest/test_schema.py && git commit -m "digest: FileNote schema + file_notes prompt instruction"
```

---

## Task 3: Pipeline validation + em-dash sweep + extra metadata

**Files:**
- Modify: `webapp/backend/app/agents/digest/pipeline.py`
- Test: `webapp/backend/tests/agents/digest/test_pipeline.py`

- [ ] **Step 1: Update the happy-path `extra` assertion and add a file_notes test**

In `test_pipeline.py`, change the assertion in `test_happy_path_persists_digest_and_records_run` from:

```python
    assert r.extra == {"chapters_kept": 1, "chapters_total": 2,
                       "distill_truncated": False}
```

to:

```python
    assert r.extra == {"chapters_kept": 1, "chapters_total": 2,
                       "distill_truncated": False,
                       "file_notes_kept": 0, "file_notes_total": 0}
```

Append a new test (the `short.jsonl` blob edits `webapp/backend/app/main.py`):

```python
@pytest.mark.asyncio
async def test_file_notes_unknown_path_dropped_and_em_dash_swept(
    monkeypatch, db_session, _trace_blob, _seeded_trace,
):
    monkeypatch.setenv("VIBESHUB_OPENAI_API_KEY", "sk-x")
    monkeypatch.setenv("VIBESHUB_OPENAI_ENDPOINT", "https://e")
    monkeypatch.setenv("VIBESHUB_OPENAI_MODEL", "gpt-5.5")
    payload = dict(VALID_PAYLOAD)
    payload["file_notes"] = [
        {"path": "webapp/backend/app/main.py",
         "caption": "Add the route — wire it in"},
        {"path": "not/edited.py", "caption": "Phantom file"},
    ]
    mock_client = MagicMock()
    mock_client.responses.parse.return_value = _ok_response(payload)
    monkeypatch.setattr(
        "app.agents.digest.pipeline.get_client", lambda: mock_client,
    )

    digest = await compute_digest(
        db_session, _seeded_trace, blob=_trace_blob, subagent_blobs={},
    )

    assert [n.path for n in digest.file_notes] == ["webapp/backend/app/main.py"]
    assert "—" not in digest.file_notes[0].caption
    assert digest.file_notes[0].caption == "Add the route, wire it in"
    rows = (await db_session.execute(
        select(AgentRun).where(AgentRun.agent_name == "digest"),
    )).scalars().all()
    assert rows[0].extra["file_notes_kept"] == 1
    assert rows[0].extra["file_notes_total"] == 2
```

- [ ] **Step 2: Run to verify failure**

Run: `cd webapp/backend && env/bin/pytest tests/agents/digest/test_pipeline.py -q`
Expected: FAIL — `extra` dict mismatch; `file_notes` not validated/swept.

- [ ] **Step 3: Implement validation + sweep + extra in `pipeline.py`**

Add the import at the top (next to the other digest imports):

```python
from app.agents.digest.distill import distill_with_uuids, edited_paths
```

In `compute_digest`, after the existing chapter validation block (after `chapters_kept = len(candidate.chapters)`), add:

```python
    paths = edited_paths(blob, subagent_blobs=subagent_blobs)
    file_notes_total = len(candidate.file_notes)
    candidate.file_notes = [n for n in candidate.file_notes if n.path in paths]
    for n in candidate.file_notes:
        n.caption = strip_em_dashes(n.caption)
    file_notes_kept = len(candidate.file_notes)
```

In the `record_run(... outcome=Outcome.OK ...)` call, extend `extra`:

```python
        extra={
            "chapters_kept": chapters_kept,
            "chapters_total": chapters_total,
            "distill_truncated": truncated,
            "file_notes_kept": file_notes_kept,
            "file_notes_total": file_notes_total,
        },
```

- [ ] **Step 4: Run the digest suite to verify pass**

Run: `cd webapp/backend && env/bin/pytest tests/agents/digest -q`
Expected: PASS (all digest tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/bhavya/git/vibeshub && test "$(git branch --show-current)" = "provenance-merge-file-captions" && git add webapp/backend/app/agents/digest/pipeline.py webapp/backend/tests/agents/digest/test_pipeline.py && git commit -m "digest: validate file_notes paths, sweep em-dashes, record counts"
```

---

## Task 4: Frontend digest types

**Files:**
- Modify: `webapp/frontend/src/types.ts`

- [ ] **Step 1: Add the `FileNote` type and optional field**

In `types.ts`, add above `TraceDigest`:

```ts
export interface FileNote {
  path: string;
  caption: string;
}
```

Add to `TraceDigest` (after `chapters`):

```ts
  file_notes?: FileNote[];
}
```

- [ ] **Step 2: Typecheck**

Run: `cd webapp/frontend && npx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
cd /Users/bhavya/git/vibeshub && test "$(git branch --show-current)" = "provenance-merge-file-captions" && git add webapp/frontend/src/types.ts && git commit -m "types: optional TraceDigest.file_notes"
```

---

## Task 5: provenance.ts — retried field, retire hunkTitle, region ordering helpers

**Files:**
- Modify: `webapp/frontend/src/components/trace/provenance.ts`
- Test: `webapp/frontend/src/tests/trace/provenance.test.ts`

- [ ] **Step 1: Write the failing tests**

In `provenance.test.ts`, change the import line from:

```ts
import {
  buildProvenance,
  hunkTitle,
} from "../../components/trace/provenance";
```

to:

```ts
import {
  buildProvenance,
  orderRegions,
  regionPos,
} from "../../components/trace/provenance";
import type { BlameHunk } from "../../components/trace/provenance";
import type { DiffRow } from "../../components/trace/diff";
```

Delete the entire `describe("hunkTitle", ...)` block at the end of the file.

Append these new blocks:

```ts
function hunkRow(start: number, lines: number): DiffRow {
  return {
    kind: "hunk",
    oldNo: null,
    newNo: null,
    text: `@@ -${start},${lines} +${start},${lines} @@`,
  };
}
function reg(id: string, rows: DiffRow[]): BlameHunk {
  return { id, rows } as unknown as BlameHunk;
}

describe("region ordering", () => {
  it("parses a file-absolute span from the @@ header, null when patch-less", () => {
    expect(regionPos([hunkRow(113, 7)])).toEqual({ start: 113, end: 120 });
    expect(
      regionPos([{ kind: "add", oldNo: null, newNo: 1, text: "x" }]),
    ).toBeNull();
  });

  it("sorts positioned non-overlapping regions by file position", () => {
    const out = orderRegions([
      reg("a", [hunkRow(200, 4)]),
      reg("b", [hunkRow(40, 3)]),
      reg("c", [hunkRow(113, 2)]),
    ]);
    expect(out.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("keeps edit order when any region is patch-less", () => {
    const out = orderRegions([
      reg("a", [hunkRow(200, 4)]),
      reg("b", [{ kind: "add", oldNo: null, newNo: 1, text: "whole file" }]),
    ]);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("keeps edit order when positioned regions overlap", () => {
    const out = orderRegions([
      reg("a", [hunkRow(100, 10)]),
      reg("b", [hunkRow(105, 3)]),
    ]);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("retried flag", () => {
  it("flags a region whose op had failed attempts", () => {
    const m = build([
      tool(
        "Write",
        "t1",
        { file_path: "/r/a.ts", content: "v1" },
        { content: "File has not been read yet.", isError: true },
      ),
      tool("Read", "t2", { file_path: "/r/a.ts" }),
      tool("Write", "t3", { file_path: "/r/a.ts", content: "v1" }),
    ]);
    expect(m.files[0].hunks[0].retried).toBe(true);
  });

  it("leaves a clean edit unretried", () => {
    const m = build([
      tool("Edit", "t1", { file_path: "/r/a.ts", old_string: "x", new_string: "y" }),
    ]);
    expect(m.files[0].hunks[0].retried).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd webapp/frontend && npx vitest run src/tests/trace/provenance.test.ts`
Expected: FAIL — `orderRegions`/`regionPos` not exported; `retried` undefined.

- [ ] **Step 3: Edit `provenance.ts` — interface, helpers, hunk build**

In the `BlameHunk` interface, remove the `title: string;` line and add:

```ts
  /** True when this op had at least one failed attempt before landing. */
  retried: boolean;
```

In the `hunks.push({ ... })` call inside `buildProvenance`, remove `title: hunkTitle(op.rows, path),` and add:

```ts
        retried: attempts.length > 0,
```

Delete the now-unused `hunkTitle` function and the `clipTitle`, `DECL_EXPORT`, and `DECL_ANY` definitions (they exist only to build the title).

Add the exported helpers (place them after the `heatOf` function):

```ts
// A surviving region's file-absolute line span, parsed from its
// structuredPatch @@ header. Patch-less regions (whole-file Writes,
// MultiEdit-without-patch, LCS fallback) have no @@ row, so they return null
// and keep edit order.
export function regionPos(
  rows: DiffRow[],
): { start: number; end: number } | null {
  const head = rows.find((r) => r.kind === "hunk");
  if (!head) return null;
  const m = /\+(\d+)(?:,(\d+))?/.exec(head.text);
  if (!m) return null;
  const start = Number(m[1]);
  const len = m[2] !== undefined ? Number(m[2]) : 1;
  return { start, end: start + Math.max(len, 1) };
}

// Order a file's surviving regions for the merged block: by file position
// when every region is positioned and none overlap, else keep the given
// (chronological) order.
export function orderRegions(regions: BlameHunk[]): BlameHunk[] {
  if (regions.length < 2) return regions;
  const pos = regions.map((r) => regionPos(r.rows));
  if (pos.some((p) => p === null)) return regions;
  const ranges = pos as Array<{ start: number; end: number }>;
  const order = regions
    .map((_, i) => i)
    .sort((a, b) => ranges[a].start - ranges[b].start);
  for (let k = 1; k < order.length; k++) {
    if (ranges[order[k]].start < ranges[order[k - 1]].end) return regions;
  }
  return order.map((i) => regions[i]);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd webapp/frontend && npx vitest run src/tests/trace/provenance.test.ts`
Expected: PASS (existing model tests unchanged + new helper/retried tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/bhavya/git/vibeshub && test "$(git branch --show-current)" = "provenance-merge-file-captions" && git add webapp/frontend/src/components/trace/provenance.ts webapp/frontend/src/tests/trace/provenance.test.ts && git commit -m "provenance: retried flag + region ordering helpers, retire hunkTitle"
```

---

## Task 6: ProvenanceView — merged file blocks, caption, retry marker, a11y rows

**Files:**
- Modify: `webapp/frontend/src/components/trace/ProvenanceView.tsx`
- Modify: `webapp/frontend/src/components/trace/TraceViewer.tsx`
- Test: `webapp/frontend/src/tests/trace/ProvenanceView.test.tsx` (create)

- [ ] **Step 1: Write the failing render test**

Create `webapp/frontend/src/tests/trace/ProvenanceView.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ProvenanceView } from "../../components/trace/ProvenanceView";
import { buildProvenance } from "../../components/trace/provenance";
import type { Session, StreamEvent } from "../../components/trace/types";
import type { TraceDigest } from "../../types";

function ev(): StreamEvent[] {
  return [
    { kind: "user_prompt", text: "tweak the css", ts: "2026-06-13T10:00:00Z", uuid: "p1" },
    {
      kind: "tool_use",
      name: "Edit",
      input: { file_path: "/r/faq.module.css", old_string: "a", new_string: "b" },
      id: "id-t1",
      ts: "2026-06-13T10:00:01Z",
      msgId: "m1",
      uuid: "t1",
      result: null,
    },
  ];
}

function session(): Session {
  return {
    stream: ev(),
    meta: {
      sessionId: "s1", aiTitle: null, firstPrompt: null, cwd: "/r",
      gitBranch: null, model: null, modelLabel: null, sourceFormat: null,
      version: null, permissionMode: null, startedAt: null, endedAt: null,
      prLink: null, tokens: { input: 0, cacheCreate: 0, cacheRead: 0, output: 0 },
      assistantThinkMs: 0, toolCounts: {}, toolCallCount: 0, userPromptCount: 1,
      assistantTextCount: 0, agents: [],
    },
  };
}

const digest: TraceDigest = {
  ask: "a", decisions: "b", files: "c", tests: "d", dead_ends: "e",
  chapters: [],
  file_notes: [{ path: "/r/faq.module.css", caption: "Tint hover states" }],
};

describe("ProvenanceView merged blocks", () => {
  it("shows the digest caption and renders no hunk boxes", () => {
    const model = buildProvenance(session(), [], "claude-code");
    render(
      <ProvenanceView
        model={model}
        session={session()}
        subagentsLoading={false}
        digest={digest}
        onJump={() => {}}
      />,
    );
    expect(screen.getByText("Tint hover states")).toBeInTheDocument();
    expect(document.querySelector(".prov-hunk")).toBeNull();
    expect(document.querySelector(".prov-htitle")).toBeNull();
  });

  it("makes blame rows keyboard-focusable buttons", () => {
    const model = buildProvenance(session(), [], "claude-code");
    render(
      <ProvenanceView
        model={model}
        session={session()}
        subagentsLoading={false}
        digest={digest}
        onJump={() => {}}
      />,
    );
    const rows = document.querySelectorAll('.prov-ln[role="button"]');
    expect(rows.length).toBeGreaterThan(0);
    expect((rows[0] as HTMLElement).tabIndex).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd webapp/frontend && npx vitest run src/tests/trace/ProvenanceView.test.tsx`
Expected: FAIL — `ProvenanceView` has no `digest` prop; caption not rendered; `.prov-hunk` still present.

- [ ] **Step 3: Rewrite the render in `ProvenanceView.tsx`**

Add to the imports at the top:

```ts
import type { TraceDigest } from "../../types";
```

Add `digest` to `Props`:

```ts
interface Props {
  model: ProvenanceModel;
  session: Session;
  subagentsLoading: boolean;
  digest?: TraceDigest | null;
  onJump: (jumpUuid: string | null, promptUuid: string | null) => void;
}
```

Add fold constants near the existing constants (`PROMPT_CLIP` etc.):

```ts
const FILE_FOLD_THRESHOLD = 80;
const FILE_FOLD_HEAD = 48;
```

Import `orderRegions` from `./provenance` (extend the existing type-only import with a value import):

```ts
import { orderRegions } from "./provenance";
```

Delete the `BlameRows` and `Hunk` components entirely. Replace them with a flattened row view and a file block:

```tsx
interface FlatRow {
  row: DiffRow;
  region: BlameHunk;
  localIdx: number;
}

function FlatRowView({
  entry,
  file,
  lang,
  sel,
  onSelect,
}: {
  entry: FlatRow;
  file: BlameFile;
  lang: string | null;
  sel: Sel | null;
  onSelect: (s: Sel) => void;
}) {
  const { row, region, localIdx } = entry;
  if (row.kind === "hunk") {
    return (
      <div className="prov-ln hunkline">
        <span className="prov-pidx" />
        <span className="prov-band" />
        <span className="prov-heat" />
        <span className="prov-sign" />
        <span className="prov-src">{row.text}</span>
      </div>
    );
  }
  const changed = row.kind !== "ctx";
  const isSel =
    sel !== null && sel.hunk.id === region.id && sel.rowIdx === localIdx;
  const author = region.agentType ? "agent" : "ai";
  const select = () => onSelect({ file, hunk: region, rowIdx: localIdx });
  return (
    <div
      className={
        `prov-ln ${row.kind}` +
        (isSel ? " sel" : "") +
        (region.retried ? " retried" : "")
      }
      role="button"
      tabIndex={0}
      title={region.retried ? "This edit was retried" : undefined}
      onClick={select}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          select();
        }
      }}
    >
      <span className="prov-pidx">
        {changed && region.promptIdx > 0 ? region.promptIdx : ""}
      </span>
      <span
        className="prov-band"
        style={changed ? { background: authorVar(author) } : undefined}
      />
      <span className="prov-heat" aria-hidden="true">
        {[0, 1, 2].map((n) => (
          <i key={n} className={changed && region.heat[localIdx] > n + 1 ? "on" : ""} />
        ))}
      </span>
      <span className="prov-sign">{SIGN[row.kind]}</span>
      {row.kind === "add" ? (
        <span
          className="prov-src diff-code"
          dangerouslySetInnerHTML={{ __html: highlightLine(row.text || " ", lang) }}
        />
      ) : (
        <span className="prov-src">{row.text || " "}</span>
      )}
    </div>
  );
}

function FileBlock({
  file,
  root,
  caption,
  sel,
  onSelect,
}: {
  file: BlameFile;
  root: string | null;
  caption: string | undefined;
  sel: Sel | null;
  onSelect: (s: Sel) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const lang = langFromPath(file.path);
  const regions = orderRegions(file.hunks.filter((h) => !h.superseded));
  const flat: FlatRow[] = [];
  for (const region of regions) {
    region.rows.forEach((row, localIdx) => flat.push({ row, region, localIdx }));
  }
  const retriedCount = regions.filter((r) => r.retried).length;
  const folded =
    flat.length > FILE_FOLD_THRESHOLD && !expanded
      ? flat.slice(0, FILE_FOLD_HEAD)
      : flat;
  const hidden = flat.length - folded.length;
  return (
    <section
      id={changeAnchorId(file.path)}
      className={"prov-file" + (file.status === "ephemeral" ? " ephemeral" : "")}
    >
      <div className="prov-fhead">
        <span className="prov-fpath" title={file.path}>
          {shortenPath(file.path, root)}
        </span>
        <span className={"prov-fstatus " + file.status}>{statusLabel(file)}</span>
        <span className="prov-fstats">
          {file.adds > 0 && <span className="diff-stat-add">+{file.adds}</span>}
          {file.dels > 0 && <span className="diff-stat-del">−{file.dels}</span>}
        </span>
        <span className="prov-fsummary">
          · {regions.length} {regions.length === 1 ? "edit" : "edits"}
          {retriedCount > 0 ? `, ${retriedCount} retried` : ""}
        </span>
      </div>
      {caption && <p className="prov-fcaption">{caption}</p>}
      {flat.length === 0 ? (
        <div className="prov-nodata">no patch data</div>
      ) : (
        <div className="prov-code">
          {folded.map((entry, i) => (
            <FlatRowView
              key={i}
              entry={entry}
              file={file}
              lang={lang}
              sel={sel}
              onSelect={onSelect}
            />
          ))}
          {hidden > 0 && (
            <button
              type="button"
              className="diff-expand"
              onClick={() => setExpanded(true)}
            >
              ▸ show {hidden} more lines
            </button>
          )}
          {expanded && flat.length > FILE_FOLD_THRESHOLD && (
            <button
              type="button"
              className="diff-expand"
              onClick={() => setExpanded(false)}
            >
              ▾ collapse
            </button>
          )}
        </div>
      )}
    </section>
  );
}
```

Replace the file-mapping JSX inside the `ProvenanceView` return (the `{model.files.map((file) => ( <section ...> ... </section> ))}` block) with:

```tsx
          {model.files.map((file) => (
            <FileBlock
              key={file.path}
              file={file}
              root={root}
              caption={captions.get(file.path)}
              sel={sel}
              onSelect={setSel}
            />
          ))}
```

In the `ProvenanceView` function signature add `digest`, and build the caption map at the top of the function body (after `const root = ...`):

```tsx
export function ProvenanceView({
  model,
  session,
  subagentsLoading,
  digest,
  onJump,
}: Props) {
  const root = effectiveRoot(
    model.files.map((f) => f.path),
    session.meta.cwd,
  );
  const captions = new Map(
    (digest?.file_notes ?? []).map((n) => [n.path, n.caption] as const),
  );
  const [sel, setSel] = useState<Sel | null>(null);
```

Note: the `Hunk`/`BlameRows`-specific state and the `COLLAPSE_*` constants they used are now gone; remove any now-unused imports flagged by tsc (e.g. keep `langFromPath`, `highlightLine`, `SIGN`, `authorVar`, `BlameHunk`, `DiffRow`, which are all still used).

- [ ] **Step 4: Wire `ai_digest` through `TraceViewer.tsx`**

In `TraceViewer.tsx`, update the `ProvenanceView` element (around line 143) to pass the digest:

```tsx
            <ProvenanceView
              model={provenance}
              session={session}
              subagentsLoading={subagentsLoading}
              digest={trace.ai_digest}
              onJump={handleJump}
            />
```

- [ ] **Step 5: Run the render test + typecheck**

Run: `cd webapp/frontend && npx vitest run src/tests/trace/ProvenanceView.test.tsx && npx tsc --noEmit`
Expected: PASS render test; no type errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/bhavya/git/vibeshub && test "$(git branch --show-current)" = "provenance-merge-file-captions" && git add webapp/frontend/src/components/trace/ProvenanceView.tsx webapp/frontend/src/components/trace/TraceViewer.tsx webapp/frontend/src/tests/trace/ProvenanceView.test.tsx && git commit -m "provenance view: merged file blocks with digest captions + a11y rows"
```

---

## Task 7: CSS — remove box chrome, add caption/summary/retry/focus styles

**Files:**
- Modify: `webapp/frontend/src/styles/viewer.css`

- [ ] **Step 1: Remove the now-unused hunk-box and stub CSS**

In `viewer.css`, delete the rules for these selectors (the hunk-box chrome and superseded stub, no longer rendered). Verify each is unused first:

Run: `cd webapp/frontend && grep -rn "prov-hunk\|prov-hhead\|prov-htitle\|prov-badge\|prov-hmeta\|prov-stub\|sel-hunk" src --include=*.tsx --include=*.ts`
Expected: no matches in `.ts`/`.tsx` (only CSS). If clean, delete these rule blocks from `viewer.css`:
`.prov-file.ephemeral .prov-hunk`, `.prov-hunk`, `.prov-hunk.sel-hunk`, `.prov-hhead`, `.prov-htitle`, `.prov-htitle:hover`, `.prov-badge`, `.prov-badge.agent`, `.prov-hmeta`, and the entire "superseded stubs" block (`.prov-stub` and its children).

Keep `.prov-nodata`, `.prov-code`, and all `.prov-ln*` / gutter rules.

- [ ] **Step 2: Add `position: relative` to `.prov-ln`**

Change the `.prov-ln` rule (currently starting `display: grid;`) to include `position: relative;`:

```css
.vibeshub-viewer .prov-ln {
  display: grid;
  grid-template-columns: 34px 4px 26px 22px 1fr;
  border-left: 2px solid transparent;
  cursor: pointer;
  white-space: pre;
  position: relative;
}
```

- [ ] **Step 3: Append caption, summary, retry-marker, and focus styles**

Add near the end of the `prov-` section of `viewer.css`:

```css
/* merged file block: caption + summary + retry marker */
.vibeshub-viewer .prov-fcaption {
  margin: 2px 0 8px;
  font-size: 12.5px;
  color: var(--dim);
  line-height: 1.5;
}
.vibeshub-viewer .prov-fsummary {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--faint);
  white-space: nowrap;
}
.vibeshub-viewer .prov-ln.retried::before {
  content: "";
  position: absolute;
  left: 30px;
  top: 50%;
  width: 3px;
  height: 3px;
  margin-top: -1.5px;
  border-radius: 50%;
  background: var(--t-write);
}
.vibeshub-viewer .prov-ln[role="button"]:focus-visible {
  outline: 1px solid var(--strong);
  outline-offset: -1px;
}
```

- [ ] **Step 4: Build + full frontend test suite**

Run: `cd webapp/frontend && npm run build && npx vitest run`
Expected: build succeeds; all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/bhavya/git/vibeshub && test "$(git branch --show-current)" = "provenance-merge-file-captions" && git add webapp/frontend/src/styles/viewer.css && git commit -m "provenance view: drop hunk-box CSS, add caption/summary/retry styles"
```

---

## Final verification

- [ ] **Backend digest suite**

Run: `cd webapp/backend && env/bin/pytest tests/agents/digest -q`
Expected: PASS.

- [ ] **Frontend suite + build**

Run: `cd webapp/frontend && npx vitest run && npm run build`
Expected: PASS, build clean.

- [ ] **Manual check against the real trace** (the proxy in `vite.config.ts` targets prod)

Run: `cd webapp/frontend && npm run dev`, open
`http://localhost:5173/vibeshub/vibeshub/pull/129/plkgd4cln2`
Confirm: each file renders as one merged block ordered by file position; no per-edit boxes/titles; retried edits show the faint gutter dot; clicking a line opens its provenance with the attempt list; file headers show the digest caption when present (note: this prod trace's persisted digest predates `file_notes`, so captions appear only after a re-upload; the merged layout and retry markers are visible regardless).

## Self-review notes (author)

- **Spec coverage:** edit previews (Task 1), edited-path validation (Tasks 1+3), `file_notes` schema/prompt (Task 2), em-dash sweep + extra (Task 3), frontend types (Task 4), retried flag + file-position ordering + overlap/patch-less fallback (Task 5), merged render + caption + a11y + retry marker + wiring (Task 6), CSS (Task 7). All spec sections mapped.
- **Naming:** `BlameHunk`/`hunks` kept throughout (documented deviation); `regionPos`/`orderRegions`/`FlatRow`/`FileBlock`/`FlatRowView`/`captions`/`retried` used consistently across Tasks 5-7.
- **Caps:** `file_notes` max 20, caption 140 chars, preview 3 lines / 80 chars per line, file fold 80/48 — consistent between schema, prompt, distiller, and view.
