# Trace Diff View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `Edit`/`MultiEdit`/`Write` tool calls in the trace viewer as a syntax-highlighted unified diff instead of a plain content dump.

**Architecture:** Claude Code already records a `structuredPatch` (diff hunks with line numbers) in `toolUseResult` for these tools. A pure `diff.ts` module turns that — or, for older traces without it, a fallback LCS line-diff — into a flat `DiffRow[]`. A `DiffView` component renders the rows GitHub-style. A `highlight.ts` module wraps Prism for per-line syntax coloring. `FileBody`'s write branch is rewired to use them.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, `prismjs` (new dependency).

**Branch:** `improve-trace-code-rendering` (already checked out).

---

## File Structure

- Create: `webapp/frontend/src/components/trace/diff.ts` — pure diff-row builders (types, `structuredPatch` flattener, new-file rows, fallback LCS diff, input→rows orchestration).
- Create: `webapp/frontend/src/components/trace/highlight.ts` — Prism wrapper: extension→language map, per-line highlight.
- Create: `webapp/frontend/src/components/trace/tool/DiffView.tsx` — renders `DiffRow[]`.
- Create: `webapp/frontend/src/tests/trace/diff.test.ts` — unit tests for `diff.ts`.
- Create: `webapp/frontend/src/tests/trace/highlight.test.ts` — unit tests for `highlight.ts`.
- Create: `webapp/frontend/src/tests/trace/DiffView.test.tsx` — render test for `DiffView`.
- Modify: `webapp/frontend/src/components/trace/tool/FileBody.tsx` — write branch builds rows + renders `DiffView`.
- Modify: `webapp/frontend/src/components/trace/tool/ToolCard.tsx:50` — pass `result` to `FileBody` write mode.
- Modify: `webapp/frontend/src/styles/tokens.css` — diff + syntax color tokens (light + dark).
- Modify: `webapp/frontend/src/styles/viewer.css` — diff layout + Prism token styling.
- Modify: `webapp/frontend/package.json` — add `prismjs` + `@types/prismjs`.

All commands below run from `webapp/frontend/`.

---

## Task 1: Add Prism and the highlight module

**Files:**
- Modify: `webapp/frontend/package.json`
- Create: `webapp/frontend/src/components/trace/highlight.ts`
- Test: `webapp/frontend/src/tests/trace/highlight.test.ts`

- [ ] **Step 1: Install Prism**

Run:
```bash
npm install prismjs@^1.30.0 && npm install -D @types/prismjs@^1.26.5
```
Expected: both packages added; `package.json` / `package-lock.json` updated, no errors.

- [ ] **Step 2: Write the failing test**

Create `src/tests/trace/highlight.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { langFromPath, highlightLine } from "../../components/trace/highlight";

describe("langFromPath", () => {
  it("maps known extensions", () => {
    expect(langFromPath("webapp/src/App.tsx")).toBe("tsx");
    expect(langFromPath("a/b/util.ts")).toBe("typescript");
    expect(langFromPath("script.py")).toBe("python");
    expect(langFromPath("deploy.sh")).toBe("bash");
    expect(langFromPath("data.json")).toBe("json");
  });
  it("returns null for unknown or missing extensions", () => {
    expect(langFromPath("Makefile")).toBeNull();
    expect(langFromPath("notes.xyz")).toBeNull();
    expect(langFromPath(null)).toBeNull();
    expect(langFromPath("")).toBeNull();
  });
});

describe("highlightLine", () => {
  it("escapes HTML when there is no language", () => {
    expect(highlightLine("<script>x</script>", null)).toBe(
      "&lt;script&gt;x&lt;/script&gt;",
    );
  });
  it("emits Prism token markup for a known language", () => {
    const html = highlightLine("const x = 1;", "javascript");
    expect(html).toContain("token");
    expect(html).toContain("keyword");
  });
  it("escapes HTML for a known language too", () => {
    const html = highlightLine("const a = '<b>';", "javascript");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/tests/trace/highlight.test.ts`
Expected: FAIL — cannot resolve `../../components/trace/highlight`.

- [ ] **Step 4: Implement `highlight.ts`**

