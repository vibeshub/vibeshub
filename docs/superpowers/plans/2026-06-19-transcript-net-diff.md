# Transcript Net Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the trace "Changes" tab default to a clean, consolidated before/after net diff per file (GitHub-style), reconstructed from data already in the transcript, with per-line provenance in the side panel.

**Architecture:** Four units. (1) `changes.ts` enriches each edit op with the full pre/post file content already present in the tool result. (2) New pure `netdiff.ts` reconstructs one net diff per file via the existing `fallbackDiff`, with best-effort per-line attribution. (3) `provenance.ts` attaches the net result onto each `BlameFile`. (4) `ProvenanceView.tsx` renders the net diff as the default view (reusing `DiffView`'s row classes) and routes clicks to the provenance chain or a new file-level panel. Files lacking the content fields fall back, per file, to today's per-op view.

**Tech Stack:** TypeScript, React, Vitest + @testing-library/react. All work is under `webapp/frontend/`.

## Global Constraints

- Frontend-only. No backend, storage, schema, or plugin changes.
- Run from `webapp/frontend/`. Test runner: `npx vitest run <path>` (config: `webapp/frontend/vite.config.ts`).
- No em-dashes (`—`) in any user-facing string. Use commas, periods, parentheses, or the existing minus glyph `−` for deletion counts (matches current code).
- TypeScript strict: no `any`. Reuse existing exported types.
- Follow existing patterns in `src/components/trace/`. Net diff rows reuse the existing `diff-row` / `diff-gutter` / `diff-mark` / `diff-code` CSS classes (defined in `src/styles/viewer.css`, used by `DiffView.tsx`).
- Commit after each task.

---

### Task 1: Capture pre/post file content on each edit op

The net diff needs the full original and final file text. Claude Code already stores both on every Edit/Write/MultiEdit tool result (`toolUseResult.originalFile`, `toolUseResult.content`); the op model just drops them today. This task threads them onto `EditOp`.

**Files:**
- Modify: `webapp/frontend/src/components/trace/changes.ts` (interface `EditOp` at lines 92-107; function `opsFromTool` at lines 109-184)
- Test: `webapp/frontend/src/tests/trace/changes.test.ts` (create)

**Interfaces:**
- Consumes: `ToolUseEvent.result.toolUseResult` (untyped `Record<string, unknown>`, already on the type at `types.ts:60`).
- Produces: `EditOp.originalFile: string | null` and `EditOp.finalContent: string | null` on every collected op. Later tasks read these.

- [ ] **Step 1: Write the failing test**

Create `webapp/frontend/src/tests/trace/changes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { collectOps } from "../../components/trace/changes";
import type { StreamEvent, ToolResult } from "../../components/trace/types";

function editEvent(result: ToolResult | null): StreamEvent {
  return {
    kind: "tool_use",
    name: "Edit",
    input: { file_path: "/r/a.ts", old_string: "x", new_string: "y" },
    id: "id1",
    ts: "2026-06-19T10:00:00Z",
    msgId: "m1",
    uuid: "t1",
    result,
  };
}

describe("collectOps captures file content for the net diff", () => {
  it("reads originalFile and content from toolUseResult", () => {
    const { ops } = collectOps(
      [
        editEvent({
          content: "ok",
          toolUseResult: { originalFile: "before", content: "after" },
        }),
      ],
      [],
    );
    expect(ops).toHaveLength(1);
    expect(ops[0].originalFile).toBe("before");
    expect(ops[0].finalContent).toBe("after");
  });

  it("leaves them null when toolUseResult is absent", () => {
    const { ops } = collectOps([editEvent(null)], []);
    expect(ops[0].originalFile).toBeNull();
    expect(ops[0].finalContent).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/trace/changes.test.ts`
Expected: FAIL with a type/property error or `expected undefined to be "before"` (the fields do not exist yet).

- [ ] **Step 3: Add the fields to `EditOp`**

In `changes.ts`, add two fields at the end of the `EditOp` interface (after `oldStrings: string[];` at line 106):

```ts
  oldStrings: string[]; // supersede sources
  originalFile: string | null; // full pre-edit file content, when captured
  finalContent: string | null; // full post-edit file content, when captured
}
```

- [ ] **Step 4: Populate them in `opsFromTool`**

In `changes.ts`, inside `opsFromTool`, just after the `const patch = extractPatch(...)` line (line 118), read the two fields, then add them to the `base` object:

```ts
  const patch = extractPatch(e.result?.toolUseResult?.structuredPatch);
  const tur = e.result?.toolUseResult;
  const originalFile =
    tur && typeof tur.originalFile === "string" ? tur.originalFile : null;
  const finalContent =
    tur && typeof tur.content === "string" ? tur.content : null;
  // seq is assigned post-hoc in collectOps once all ops are collected.
  const base = {
    path,
    tool: e.name,
    ts: e.ts,
    seq: 0,
    streamPos,
    jumpUuid,
    prompt,
    agentBadge,
    failed: !!e.result?.isError,
    errorText: resultErrorText(e),
    originalFile,
    finalContent,
  };
```

Both return paths in `opsFromTool` spread `...base`, so the MultiEdit-without-patch ops and the normal op both carry the fields.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/tests/trace/changes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add webapp/frontend/src/components/trace/changes.ts webapp/frontend/src/tests/trace/changes.test.ts
git commit -m "Capture pre/post file content on each edit op"
```

---

### Task 2: Net-diff builder (`netdiff.ts`)

A pure module that turns one file's successful ops into a single consolidated diff plus per-line attribution. No React, fully unit-testable.

**Files:**
- Create: `webapp/frontend/src/components/trace/netdiff.ts`
- Test: `webapp/frontend/src/tests/trace/netdiff.test.ts` (create)

**Interfaces:**
- Consumes: `EditOp` (with `originalFile` / `finalContent` from Task 1), `DiffRow` and `fallbackDiff` from `diff.ts`.
- Produces:
  - `export type NetRow = DiffRow & { hunkId: string | null }`
  - `export interface NetFileData { netRows: NetRow[]; netAdds: number; netDels: number; hasNetData: boolean }`
  - `export function buildNetFile(path: string, okOps: EditOp[], deleted?: boolean): NetFileData`
  - `hunkId` uses the same format as `BlameHunk.id` in `provenance.ts`: `` `${path}#${op.seq}` ``.

- [ ] **Step 1: Write the failing test**

Create `webapp/frontend/src/tests/trace/netdiff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildNetFile } from "../../components/trace/netdiff";
import type { EditOp } from "../../components/trace/changes";

function makeOp(over: Partial<EditOp>): EditOp {
  return {
    path: "/r/a.ts",
    tool: "Edit",
    ts: "",
    seq: 0,
    streamPos: 0,
    jumpUuid: null,
    prompt: { uuid: null, ordinal: 0, excerpt: "", turnLabel: "session start" },
    agentBadge: null,
    isWrite: false,
    failed: false,
    errorText: null,
    rows: [],
    newContents: [],
    oldStrings: [],
    originalFile: null,
    finalContent: null,
    ...over,
  };
}

const kinds = (d: { netRows: { kind: string; text: string }[] }) =>
  d.netRows.map((r) => [r.kind, r.text]);

describe("buildNetFile", () => {
  it("renders a created file as all additions", () => {
    const op = makeOp({
      tool: "Write",
      isWrite: true,
      finalContent: "a\nb",
      newContents: ["a\nb"],
    });
    const net = buildNetFile("/r/a.ts", [op]);
    expect(net.hasNetData).toBe(true);
    expect(net.netAdds).toBe(2);
    expect(net.netDels).toBe(0);
    expect(kinds(net)).toEqual([
      ["add", "a"],
      ["add", "b"],
    ]);
  });

  it("diffs an edited file from its captured original and attributes the add", () => {
    const op = makeOp({
      seq: 7,
      originalFile: "a\nb\nc",
      finalContent: "a\nx\nc",
      newContents: ["x"],
    });
    const net = buildNetFile("/r/a.ts", [op]);
    expect(kinds(net)).toEqual([
      ["ctx", "a"],
      ["del", "b"],
      ["add", "x"],
      ["ctx", "c"],
    ]);
    expect(net.netRows.find((r) => r.kind === "add")!.hunkId).toBe("/r/a.ts#7");
    expect(net.netRows.find((r) => r.kind === "ctx")!.hunkId).toBeNull();
    expect(net.netRows.find((r) => r.kind === "del")!.hunkId).toBeNull();
  });

  it("uses the first original and the last content across edits", () => {
    const op1 = makeOp({ seq: 1, originalFile: "a", finalContent: "a\nb", newContents: ["b"] });
    const op2 = makeOp({ seq: 2, originalFile: "a\nb", finalContent: "a\nB", newContents: ["B"] });
    const net = buildNetFile("/r/a.ts", [op1, op2]);
    expect(kinds(net)).toEqual([
      ["ctx", "a"],
      ["add", "B"],
    ]);
    expect(net.netRows.find((r) => r.kind === "add")!.hunkId).toBe("/r/a.ts#2");
  });

  it("attributes a shared line to the latest op that wrote it", () => {
    const op1 = makeOp({ seq: 1, isWrite: true, tool: "Write", originalFile: "", finalContent: "shared", newContents: ["shared"] });
    const op2 = makeOp({ seq: 2, originalFile: "shared", finalContent: "shared", newContents: ["shared"] });
    const net = buildNetFile("/r/a.ts", [op1, op2]);
    expect(net.netRows.find((r) => r.kind === "add")!.hunkId).toBe("/r/a.ts#2");
  });

  it("reports an edit-then-revert as no net change", () => {
    const op1 = makeOp({ seq: 1, originalFile: "orig", finalContent: "changed", newContents: ["changed"] });
    const op2 = makeOp({ seq: 2, originalFile: "changed", finalContent: "orig", newContents: ["orig"] });
    const net = buildNetFile("/r/a.ts", [op1, op2]);
    expect(net.hasNetData).toBe(true);
    expect(net.netAdds).toBe(0);
    expect(net.netDels).toBe(0);
    expect(net.netRows.map((r) => r.kind)).toEqual(["ctx"]);
  });

  it("renders a deleted file as all deletions", () => {
    const op = makeOp({ seq: 1, originalFile: "a\nb", finalContent: "a\nb", newContents: ["a\nb"] });
    const net = buildNetFile("/r/a.ts", [op], true);
    expect(net.netAdds).toBe(0);
    expect(net.netDels).toBe(2);
    expect(net.netRows.map((r) => r.kind)).toEqual(["del", "del"]);
  });

  it("falls back when an edit lacks a captured original", () => {
    const op = makeOp({ tool: "Edit", isWrite: false, originalFile: null, finalContent: "after" });
    expect(buildNetFile("/r/a.ts", [op]).hasNetData).toBe(false);
  });

  it("falls back when there is no captured final content", () => {
    const op = makeOp({ tool: "Write", isWrite: true, originalFile: null, finalContent: null });
    expect(buildNetFile("/r/a.ts", [op]).hasNetData).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/trace/netdiff.test.ts`
Expected: FAIL with "Failed to resolve import .../netdiff" (module does not exist).

- [ ] **Step 3: Write `netdiff.ts`**

Create `webapp/frontend/src/components/trace/netdiff.ts`:

```ts
import type { EditOp } from "./changes";
import type { DiffRow } from "./diff";
import { fallbackDiff } from "./diff";

// netdiff.ts — reconstructs one consolidated before/after diff per file from the
// transcript's captured pre/post file content, with best-effort per-line
// attribution back to the op that wrote each line.

// A net-diff row plus its provenance link: hunkId points at the BlameHunk
// (`${path}#${seq}`) of the op that last wrote this line, or null when the line
// is context, a deletion, or could not be confidently attributed (file-level).
export type NetRow = DiffRow & { hunkId: string | null };

export interface NetFileData {
  netRows: NetRow[];
  netAdds: number;
  netDels: number;
  hasNetData: boolean;
}

const EMPTY: NetFileData = {
  netRows: [],
  netAdds: 0,
  netDels: 0,
  hasNetData: false,
};

// The distinct, trimmed, non-empty lines each op emitted, in op order.
function introducedLines(
  ops: EditOp[],
): Array<{ seq: number; lines: Set<string> }> {
  return ops.map((op) => {
    const lines = new Set<string>();
    for (const content of op.newContents) {
      for (const raw of content.split("\n")) {
        const t = raw.trim();
        if (t) lines.add(t);
      }
    }
    return { seq: op.seq, lines };
  });
}

// Attribute each added line to the latest op that emitted it. Context and
// deletion rows are file-level (null); the panel resolves null to the file view.
function attribute(rows: DiffRow[], ops: EditOp[], path: string): NetRow[] {
  const intro = introducedLines(ops);
  return rows.map((row) => {
    if (row.kind !== "add") return { ...row, hunkId: null };
    const t = row.text.trim();
    for (let i = intro.length - 1; i >= 0; i--) {
      if (t && intro[i].lines.has(t)) {
        return { ...row, hunkId: `${path}#${intro[i].seq}` };
      }
    }
    return { ...row, hunkId: null };
  });
}

// Reconstruct the net before/after for one file from its successful ops, sorted
// ascending. baseline = the first op's originalFile (or "" for an in-session
// create); final = the last op's finalContent (or "" when the file was deleted).
// Returns hasNetData:false when either endpoint cannot be resolved, so the
// caller can fall back to the per-op view.
export function buildNetFile(
  path: string,
  okOps: EditOp[],
  deleted = false,
): NetFileData {
  if (okOps.length === 0) return EMPTY;
  const first = okOps[0];
  const last = okOps[okOps.length - 1];

  let baseline: string;
  if (typeof first.originalFile === "string") baseline = first.originalFile;
  else if (first.isWrite) baseline = "";
  else return EMPTY; // an Edit with no captured original: cannot reconstruct

  let final: string;
  if (deleted) final = "";
  else if (typeof last.finalContent === "string") final = last.finalContent;
  else return EMPTY; // no captured final content

  const rows = fallbackDiff(baseline, final);
  return {
    netRows: attribute(rows, okOps, path),
    netAdds: rows.filter((r) => r.kind === "add").length,
    netDels: rows.filter((r) => r.kind === "del").length,
    hasNetData: true,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tests/trace/netdiff.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/components/trace/netdiff.ts webapp/frontend/src/tests/trace/netdiff.test.ts
git commit -m "Add pure net-diff builder with per-line attribution"
```

---

### Task 3: Attach net data to `BlameFile` in `provenance.ts`

Wire the builder into the model. `buildProvenance` keeps producing the per-op records exactly as today; we add four net fields to each `BlameFile`.

**Files:**
- Modify: `webapp/frontend/src/components/trace/provenance.ts` (imports near line 10; `BlameFile` interface at lines 79-85; per-file `files.push` at lines 649-653)
- Test: `webapp/frontend/src/tests/trace/provenance.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `buildNetFile`, `NetRow` from `netdiff.ts`; the in-scope `okOps` and `status` already computed in the per-file loop.
- Produces: `BlameFile.netRows: NetRow[]`, `BlameFile.netAdds: number`, `BlameFile.netDels: number`, `BlameFile.hasNetData: boolean`. The render layer (Tasks 4-5) reads these.

- [ ] **Step 1: Write the failing test**

Add to `webapp/frontend/src/tests/trace/provenance.test.ts`. First add a result helper near the other helpers (after `failRun` around line 81):

```ts
function fileResult(originalFile: string | null, content: string): ToolResult {
  return {
    content: "ok",
    toolUseResult: {
      ...(originalFile === null ? {} : { originalFile }),
      content,
    },
  };
}
```

Then add this describe block at the end of the file:

```ts
describe("net diff on BlameFile", () => {
  it("reconstructs the net before/after for an edited file", () => {
    const m = build([
      tool(
        "Edit",
        "t1",
        { file_path: "/r/a.ts", old_string: "b", new_string: "x" },
        fileResult("a\nb\nc", "a\nx\nc"),
      ),
    ]);
    const f = m.files[0];
    expect(f.hasNetData).toBe(true);
    expect(f.netAdds).toBe(1);
    expect(f.netDels).toBe(1);
    expect(f.netRows.map((r) => [r.kind, r.text])).toEqual([
      ["ctx", "a"],
      ["del", "b"],
      ["add", "x"],
      ["ctx", "c"],
    ]);
    expect(f.netRows.find((r) => r.kind === "add")!.hunkId).toBe(f.hunks[0].id);
  });

  it("falls back (hasNetData false) when content was not captured", () => {
    const m = build([
      tool("Edit", "t1", { file_path: "/r/a.ts", old_string: "x", new_string: "y" }),
    ]);
    expect(m.files[0].hasNetData).toBe(false);
    expect(m.files[0].netRows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/trace/provenance.test.ts -t "net diff on BlameFile"`
Expected: FAIL (`hasNetData` / `netRows` do not exist on the file).

- [ ] **Step 3: Add imports**

In `provenance.ts`, after the `import type { DiffRow } from "./diff";` line (line 10):

```ts
import type { DiffRow } from "./diff";
import { buildNetFile } from "./netdiff";
import type { NetRow } from "./netdiff";
```

- [ ] **Step 4: Extend the `BlameFile` interface**

In `provenance.ts`, the `BlameFile` interface (lines 79-85) becomes:

```ts
export interface BlameFile {
  path: string;
  status: BlameFileStatus;
  adds: number; // surviving hunks only
  dels: number;
  hunks: BlameHunk[];
  // Net before/after of the whole file (Task 2). netAdds/netDels are the
  // net counts; hasNetData is false when the view must fall back to hunks.
  netRows: NetRow[];
  netAdds: number;
  netDels: number;
  hasNetData: boolean;
}
```

- [ ] **Step 5: Populate the net fields where the file is pushed**

In `provenance.ts`, replace the `files.push({ ... })` block (lines 649-653) with:

```ts
    const net = buildNetFile(path, okOps, status === "ephemeral");
    files.push({
      file: {
        path,
        status,
        adds: fileAdds,
        dels: fileDels,
        hunks,
        netRows: net.netRows,
        netAdds: net.netAdds,
        netDels: net.netDels,
        hasNetData: net.hasNetData,
      },
      firstTs: first.ts,
      firstSeq: first.seq,
    });
```

(`okOps` is in scope from line 559; `status` from lines 643-647.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/tests/trace/provenance.test.ts`
Expected: PASS (all existing tests plus the 2 new ones; existing tests use `result: null`, so their files report `hasNetData:false` and are unaffected).

- [ ] **Step 7: Commit**

```bash
git add webapp/frontend/src/components/trace/provenance.ts webapp/frontend/src/tests/trace/provenance.test.ts
git commit -m "Attach net-diff data to BlameFile"
```

---

### Task 4: Render the net diff as the default Changes view

When a file has net data, render one consolidated diff (reusing `DiffView`'s row classes) instead of the per-op hunk groups. Added lines are clickable and select their attributed hunk through the existing selection model. Files without net data keep today's per-op rendering. The side-panel changes (file-level mode) come in Task 5.

**Files:**
- Modify: `webapp/frontend/src/components/trace/ProvenanceView.tsx` (add `NetRowView`; `FileBlock` at lines 287-369; `FilesIndex` counts at lines 142-143 and 191-192)
- Modify: `webapp/frontend/src/styles/viewer.css` (append clickable/selected styles for net rows)
- Test: `webapp/frontend/src/tests/trace/ProvenanceView.test.tsx` (add a describe block)

**Interfaces:**
- Consumes: `BlameFile.netRows` / `netAdds` / `netDels` / `hasNetData` (Task 3); `NetRow` from `netdiff.ts`; existing `Sel` (`{ file, hunk, rowIdx }`), `highlightLine`, `langFromPath`.
- Produces: net rows rendered as `.diff-row` elements inside `.prov-code.net`; added rows are `role="button"` with class `net-click` and call `onSelect({ file, hunk, rowIdx: null })` with the hunk resolved from `row.hunkId`.

- [ ] **Step 1: Write the failing test**

Add to `webapp/frontend/src/tests/trace/ProvenanceView.test.tsx`. First add helpers near the top (after `retriedStream`):

```ts
import type { ToolResult } from "../../components/trace/types";

function netResult(originalFile: string | null, content: string): ToolResult {
  return {
    content: "ok",
    toolUseResult: {
      ...(originalFile === null ? {} : { originalFile }),
      content,
    },
  };
}

function netStream(): StreamEvent[] {
  return [
    { kind: "user_prompt", text: "edit it", ts: "2026-06-13T10:00:00Z", uuid: "p1" },
    {
      kind: "tool_use",
      name: "Edit",
      input: { file_path: "/r/a.ts", old_string: "b", new_string: "x" },
      id: "id-t1",
      ts: "2026-06-13T10:00:01Z",
      msgId: "m1",
      uuid: "t1",
      result: netResult("a\nb\nc", "a\nx\nc"),
    },
  ];
}
```

Then add this describe block:

```ts
describe("ProvenanceView net diff", () => {
  function renderNet() {
    const model = buildProvenance(session(netStream()), [], "claude-code");
    render(
      <ProvenanceView
        model={model}
        session={session(netStream())}
        subagentsLoading={false}
        digest={null}
        onJump={() => {}}
      />,
    );
  }

  it("renders one consolidated diff with net add/del rows", () => {
    renderNet();
    const code = document.querySelector(".prov-code.net");
    expect(code).not.toBeNull();
    const add = [...document.querySelectorAll(".diff-row.diff-add")].find((el) =>
      el.textContent?.includes("x"),
    );
    expect(add).toBeTruthy();
    expect(document.querySelector(".diff-row.diff-del")).not.toBeNull();
  });

  it("makes added rows clickable buttons", () => {
    renderNet();
    const btn = document.querySelector('.diff-row.net-click[role="button"]');
    expect(btn).not.toBeNull();
    expect((btn as HTMLElement).tabIndex).toBe(0);
  });

  it("shows the net change counts in the file header", () => {
    renderNet();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("−1")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/trace/ProvenanceView.test.tsx -t "net diff"`
Expected: FAIL (no `.prov-code.net` / `.net-click` elements yet).

- [ ] **Step 3: Add the `NetRowView` component**

In `ProvenanceView.tsx`, add this component just above `FileBlock` (before line 287). It imports nothing new; `NetRow` comes from a type import added in Step 4:

```tsx
const NET_MARK: Record<DiffRow["kind"], string> = {
  add: "+",
  del: "-",
  ctx: "",
  hunk: "",
};

function NetRowView({
  row,
  lang,
  selectedHunkId,
  onPick,
}: {
  row: NetRow;
  lang: string | null;
  selectedHunkId: string | null;
  onPick: (hunkId: string) => void;
}) {
  if (row.kind === "hunk") {
    return (
      <div className="diff-row diff-hunk">
        <span className="diff-gutter" />
        <span className="diff-gutter" />
        <span className="diff-mark" />
        <span className="diff-code">{row.text}</span>
      </div>
    );
  }
  const clickable = row.kind === "add" && row.hunkId !== null;
  const isSel =
    selectedHunkId !== null && row.hunkId === selectedHunkId && clickable;
  const pick = clickable ? () => onPick(row.hunkId as string) : undefined;
  return (
    <div
      className={
        `diff-row diff-${row.kind}` +
        (clickable ? " net-click" : "") +
        (isSel ? " net-sel" : "")
      }
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={pick}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                pick?.();
              }
            }
          : undefined
      }
    >
      <span className="diff-gutter">{row.oldNo ?? ""}</span>
      <span className="diff-gutter">{row.newNo ?? ""}</span>
      <span className="diff-mark">{NET_MARK[row.kind]}</span>
      <span
        className="diff-code"
        dangerouslySetInnerHTML={{ __html: highlightLine(row.text || " ", lang) }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Import `NetRow`**

In `ProvenanceView.tsx`, after the existing `import type { DiffRow } from "./diff";` (line 9):

```tsx
import type { DiffRow } from "./diff";
import type { NetRow } from "./netdiff";
```

- [ ] **Step 5: Branch `FileBlock` to the net view**

In `ProvenanceView.tsx`, inside `FileBlock`, insert the net branch immediately after `const lang = langFromPath(file.path);` (line 301), before the existing `const regions = ...` line. This returns early for net-data files; the existing per-op code below is the unchanged fallback:

```tsx
  const lang = langFromPath(file.path);

  if (file.hasNetData) {
    const rows = file.netRows;
    const folded =
      rows.length > FILE_FOLD_THRESHOLD && !expanded
        ? rows.slice(0, FILE_FOLD_HEAD)
        : rows;
    const hidden = rows.length - folded.length;
    const selectHunk = (hunkId: string) => {
      const hunk = file.hunks.find((h) => h.id === hunkId);
      if (hunk) onSelect({ file, hunk, rowIdx: null });
    };
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
            {file.netAdds > 0 && <span className="diff-stat-add">+{file.netAdds}</span>}
            {file.netDels > 0 && <span className="diff-stat-del">−{file.netDels}</span>}
          </span>
        </div>
        {caption && <p className="prov-fcaption">{caption}</p>}
        {rows.length === 0 ? (
          <div className="prov-nodata">no net change</div>
        ) : (
          <div className="prov-code net">
            {folded.map((row, i) => (
              <NetRowView
                key={i}
                row={row}
                lang={lang}
                selectedHunkId={sel && sel.file.path === file.path ? sel.hunk.id : null}
                onPick={selectHunk}
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
            {expanded && rows.length > FILE_FOLD_THRESHOLD && (
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

  const regions = orderRegions(file.hunks.filter((h) => !h.superseded));
```

(`sel.hunk.id` is safe here because Task 4 leaves `Sel.hunk` non-null; Task 5 makes it nullable and updates this line.)

- [ ] **Step 6: Use net counts in `FilesIndex`**

In `ProvenanceView.tsx`, in `FilesIndex`, change the totals (lines 142-143) to prefer net counts:

```tsx
  const adds = files.reduce((n, f) => n + (f.hasNetData ? f.netAdds : f.adds), 0);
  const dels = files.reduce((n, f) => n + (f.hasNetData ? f.netDels : f.dels), 0);
```

And in the per-file index item, replace the `f.adds`/`f.dels` spans (lines 191-192) with locals computed inside the `.map`:

```tsx
          {files.map((f) => {
            const fa = f.hasNetData ? f.netAdds : f.adds;
            const fd = f.hasNetData ? f.netDels : f.dels;
            return (
              <button
                key={f.path}
                type="button"
                className="prov-index-item"
                onClick={() =>
                  document
                    .getElementById(changeAnchorId(f.path))
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              >
                <span className="prov-index-path">{shortenPath(f.path, root)}</span>
                {f.status !== "mod" && (
                  <span className={"prov-index-status " + f.status}>{f.status}</span>
                )}
                {fa > 0 && <span className="diff-stat-add">+{fa}</span>}
                {fd > 0 && <span className="diff-stat-del">−{fd}</span>}
              </button>
            );
          })}
```

- [ ] **Step 7: Add the net-row interaction styles**

Append to `webapp/frontend/src/styles/viewer.css` (net rows reuse the existing `.diff-row` layout/colors; these two rules only add the click affordance and selection highlight):

```css
/* Net-diff rows: clickable added lines + selected state */
.prov-code.net .diff-row.net-click {
  cursor: pointer;
}
.prov-code.net .diff-row.net-click:hover {
  filter: brightness(1.08);
}
.prov-code.net .diff-row.net-sel {
  outline: 1px solid var(--acc);
  outline-offset: -1px;
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/tests/trace/ProvenanceView.test.tsx`
Expected: PASS (existing merged-block tests still pass via the `result: null` fallback path; the 3 new net-diff tests pass).

- [ ] **Step 9: Commit**

```bash
git add webapp/frontend/src/components/trace/ProvenanceView.tsx webapp/frontend/src/styles/viewer.css webapp/frontend/src/tests/trace/ProvenanceView.test.tsx
git commit -m "Render net diff as the default Changes view"
```

---

### Task 5: Side-panel attribution and file-level mode

Make every net row clickable: added lines open the attributed op's provenance chain (existing panel); context, deletions, and unattributed lines open a new file-level aggregate. This requires `Sel.hunk` to become nullable.

**Files:**
- Modify: `webapp/frontend/src/components/trace/ProvenanceView.tsx` (`Sel` interface at lines 20-24; `NetRowView`; the net branch of `FileBlock`; `Panel` at lines 394-551)
- Test: `webapp/frontend/src/tests/trace/ProvenanceView.test.tsx` (add a describe block)

**Interfaces:**
- Consumes: `BlameFile.hunks`, `model.prompts`, `BlameHunk.verifications` / `promptIdx` / `retried`.
- Produces: `Sel.hunk: BlameHunk | null`. When null, `Panel` renders a file-level aggregate (edit count, retried count, the prompts that touched the file with jump links, and de-duplicated verification chips).

- [ ] **Step 1: Write the failing test**

Add to `ProvenanceView.test.tsx` (reuses `netResult` / `netStream` from Task 4). Add `fireEvent` to the testing-library import at the top: `import { render, screen, fireEvent } from "@testing-library/react";`. Then:

```ts
describe("ProvenanceView net panel", () => {
  function renderNet() {
    const model = buildProvenance(session(netStream()), [], "claude-code");
    render(
      <ProvenanceView
        model={model}
        session={session(netStream())}
        subagentsLoading={false}
        digest={null}
        onJump={() => {}}
      />,
    );
  }

  it("opens the attributed prompt chain when an added line is clicked", () => {
    renderNet();
    const add = document.querySelector('.diff-row.net-click[role="button"]') as HTMLElement;
    fireEvent.click(add);
    // The op was made under prompt "edit it"; the chain quotes it.
    expect(screen.getByText(/edit it/)).toBeInTheDocument();
  });

  it("opens the file-level view when a context line is clicked", () => {
    renderNet();
    const ctx = [...document.querySelectorAll(".diff-row.diff-ctx")].find((el) =>
      el.textContent?.includes("a"),
    ) as HTMLElement;
    fireEvent.click(ctx);
    expect(screen.getByText(/Prompts that touched this file/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/trace/ProvenanceView.test.tsx -t "net panel"`
Expected: FAIL (context rows are not clickable; no file-level panel text).

- [ ] **Step 3: Make `Sel.hunk` nullable**

In `ProvenanceView.tsx`, the `Sel` interface (lines 20-24) becomes:

```tsx
interface Sel {
  file: BlameFile;
  hunk: BlameHunk | null; // null = file-level provenance
  rowIdx: number | null;
}
```

- [ ] **Step 4: Make all net rows clickable in `NetRowView`**

Replace the `NetRowView` body from Task 4 so non-hunk rows are always clickable and emit `hunkId | null`. Change its `onPick` signature to accept `string | null`:

```tsx
function NetRowView({
  row,
  lang,
  selectedHunkId,
  onPick,
}: {
  row: NetRow;
  lang: string | null;
  selectedHunkId: string | null;
  onPick: (hunkId: string | null) => void;
}) {
  if (row.kind === "hunk") {
    return (
      <div className="diff-row diff-hunk">
        <span className="diff-gutter" />
        <span className="diff-gutter" />
        <span className="diff-mark" />
        <span className="diff-code">{row.text}</span>
      </div>
    );
  }
  const attributed = row.kind === "add" && row.hunkId !== null;
  const isSel = attributed && selectedHunkId !== null && row.hunkId === selectedHunkId;
  const pick = () => onPick(attributed ? (row.hunkId as string) : null);
  return (
    <div
      className={
        `diff-row diff-${row.kind} net-click` + (isSel ? " net-sel" : "")
      }
      role="button"
      tabIndex={0}
      onClick={pick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          pick();
        }
      }}
    >
      <span className="diff-gutter">{row.oldNo ?? ""}</span>
      <span className="diff-gutter">{row.newNo ?? ""}</span>
      <span className="diff-mark">{NET_MARK[row.kind]}</span>
      <span
        className="diff-code"
        dangerouslySetInnerHTML={{ __html: highlightLine(row.text || " ", lang) }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Update the `FileBlock` net branch to select null for file-level**

In the net branch of `FileBlock`, replace `selectHunk` and the `selectedHunkId` prop wiring:

```tsx
    const selectRow = (hunkId: string | null) => {
      const hunk = hunkId ? file.hunks.find((h) => h.id === hunkId) ?? null : null;
      onSelect({ file, hunk, rowIdx: null });
    };
```

and in the `NetRowView` usage:

```tsx
              <NetRowView
                key={i}
                row={row}
                lang={lang}
                selectedHunkId={
                  sel && sel.file.path === file.path && sel.hunk ? sel.hunk.id : null
                }
                onPick={selectRow}
              />
```

(The `sel.hunk.id` access is now guarded by `sel.hunk`, matching the nullable type.)

- [ ] **Step 6: Add the file-level branch to `Panel`**

In `ProvenanceView.tsx`, at the start of `Panel`'s body, after the existing `if (!sel) { ... }` empty-state block (which ends at line 446) and before `const { hunk, file, rowIdx } = sel;` (line 448), insert a file-level branch:

```tsx
  if (sel.hunk === null) {
    const f = sel.file;
    const editCount = f.hunks.length;
    const retried = f.hunks.filter((h) => h.retried).length;
    const promptIdxs = [
      ...new Set(f.hunks.map((h) => h.promptIdx).filter((i) => i > 0)),
    ];
    const seen = new Set<string>();
    const verifs = f.hunks
      .flatMap((h) => h.verifications)
      .filter((v) => v.status !== "none")
      .filter((v) => (seen.has(v.label) ? false : (seen.add(v.label), true)));
    return (
      <aside className="prov-panel has-sel">
        <button type="button" className="prov-panel-close" onClick={onClose}>
          ✕
        </button>
        <h2>File · {shortenPath(f.path, root).split("/").pop()}</h2>
        <div className="prov-chain">
          <div className="prov-step">
            <h3>
              {editCount} {editCount === 1 ? "edit" : "edits"}
              {retried > 0 ? `, ${retried} retried` : ""}
            </h3>
          </div>
          <div className="prov-step prompt">
            <h3>Prompts that touched this file</h3>
            {promptIdxs.map((idx) => {
              const p = model.prompts[idx - 1];
              return p ? (
                <p className="q" key={idx}>
                  №{p.idx} “{clip(p.text, 200)}”
                  {p.uuid && (
                    <button
                      type="button"
                      className="prov-jump"
                      onClick={() => onJump(p.uuid, p.uuid)}
                    >
                      ↗
                    </button>
                  )}
                </p>
              ) : null;
            })}
          </div>
          {verifs.length > 0 && (
            <div className="prov-step verify">
              <h3>Verified by</h3>
              <div className="prov-vrow">
                {verifs.map((v, i) => (
                  <span key={i} className={"prov-vchip " + v.status}>
                    {v.status === "pass" ? "✓" : v.status === "fail" ? "✗" : "○"} {v.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>
    );
  }

  const { hunk, file, rowIdx } = sel;
```

Note: the existing code below this point (lines 448-450) reads `hunk.rows[rowIdx]`. Because the file-level branch returns early, `hunk` is guaranteed non-null past this line. If TypeScript still narrows it as nullable, change line 448 to `const { file, rowIdx } = sel; const hunk = sel.hunk!;` (safe: the `sel.hunk === null` case returned above).

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/tests/trace/ProvenanceView.test.tsx`
Expected: PASS (all prior tests plus the 2 new panel tests).

- [ ] **Step 8: Full suite + type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS; no type errors.

- [ ] **Step 9: Commit**

```bash
git add webapp/frontend/src/components/trace/ProvenanceView.tsx webapp/frontend/src/tests/trace/ProvenanceView.test.tsx
git commit -m "Add per-line and file-level provenance panel for net diff"
```

---

## Self-Review

**Spec coverage** (against `2026-06-19-transcript-net-diff-design.md`):
- Data source `originalFile`/`content` → Task 1. ✓
- Pure `buildNetFile` with baseline/final resolution and `hasNetData` fallback → Task 2. ✓
- Per-line "last writer" attribution, file-level for ctx/del/unmapped → Task 2 (`attribute`) + Task 5 (panel). ✓
- Wire onto `BlameFile` → Task 3. ✓
- Net diff is the default view, per-op fallback preserved → Task 4. ✓
- File-level panel mode → Task 5. ✓
- Net counts in header/index → Task 4. ✓
- Edge cases: new file, deleted (`deleted` flag), revert ("no net change"), MultiEdit, missing fields, large-file fold → covered in Task 2 tests + Task 4 fold logic. ✓
- "Out-of-band changes invisible" is an accepted limitation, no task needed. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code and exact commands.

**Type consistency:** `EditOp.originalFile`/`finalContent` (T1) used identically in T2/T3. `NetRow`/`NetFileData`/`buildNetFile(path, okOps, deleted?)` defined in T2, imported in T3, `NetRow` in T4. `BlameFile` net fields defined in T3, read in T4/T5. `Sel.hunk` non-null in T4, made nullable in T5 with the dependent `FileBlock`/`Panel` lines updated in the same task. `onPick` signature widens from `(string)` in T4 to `(string | null)` in T5, with both call sites updated in T5. Consistent.