Create `src/components/trace/highlight.ts`:
```ts
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-python";
import "prismjs/components/prism-json";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-sql";

// File extension → Prism language id. `prismjs` core already ships markup,
// css, clike and javascript; the imports above add the rest.
const EXT_LANG: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  py: "python",
  css: "css",
  scss: "css",
  html: "markup",
  xml: "markup",
  svg: "markup",
  json: "json",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  markdown: "markdown",
  go: "go",
  rs: "rust",
  sql: "sql",
};

export function langFromPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT_LANG[ext] ?? null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Highlight a single line of code. Prism escapes the input itself, so the
// returned HTML is safe for dangerouslySetInnerHTML. Falls back to plain
// escaped text for unknown languages or grammar errors.
export function highlightLine(code: string, lang: string | null): string {
  if (lang) {
    const grammar = Prism.languages[lang];
    if (grammar) {
      try {
        return Prism.highlight(code, grammar, lang);
      } catch {
        // fall through
      }
    }
  }
  return escapeHtml(code);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/tests/trace/highlight.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/components/trace/highlight.ts src/tests/trace/highlight.test.ts
git commit -m "Add Prism-backed syntax highlighting helper"
```

---

## Task 2: The diff module

**Files:**
- Create: `webapp/frontend/src/components/trace/diff.ts`
- Test: `webapp/frontend/src/tests/trace/diff.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tests/trace/diff.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  rowsFromStructuredPatch,
  rowsFromNewFile,
  fallbackDiff,
  extractPatch,
  buildWriteRows,
} from "../../components/trace/diff";

describe("rowsFromStructuredPatch", () => {
  it("flattens a hunk into numbered rows with a header", () => {
    const rows = rowsFromStructuredPatch([
      {
        oldStart: 28,
        oldLines: 2,
        newStart: 28,
        newLines: 3,
        lines: [" }", "+added", " after"],
      },
    ]);
    expect(rows).toEqual([
      { kind: "hunk", oldNo: null, newNo: null, text: "@@ -28,2 +28,3 @@" },
      { kind: "ctx", oldNo: 28, newNo: 28, text: "}" },
      { kind: "add", oldNo: null, newNo: 29, text: "added" },
      { kind: "ctx", oldNo: 29, newNo: 30, text: "after" },
    ]);
  });
  it("numbers deletions against the old file only", () => {
    const rows = rowsFromStructuredPatch([
      { oldStart: 5, oldLines: 2, newStart: 5, newLines: 1, lines: [" a", "-b"] },
    ]);
    expect(rows[1]).toEqual({ kind: "ctx", oldNo: 5, newNo: 5, text: "a" });
    expect(rows[2]).toEqual({ kind: "del", oldNo: 6, newNo: null, text: "b" });
  });
});

describe("rowsFromNewFile", () => {
  it("renders every line as an addition", () => {
    expect(rowsFromNewFile("a\nb")).toEqual([
      { kind: "add", oldNo: null, newNo: 1, text: "a" },
      { kind: "add", oldNo: null, newNo: 2, text: "b" },
    ]);
  });
  it("returns no rows for empty content", () => {
    expect(rowsFromNewFile("")).toEqual([]);
  });
});

describe("fallbackDiff", () => {
  it("produces ctx/del/add rows via an LCS line diff", () => {
    expect(fallbackDiff("a\nb\nc", "a\nx\nc")).toEqual([
      { kind: "ctx", oldNo: 1, newNo: 1, text: "a" },
      { kind: "del", oldNo: 2, newNo: null, text: "b" },
      { kind: "add", oldNo: null, newNo: 2, text: "x" },
      { kind: "ctx", oldNo: 3, newNo: 3, text: "c" },
    ]);
  });
  it("treats an empty old string as all additions", () => {
    expect(fallbackDiff("", "x")).toEqual([
      { kind: "add", oldNo: null, newNo: 1, text: "x" },
    ]);
  });
});

describe("extractPatch", () => {
  it("returns null for non-patch values", () => {
    expect(extractPatch(undefined)).toBeNull();
    expect(extractPatch("nope")).toBeNull();
    expect(extractPatch([])).toBeNull();
    expect(extractPatch([{ foo: 1 }])).toBeNull();
  });
  it("normalizes a valid patch array", () => {
    expect(
      extractPatch([
        { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [" a"] },
      ]),
    ).toEqual([
      { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [" a"] },
    ]);
  });
});

describe("buildWriteRows", () => {
  it("prefers a structured patch", () => {
    const rows = buildWriteRows({ content: "ignored" }, [
      { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["+x"] },
    ]);
    expect(rows).toEqual([
      { kind: "hunk", oldNo: null, newNo: null, text: "@@ -1,1 +1,1 @@" },
      { kind: "add", oldNo: null, newNo: 1, text: "x" },
    ]);
  });
  it("falls back to new-file rows from Write content", () => {
    expect(buildWriteRows({ content: "a\nb" }, null)).toEqual([
      { kind: "add", oldNo: null, newNo: 1, text: "a" },
      { kind: "add", oldNo: null, newNo: 2, text: "b" },
    ]);
  });
  it("falls back to an Edit's old/new strings", () => {
    expect(
      buildWriteRows({ old_string: "a", new_string: "b" }, null),
    ).toEqual([
      { kind: "del", oldNo: 1, newNo: null, text: "a" },
      { kind: "add", oldNo: null, newNo: 1, text: "b" },
    ]);
  });
  it("concatenates a MultiEdit's edits", () => {
    expect(
      buildWriteRows(
        { edits: [{ old_string: "a", new_string: "b" }, { old_string: "c", new_string: "d" }] },
        null,
      ),
    ).toEqual([
      { kind: "del", oldNo: 1, newNo: null, text: "a" },
      { kind: "add", oldNo: null, newNo: 1, text: "b" },
      { kind: "del", oldNo: 1, newNo: null, text: "c" },
      { kind: "add", oldNo: null, newNo: 1, text: "d" },
    ]);
  });
  it("returns no rows when there is nothing to show", () => {
    expect(buildWriteRows({}, null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/trace/diff.test.ts`
Expected: FAIL — cannot resolve `../../components/trace/diff`.

- [ ] **Step 3: Implement `diff.ts`**

Create `src/components/trace/diff.ts`:
```ts
export type DiffRowKind = "add" | "del" | "ctx" | "hunk";

export interface DiffRow {
  kind: DiffRowKind;
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

// Flatten Claude Code's structuredPatch hunks into numbered rows. Each hunk
// line is prefixed with " " (context), "+" (added) or "-" (removed).
export function rowsFromStructuredPatch(patch: PatchHunk[]): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const h of patch) {
    rows.push({
      kind: "hunk",
      oldNo: null,
      newNo: null,
      text: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
    });
    let oldNo = h.oldStart;
    let newNo = h.newStart;
    for (const line of h.lines) {
      const marker = line[0];
      if (marker === "+") {
        rows.push({ kind: "add", oldNo: null, newNo, text: line.slice(1) });
        newNo++;
      } else if (marker === "-") {
        rows.push({ kind: "del", oldNo, newNo: null, text: line.slice(1) });
        oldNo++;
      } else {
        rows.push({
          kind: "ctx",
          oldNo,
          newNo,
          text: marker === " " ? line.slice(1) : line,
        });
        oldNo++;
        newNo++;
      }
    }
  }
  return rows;
}

// Render brand-new file content as an all-additions diff.
export function rowsFromNewFile(content: string): DiffRow[] {
  if (content === "") return [];
  return content.split("\n").map((text, i) => ({
    kind: "add" as const,
    oldNo: null,
    newNo: i + 1,
    text,
  }));
}

// LCS line diff for traces with no structuredPatch (older Claude Code logs).
export function fallbackDiff(oldStr: string, newStr: string): DiffRow[] {
  const a = oldStr === "" ? [] : oldStr.split("\n");
  const b = newStr === "" ? [] : newStr.split("\n");
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ kind: "ctx", oldNo: i + 1, newNo: j + 1, text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: "del", oldNo: i + 1, newNo: null, text: a[i] });
      i++;
    } else {
      rows.push({ kind: "add", oldNo: null, newNo: j + 1, text: b[j] });
      j++;
    }
  }
  while (i < n) {
    rows.push({ kind: "del", oldNo: i + 1, newNo: null, text: a[i] });
    i++;
  }
  while (j < m) {
    rows.push({ kind: "add", oldNo: null, newNo: j + 1, text: b[j] });
    j++;
  }
  return rows;
}

// Narrow an untyped toolUseResult.structuredPatch into PatchHunk[], or null.
export function extractPatch(patch: unknown): PatchHunk[] | null {
  if (!Array.isArray(patch)) return null;
  const out: PatchHunk[] = [];
  for (const h of patch) {
    if (h && typeof h === "object") {
      const o = h as Record<string, unknown>;
      if (
        typeof o.oldStart === "number" &&
        typeof o.newStart === "number" &&
        Array.isArray(o.lines)
      ) {
        out.push({
          oldStart: o.oldStart,
          oldLines: typeof o.oldLines === "number" ? o.oldLines : 0,
          newStart: o.newStart,
          newLines: typeof o.newLines === "number" ? o.newLines : 0,
          lines: (o.lines as unknown[]).map((l) => String(l)),
        });
      }
    }
  }
  return out.length > 0 ? out : null;
}

// Build diff rows for a Write/Edit/MultiEdit tool call. Prefers the
// structuredPatch; falls back to Write content or Edit old/new strings.
export function buildWriteRows(
  input: Record<string, unknown>,
  patch: PatchHunk[] | null,
): DiffRow[] {
  if (patch && patch.length > 0) return rowsFromStructuredPatch(patch);
  if (typeof input.content === "string") return rowsFromNewFile(input.content);
  if (
    typeof input.old_string === "string" &&
    typeof input.new_string === "string"
  ) {
    return fallbackDiff(input.old_string, input.new_string);
  }
  if (Array.isArray(input.edits)) {
    const rows: DiffRow[] = [];
    for (const e of input.edits) {
      if (e && typeof e === "object") {
        const o = e as Record<string, unknown>;
        if (
          typeof o.old_string === "string" &&
          typeof o.new_string === "string"
        ) {
          rows.push(...fallbackDiff(o.old_string, o.new_string));
        }
      }
    }
    return rows;
  }
  return [];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/trace/diff.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/trace/diff.ts src/tests/trace/diff.test.ts
git commit -m "Add diff-row builders for Edit/Write/MultiEdit"
```

---

## Task 3: The DiffView component

**Files:**
- Create: `webapp/frontend/src/components/trace/tool/DiffView.tsx`
- Test: `webapp/frontend/src/tests/trace/DiffView.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/tests/trace/DiffView.test.tsx`:
```tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { DiffView } from "../../components/trace/tool/DiffView";
import type { DiffRow } from "../../components/trace/diff";

const rows: DiffRow[] = [
  { kind: "hunk", oldNo: null, newNo: null, text: "@@ -1,1 +1,2 @@" },
  { kind: "ctx", oldNo: 1, newNo: 1, text: "const a = 1;" },
  { kind: "add", oldNo: null, newNo: 2, text: "const b = 2;" },
];

describe("DiffView", () => {
  it("renders one row per DiffRow with the code text", () => {
    const { container, getByText } = render(
      <DiffView rows={rows} lang="javascript" />,
    );
    expect(container.querySelectorAll(".diff-row")).toHaveLength(3);
    expect(getByText("@@ -1,1 +1,2 @@")).toBeInTheDocument();
    expect(container.querySelector(".diff-add")).not.toBeNull();
    expect(container.textContent).toContain("const b = 2;");
  });
  it("shows old and new line numbers in the gutters", () => {
    const { container } = render(<DiffView rows={rows} lang={null} />);
    const ctx = container.querySelector(".diff-ctx")!;
    const gutters = ctx.querySelectorAll(".diff-gutter");
    expect(gutters[0].textContent).toBe("1");
    expect(gutters[1].textContent).toBe("1");
  });
  it("renders nothing for an empty row list", () => {
    const { container } = render(<DiffView rows={[]} lang={null} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/trace/DiffView.test.tsx`
Expected: FAIL — cannot resolve `DiffView`.

- [ ] **Step 3: Implement `DiffView.tsx`**

Create `src/components/trace/tool/DiffView.tsx`:
```tsx
import type { DiffRow } from "../diff";
import { highlightLine } from "../highlight";

interface Props {
  rows: DiffRow[];
  lang: string | null;
}

// Cap very large diffs (e.g. a freshly written 2000-line file) so the DOM
// stays light. The viewer is a summary, not a full file browser.
const MAX_ROWS = 800;

const MARK: Record<DiffRow["kind"], string> = {
  add: "+",
  del: "-",
  ctx: "",
  hunk: "",
};

export function DiffView({ rows, lang }: Props) {
  if (rows.length === 0) return null;
  const shown = rows.slice(0, MAX_ROWS);
  const hidden = rows.length - shown.length;
  return (
    <div className="diff-view">
      {shown.map((r, i) => (
        <div key={i} className={`diff-row diff-${r.kind}`}>
          <span className="diff-gutter">{r.oldNo ?? ""}</span>
          <span className="diff-gutter">{r.newNo ?? ""}</span>
          <span className="diff-mark">{MARK[r.kind]}</span>
          {r.kind === "hunk" ? (
            <span className="diff-code">{r.text}</span>
          ) : (
            <span
              className="diff-code"
              dangerouslySetInnerHTML={{
                __html: highlightLine(r.text, lang),
              }}
            />
          )}
        </div>
      ))}
      {hidden > 0 && (
        <div className="diff-row diff-truncated">
          <span className="diff-gutter" />
          <span className="diff-gutter" />
          <span className="diff-mark" />
          <span className="diff-code">… {hidden} more lines</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/trace/DiffView.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/trace/tool/DiffView.tsx src/tests/trace/DiffView.test.tsx
git commit -m "Add DiffView component for rendering diff rows"
```

---

## Task 4: Wire the diff view into FileBody

**Files:**
- Modify: `webapp/frontend/src/components/trace/tool/FileBody.tsx`
- Modify: `webapp/frontend/src/components/trace/tool/ToolCard.tsx`

- [ ] **Step 1: Pass `result` into FileBody write mode**

In `src/components/trace/tool/ToolCard.tsx`, the `Write`/`Edit`/`MultiEdit` case currently reads:
```tsx
    case "Write":
    case "Edit":
    case "MultiEdit":
      return <FileBody mode="write" input={event.input} root={root} />;
```
Replace it with:
```tsx
    case "Write":
    case "Edit":
    case "MultiEdit":
      return (
        <FileBody
          mode="write"
          input={event.input}
          result={event.result}
          root={root}
        />
      );
```

- [ ] **Step 2: Rewrite the FileBody write branch**

In `src/components/trace/tool/FileBody.tsx`:

(a) Replace the import block at the top:
```tsx
import type { ToolResult } from "../types";
import { clip, shortenPath } from "../format";
import { IconFile } from "../icons";
```
with:
```tsx
import type { ToolResult } from "../types";
import { clip, shortenPath } from "../format";
import { IconFile } from "../icons";
import { DiffView } from "./DiffView";
import { buildWriteRows, extractPatch } from "../diff";
import { langFromPath } from "../highlight";
```

(b) Replace the `WriteProps` interface:
```tsx
interface WriteProps {
  mode: "write";
  input: Record<string, unknown>;
  root: string | null;
}
```
with:
```tsx
interface WriteProps {
  mode: "write";
  input: Record<string, unknown>;
  result: ToolResult | null;
  root: string | null;
}
```

(c) Replace the entire write branch — everything from `const path = asString(props.input.file_path)` (the second occurrence, after the `read` block's closing `}`) through the final `);` and closing `}` of the function — with:
```tsx
  const path = asString(props.input.file_path) || asString(props.input.path);
  const patch = extractPatch(props.result?.toolUseResult?.structuredPatch);
  const rows = buildWriteRows(props.input, patch);
  const lang = langFromPath(path);
  const added = rows.filter((r) => r.kind === "add").length;
  const removed = rows.filter((r) => r.kind === "del").length;
  return (
    <>
      <div className="file-card">
        <IconFile />
        <span className="file-path">{shortenPath(path, root)}</span>
        {(added > 0 || removed > 0) && (
          <span className="file-stats">
            {added > 0 && <span className="diff-stat-add">+{added}</span>}
            {removed > 0 && <span className="diff-stat-del">−{removed}</span>}
          </span>
        )}
      </div>
      {rows.length > 0 ? (
        <>
          <h4>Changes</h4>
          <DiffView rows={rows} lang={lang} />
        </>
      ) : null}
    </>
  );
}
```

Note: the `read` branch is unchanged. After this edit, `clip` is still used by the read branch, so the import stays.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean). If `clip` is reported unused, confirm the read branch still calls `clip(out, 8000)` — it should.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all suites green, including the existing `TraceView` test that renders tool cards.

- [ ] **Step 5: Commit**

```bash
git add src/components/trace/tool/FileBody.tsx src/components/trace/tool/ToolCard.tsx
git commit -m "Render Edit/Write/MultiEdit tool calls as a diff"
```

---

## Task 5: Styling — diff layout and syntax theme

**Files:**
- Modify: `webapp/frontend/src/styles/tokens.css`
- Modify: `webapp/frontend/src/styles/viewer.css`

- [ ] **Step 1: Add color tokens**

In `src/styles/tokens.css`, inside the `:root { … }` block, immediately before the line `  --radius: 10px;`, insert:
```css
  /* Diff + syntax highlighting (light) */
  --diff-add-bg: oklch(0.94 0.05 150);
  --diff-add-num: oklch(0.50 0.10 150);
  --diff-del-bg: oklch(0.93 0.05 25);
  --diff-del-num: oklch(0.52 0.13 25);
  --diff-hunk-fg: oklch(0.55 0.05 250);
  --syn-comment: oklch(0.58 0.02 75);
  --syn-keyword: oklch(0.52 0.14 300);
  --syn-string: oklch(0.48 0.11 150);
  --syn-number: oklch(0.52 0.13 50);
  --syn-function: oklch(0.50 0.13 250);
  --syn-punct: oklch(0.50 0.012 75);

```

In the same file, inside the `[data-theme="dark"] { … }` block, immediately before the line `  --shadow-1: 0 1px 0 0 oklch(0.30 0.006 70 / 0.6);`, insert:
```css
  /* Diff + syntax highlighting (dark) */
  --diff-add-bg: oklch(0.30 0.06 150);
  --diff-add-num: oklch(0.78 0.10 150);
  --diff-del-bg: oklch(0.30 0.07 25);
  --diff-del-num: oklch(0.78 0.12 25);
  --diff-hunk-fg: oklch(0.70 0.05 250);
  --syn-comment: oklch(0.60 0.02 75);
  --syn-keyword: oklch(0.78 0.13 300);
  --syn-string: oklch(0.78 0.12 150);
  --syn-number: oklch(0.80 0.12 60);
  --syn-function: oklch(0.78 0.12 250);
  --syn-punct: oklch(0.70 0.012 75);

```

- [ ] **Step 2: Add the diff stylesheet**

Append to the end of `src/styles/viewer.css`:
```css

/* Diff view (Edit / Write / MultiEdit tool bodies) */
.vibeshub-viewer .diff-view {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-inset);
  overflow-x: auto;
  max-height: 480px;
  overflow-y: auto;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.55;
}
.vibeshub-viewer .diff-row {
  display: flex;
  align-items: flex-start;
  min-width: 100%;
  width: max-content;
  min-height: 1.55em;
}
.vibeshub-viewer .diff-gutter {
  flex: 0 0 auto;
  width: 44px;
  padding: 0 8px;
  text-align: right;
  color: var(--text-faint);
  user-select: none;
  white-space: pre;
}
.vibeshub-viewer .diff-mark {
  flex: 0 0 auto;
  width: 16px;
  text-align: center;
  user-select: none;
  color: var(--text-faint);
}
.vibeshub-viewer .diff-code {
  flex: 1 1 auto;
  padding-right: 12px;
  white-space: pre;
  color: var(--text);
}
.vibeshub-viewer .diff-add {
  background: var(--diff-add-bg);
}
.vibeshub-viewer .diff-add .diff-gutter,
.vibeshub-viewer .diff-add .diff-mark {
  color: var(--diff-add-num);
}
.vibeshub-viewer .diff-del {
  background: var(--diff-del-bg);
}
.vibeshub-viewer .diff-del .diff-gutter,
.vibeshub-viewer .diff-del .diff-mark {
  color: var(--diff-del-num);
}
.vibeshub-viewer .diff-hunk {
  background: var(--bg-subtle);
}
.vibeshub-viewer .diff-hunk .diff-code,
.vibeshub-viewer .diff-truncated .diff-code {
  color: var(--diff-hunk-fg);
}
.vibeshub-viewer .diff-truncated {
  background: var(--bg-subtle);
}
.vibeshub-viewer .diff-stat-add {
  color: var(--diff-add-num);
  font-weight: 600;
}
.vibeshub-viewer .diff-stat-del {
  color: var(--diff-del-num);
  font-weight: 600;
  margin-left: 6px;
}

/* Prism token theme, scoped to diff code */
.vibeshub-viewer .diff-code .token.comment,
.vibeshub-viewer .diff-code .token.prolog,
.vibeshub-viewer .diff-code .token.doctype,
.vibeshub-viewer .diff-code .token.cdata {
  color: var(--syn-comment);
  font-style: italic;
}
.vibeshub-viewer .diff-code .token.keyword,
.vibeshub-viewer .diff-code .token.boolean,
.vibeshub-viewer .diff-code .token.atrule,
.vibeshub-viewer .diff-code .token.important {
  color: var(--syn-keyword);
}
.vibeshub-viewer .diff-code .token.string,
.vibeshub-viewer .diff-code .token.char,
.vibeshub-viewer .diff-code .token.attr-value,
.vibeshub-viewer .diff-code .token.regex {
  color: var(--syn-string);
}
.vibeshub-viewer .diff-code .token.number,
.vibeshub-viewer .diff-code .token.constant,
.vibeshub-viewer .diff-code .token.symbol {
  color: var(--syn-number);
}
.vibeshub-viewer .diff-code .token.function,
.vibeshub-viewer .diff-code .token.class-name,
.vibeshub-viewer .diff-code .token.tag,
.vibeshub-viewer .diff-code .token.selector {
  color: var(--syn-function);
}
.vibeshub-viewer .diff-code .token.punctuation,
.vibeshub-viewer .diff-code .token.operator,
.vibeshub-viewer .diff-code .token.attr-name {
  color: var(--syn-punct);
}
```

- [ ] **Step 3: Verify the build compiles the CSS**

Run: `npm run build`
Expected: `tsc -b` clean and `vite build` succeeds with no CSS warnings.

- [ ] **Step 4: Commit**

```bash
git add src/styles/tokens.css src/styles/viewer.css
git commit -m "Style the diff view and syntax tokens"
```

---

## Task 6: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: every suite passes, including `diff.test.ts`, `highlight.test.ts`, `DiffView.test.tsx`.

- [ ] **Step 2: Typecheck and build**

Run: `npm run build`
Expected: clean `tsc -b`, successful `vite build`.

- [ ] **Step 3: Visual smoke test against a real trace**

Run: `npm run dev`, open the viewer, and load a trace that contains `Edit` and `Write` calls (e.g. import `/Users/bhavya/Downloads/raw (1).ndjson`, which has 10 Edits). Expand an `Edit` tool card and confirm:
- a red/green unified diff renders with old + new line-number gutters;
- syntax colors appear on the code;
- a `Write` of a new file shows an all-green diff;
- the `+N −N` stat appears in the file-card header.

- [ ] **Step 4: Commit any final touch-ups**

If the smoke test surfaced a fix, commit it. Otherwise nothing to do.

---

## Self-Review Notes

- **Spec coverage:** structuredPatch-driven diff (Tasks 2, 4) ✓; Prism syntax highlighting (Tasks 1, 5) ✓; new-file all-green diff (Task 2 `rowsFromNewFile`, used by `buildWriteRows`) ✓; MultiEdit support — previously rendered nothing — now covered via `buildWriteRows` (Task 2) and `structuredPatch` ✓; fallback for older traces (Task 2 `fallbackDiff`) ✓; Read view untouched ✓.
- **Type consistency:** `DiffRow`, `PatchHunk`, `DiffRowKind` defined once in `diff.ts` and imported everywhere; `rowsFromStructuredPatch`, `rowsFromNewFile`, `fallbackDiff`, `extractPatch`, `buildWriteRows`, `langFromPath`, `highlightLine` names used identically across tasks and tests.
- **No placeholders:** every code step contains complete code; commands list expected output.
