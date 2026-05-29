# Terminal text-export (`.txt`) support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users upload Claude Code's rendered `.txt` terminal export and still get a viewable trace, by converting it to a synthetic `.jsonl` on the frontend that rides the existing parser/viewer/redaction/storage pipeline, while archiving the redacted raw `.txt` for future re-conversion.

**Architecture:** A new frontend module `terminalExport.ts` converts the `.txt` into the exact record shapes `buildSession` already consumes. At upload, `UploadPage` detects a `.txt`, converts it to a synthetic `.jsonl` `File` (sent as `transcript`, unchanged downstream), and attaches the raw `.txt` as a new `source_export` form field. The backend redacts both with the existing byte-level patterns, stores the raw `.txt` as `{prefix}source_export.txt`, and records `trace.source_format = "terminal"`. The viewer shows an "Imported from text export" chip. `.jsonl` uploads are completely unaffected.

**Tech Stack:** TypeScript / React / Vite / Vitest (frontend); Python / FastAPI / SQLAlchemy / Alembic / pytest (backend).

**Spec:** `docs/superpowers/specs/2026-05-28-terminal-export-support-design.md`

---

## File structure

**Frontend**
- Create: `webapp/frontend/src/components/trace/terminalExport.ts` — the converter + `looksLikeTerminalExport` + `terminalExportToJsonl`. One responsibility: `.txt` → synthetic records.
- Create: `webapp/frontend/src/tests/trace/terminalExport.test.ts` — converter unit + integration tests.
- Modify: `webapp/frontend/src/components/trace/types.ts` — add `sourceFormat`, `modelLabel` to `SessionMeta`.
- Modify: `webapp/frontend/src/components/trace/parser.ts` — read the `terminal-meta` marker; init the two new meta fields.
- Modify: `webapp/frontend/src/api.ts` — add optional `sourceExport` to `UploadTraceArgs` + form field.
- Modify: `webapp/frontend/src/routes/UploadPage.tsx` — accept `.txt`, convert on submit, attach raw, empty-recovery guidance.
- Modify: `webapp/frontend/src/components/trace/Hero.tsx` — export `MetaLine`; show `modelLabel`; render the import chip.
- Modify: `webapp/frontend/src/styles/viewer.css` — `.meta-import-chip` style.
- Relocate: the sample `.txt` → `webapp/frontend/src/tests/fixtures/sample-terminal-export.txt`.

**Backend**
- Modify: `webapp/backend/app/storage/models.py` — add `source_format` column to `Trace`.
- Create: `webapp/backend/alembic/versions/<rev>_add_source_format_to_traces.py` — migration.
- Modify: `webapp/backend/app/api/trace_service.py` — `create_or_update_trace` stores the raw export blob + sets `source_format`.
- Modify: `webapp/backend/app/api/uploads.py` — accept `source_export`, redact, thread through.
- Modify: `webapp/backend/tests/test_uploads.py` — endpoint tests for the new path.

---

## Task 1: Converter helpers + `looksLikeTerminalExport`

**Files:**
- Create: `webapp/frontend/src/components/trace/terminalExport.ts`
- Test: `webapp/frontend/src/tests/trace/terminalExport.test.ts`

- [ ] **Step 1: Write the failing test**

Create `webapp/frontend/src/tests/trace/terminalExport.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  looksLikeTerminalExport,
  rejoin,
} from "../../components/trace/terminalExport";

describe("looksLikeTerminalExport", () => {
  it("is true for a rendered export banner", () => {
    const txt = " ▐▛███▜▌   Claude Code v2.1.156\n  ~/git/vibeshub\n\n❯ hi\n";
    expect(looksLikeTerminalExport(txt)).toBe(true);
  });

  it("is true for ❯/⏺ glyph lines without a version", () => {
    expect(looksLikeTerminalExport("❯ do a thing\n⏺ ok\n")).toBe(true);
  });

  it("is false for a real jsonl transcript", () => {
    expect(
      looksLikeTerminalExport('{"type":"user","message":{"content":"hi"}}\n'),
    ).toBe(false);
  });
});

describe("rejoin", () => {
  it("collapses wrapped lines into one space-joined run", () => {
    expect(rejoin(["fix the", "mobile layout"])).toBe("fix the mobile layout");
  });

  it("keeps a blank line as a paragraph break", () => {
    expect(rejoin(["intro line", "", "second para"])).toBe(
      "intro line\n\nsecond para",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/frontend && npx vitest run src/tests/trace/terminalExport.test.ts`
Expected: FAIL — `Failed to resolve import "../../components/trace/terminalExport"`.

- [ ] **Step 3: Write minimal implementation**

Create `webapp/frontend/src/components/trace/terminalExport.ts`:

```ts
// Convert Claude Code's rendered terminal *export* (.txt) into the same
// record shapes the JSONL parser (`buildSession`) consumes. The .txt is a
// lossy presentation-layer rendering: no timestamps, tokens, model id,
// thinking, real ids, or untruncated tool I/O. This is a best-effort
// convenience path; .jsonl remains the full-fidelity input.

type AnyRec = Record<string, unknown>;

// Glyphs the renderer puts at the start of a logical line.
const GLYPHS = ["❯", "⏺", "⎿", "✻", "※"] as const;
const VERSION_RE = /Claude Code v([0-9][\w.\-]*)/;

interface ScannedLine {
  glyph: string | null;
  body: string;
  indent: number;
}

// Classify a raw line by its leading glyph (after any indentation).
export function scan(line: string): ScannedLine {
  const indent = line.length - line.trimStart().length;
  const t = line.trimStart();
  for (const g of GLYPHS) {
    if (t === g || t.startsWith(g)) {
      return { glyph: g, body: t.slice(g.length).trimStart(), indent };
    }
  }
  return { glyph: null, body: t, indent };
}

// Heuristic: does this text look like a rendered terminal export (vs jsonl)?
export function looksLikeTerminalExport(text: string): boolean {
  const head = text.slice(0, 4000);
  if (VERSION_RE.test(head)) return true;
  return /(^|\n)\s*❯ /.test(text) && /(^|\n)\s*⏺ /.test(text);
}

// Collapse terminal hard-wraps: join wrapped lines with a single space,
// preserving blank lines as paragraph breaks. Lossy (a wrapped path may gain
// a space) and accepted for this path.
export function rejoin(lines: string[]): string {
  const paras: string[] = [];
  let buf = "";
  for (const raw of lines) {
    const s = raw.trim();
    if (!s) {
      if (buf) {
        paras.push(buf);
        buf = "";
      }
      continue;
    }
    buf = buf ? `${buf} ${s}` : s;
  }
  if (buf) paras.push(buf);
  return paras.join("\n\n").trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/frontend && npx vitest run src/tests/trace/terminalExport.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/bhavya/git/vibeshub
git add webapp/frontend/src/components/trace/terminalExport.ts webapp/frontend/src/tests/trace/terminalExport.test.ts
git commit -m "feat(trace): terminal-export helpers (scan, rejoin, detection)"
```

---

## Task 2: `parseTerminalExport` + `terminalExportToJsonl`

**Files:**
- Modify: `webapp/frontend/src/components/trace/terminalExport.ts`
- Test: `webapp/frontend/src/tests/trace/terminalExport.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `webapp/frontend/src/tests/trace/terminalExport.test.ts`:

```ts
import {
  parseTerminalExport,
  terminalExportToJsonl,
} from "../../components/trace/terminalExport";

const SAMPLE = ` ▐▛███▜▌   Claude Code v2.1.156
▝▜█████▛▘  Opus 4.8 · Claude Max
  ▘▘ ▝▝    ~/git/vibeshub

❯ /resume
  ⎿  Resume cancelled

❯ fix the mobile layout, the header
  is too crowded

⏺ I'll look at the screenshots and pull up
  the frontend-design skill.

⏺ Skill(frontend-design:frontend-design)
  ⎿  Successfully loaded skill

  Read 5 files (ctrl+o to expand)

⏺ Bash(git diff --stat && echo "=== DIFF ===")
  ⎿  === DIFF ===
     … +8 lines (ctrl+o to expand)

✻ Baked for 39m 50s
`;

describe("parseTerminalExport", () => {
  const records = parseTerminalExport(SAMPLE);

  it("emits a terminal-meta marker with banner fields", () => {
    const marker = records[0];
    expect(marker.type).toBe("terminal-meta");
    expect(marker.source).toBe("terminal");
    expect(marker.version).toBe("v2.1.156");
    expect(marker.modelLabel).toBe("Opus 4.8");
    expect(marker.cwd).toBe("~/git/vibeshub");
  });

  it("emits a user prompt with wrapped lines rejoined", () => {
    const prompt = records.find(
      (r) =>
        r.type === "user" &&
        typeof (r.message as AnyRecT).content === "string",
    );
    expect((prompt!.message as AnyRecT).content).toBe(
      "fix the mobile layout, the header is too crowded",
    );
  });

  it("emits assistant text blocks", () => {
    const asst = records.find(
      (r) =>
        r.type === "assistant" &&
        ((r.message as AnyRecT).content as AnyRecT[])[0].type === "text",
    );
    expect(
      (((asst!.message as AnyRecT).content as AnyRecT[])[0] as AnyRecT).text,
    ).toContain("frontend-design skill");
  });

  it("emits tool_use for Name(...) calls with a unique id and name", () => {
    const tools = records
      .filter((r) => r.type === "assistant")
      .map((r) => ((r.message as AnyRecT).content as AnyRecT[])[0])
      .filter((b) => (b as AnyRecT).type === "tool_use") as AnyRecT[];
    const names = tools.map((b) => b.name);
    expect(names).toContain("Skill");
    expect(names).toContain("Bash");
    expect(names).toContain("Read"); // glyph-less "Read 5 files" summary form
    const ids = tools.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
  });

  it("attaches ⎿ output to the preceding tool as a tool_result", () => {
    const results = records
      .filter((r) => r.type === "user" && Array.isArray((r.message as AnyRecT).content))
      .flatMap((r) => (r.message as AnyRecT).content as AnyRecT[])
      .filter((b) => b.type === "tool_result");
    const bash = results.find((b) =>
      String(b.content).includes("=== DIFF ==="),
    );
    expect(bash).toBeTruthy();
    expect(String(bash!.content)).toContain("+8 lines"); // truncation preserved
  });

  it("assigns unique synthetic message ids", () => {
    const ids = records
      .filter((r) => r.type === "assistant")
      .map((r) => (r.message as AnyRecT).id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("terminalExportToJsonl", () => {
  it("returns newline-delimited json and recovered=true for real content", () => {
    const { jsonl, recovered } = terminalExportToJsonl(SAMPLE);
    expect(recovered).toBe(true);
    const lines = jsonl.split("\n").filter(Boolean);
    expect(() => lines.forEach((l) => JSON.parse(l))).not.toThrow();
    expect(JSON.parse(lines[0]).type).toBe("terminal-meta");
  });

  it("returns recovered=false when only a banner is present", () => {
    const { recovered } = terminalExportToJsonl(
      " ▐▛███▜▌   Claude Code v2.1.156\n  ~/git/vibeshub\n",
    );
    expect(recovered).toBe(false);
  });
});

type AnyRecT = Record<string, unknown>;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/frontend && npx vitest run src/tests/trace/terminalExport.test.ts`
Expected: FAIL — `parseTerminalExport`/`terminalExportToJsonl` are not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `webapp/frontend/src/components/trace/terminalExport.ts`:

```ts
// A tool name followed by "(" — the explicit tool-call form, e.g. `Bash(...)`.
const TOOL_CALL_RE = /^([A-Z][A-Za-z0-9_]*)\(([\s\S]*)$/;
// A glyph-less batch summary, e.g. "Read 5 files (ctrl+o to expand)".
const TOOL_SUMMARY_RE =
  /^(Read|Listed|Searched|Wrote|Updated|Fetched)\b.*\b(file|files|pattern|patterns|director\w*|line|lines)\b/;

export function parseTerminalExport(text: string): AnyRec[] {
  const lines = text.split("\n");
  const records: AnyRec[] = [];

  // ---- banner: everything before the first ❯ prompt ----
  let firstPrompt = lines.findIndex((l) => scan(l).glyph === "❯");
  if (firstPrompt < 0) firstPrompt = lines.length;
  const banner = lines.slice(0, firstPrompt);
  const marker: AnyRec = { type: "terminal-meta", source: "terminal" };
  const vm = banner.join("\n").match(VERSION_RE);
  if (vm) marker.version = `v${vm[1]}`;
  for (const l of banner) {
    const s = l.trim();
    if (!s || VERSION_RE.test(s)) continue;
    if (!("modelLabel" in marker) && s.includes("·")) {
      // Strip leading ASCII-art glyphs before the label text.
      const label = s.split("·")[0].replace(/^[^A-Za-z0-9]+/, "").trim();
      if (label) marker.modelLabel = label;
    }
    if (!("cwd" in marker)) {
      const cm = s.match(/(~\/\S+|\/\S+)/);
      if (cm) marker.cwd = cm[1];
    }
  }
  records.push(marker);

  // ---- body ----
  let msgN = 0;
  let toolN = 0;
  let lastToolId: string | null = null;

  type Open =
    | { kind: "prompt"; lines: string[] }
    | { kind: "assistant"; lines: string[] }
    | { kind: "result"; toolId: string; lines: string[] }
    | null;
  let open: Open = null;

  const flush = () => {
    if (!open) return;
    if (open.kind === "prompt") {
      const content = rejoin(open.lines);
      if (content) records.push({ type: "user", message: { content } });
    } else if (open.kind === "assistant") {
      const t = rejoin(open.lines);
      if (t) {
        records.push({
          type: "assistant",
          message: {
            id: `term-msg-${msgN++}`,
            content: [{ type: "text", text: t }],
          },
        });
      }
    } else if (open.kind === "result") {
      const content = open.lines.map((l) => l.trim()).join("\n").trim();
      if (content) {
        records.push({
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: open.toolId, content },
            ],
          },
        });
      }
    }
    open = null;
  };

  const emitToolUse = (name: string, input: AnyRec) => {
    const id = `term-tool-${toolN++}`;
    lastToolId = id;
    records.push({
      type: "assistant",
      message: {
        id: `term-msg-${msgN++}`,
        content: [{ type: "tool_use", id, name, input }],
      },
    });
  };

  for (let i = firstPrompt; i < lines.length; i++) {
    const sc = scan(lines[i]);

    if (sc.glyph === "❯") {
      flush();
      open = { kind: "prompt", lines: [sc.body] };
      continue;
    }
    if (sc.glyph === "✻" || sc.glyph === "※") {
      flush(); // think-time / recap summaries carry no content — drop
      continue;
    }
    if (sc.glyph === "⏺") {
      flush();
      const m = sc.body.match(TOOL_CALL_RE);
      if (m) {
        // Tool input is only the first rendered line (rest is truncated by
        // the renderer anyway); store it raw.
        emitToolUse(m[1], { raw: m[2].replace(/\)\s*$/, "").trim() });
        open = null; // wrapped arg lines are dropped (accepted truncation)
      } else {
        open = { kind: "assistant", lines: [sc.body] };
      }
      continue;
    }
    if (sc.glyph === "⎿") {
      if (open && open.kind === "result") {
        open.lines.push(sc.body);
      } else {
        flush();
        open = lastToolId
          ? { kind: "result", toolId: lastToolId, lines: [sc.body] }
          : null; // orphan output (e.g. /resume → cancelled): drop
      }
      continue;
    }

    // glyph === null
    if (!sc.body) {
      if (open) open.lines.push(""); // paragraph break within open unit
      continue;
    }
    if (TOOL_SUMMARY_RE.test(sc.body) && (!open || open.kind !== "result")) {
      flush();
      emitToolUse(sc.body.split(/\s+/)[0], {});
      open = null;
      continue;
    }
    if (open) open.lines.push(sc.body); // wrapped continuation
  }
  flush();
  return records;
}

// Convenience wrapper for the uploader: serialize to JSONL text and report
// whether any user/assistant content (not just the banner) was recovered.
export function terminalExportToJsonl(text: string): {
  jsonl: string;
  recovered: boolean;
} {
  const records = parseTerminalExport(text);
  const recovered = records.some(
    (r) => r.type === "user" || r.type === "assistant",
  );
  const jsonl = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  return { jsonl, recovered };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/frontend && npx vitest run src/tests/trace/terminalExport.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
cd /Users/bhavya/git/vibeshub
git add webapp/frontend/src/components/trace/terminalExport.ts webapp/frontend/src/tests/trace/terminalExport.test.ts
git commit -m "feat(trace): parseTerminalExport converts .txt to synthetic records"
```

---

## Task 3: Surface provenance in `SessionMeta`

**Files:**
- Modify: `webapp/frontend/src/components/trace/types.ts:29-48`
- Modify: `webapp/frontend/src/components/trace/parser.ts:129-186`
- Test: `webapp/frontend/src/tests/trace/terminalExport.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `webapp/frontend/src/tests/trace/terminalExport.test.ts`:

```ts
import { buildSession, parseJsonl } from "../../components/trace/parser";

describe("buildSession reads terminal-meta", () => {
  it("sets sourceFormat and modelLabel from the marker", () => {
    const { jsonl } = terminalExportToJsonl(SAMPLE);
    const session = buildSession(parseJsonl(jsonl));
    expect(session.meta.sourceFormat).toBe("terminal");
    expect(session.meta.modelLabel).toBe("Opus 4.8");
    expect(session.meta.version).toBe("v2.1.156");
    expect(session.meta.cwd).toBe("~/git/vibeshub");
    expect(session.meta.model).toBeNull(); // real model id stays unknown
  });

  it("leaves sourceFormat null for an ordinary jsonl transcript", () => {
    const session = buildSession(
      parseJsonl('{"type":"user","message":{"content":"hi"}}\n'),
    );
    expect(session.meta.sourceFormat).toBeNull();
    expect(session.meta.modelLabel).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/frontend && npx vitest run src/tests/trace/terminalExport.test.ts`
Expected: FAIL — `sourceFormat`/`modelLabel` are not on `SessionMeta` (type error / undefined).

- [ ] **Step 3a: Add the fields to the type**

In `webapp/frontend/src/components/trace/types.ts`, inside `interface SessionMeta`, add after the `model: string | null;` line:

```ts
  model: string | null;
  // Banner model label (e.g. "Opus 4.8") when reconstructed from a terminal
  // export; never the canonical model id. null for jsonl traces.
  modelLabel: string | null;
  // "terminal" when reconstructed from a .txt export, else null.
  sourceFormat: "terminal" | null;
```

- [ ] **Step 3b: Initialize and populate them in the parser**

In `webapp/frontend/src/components/trace/parser.ts`, in the `meta` initializer (around line 130), add after `model: null,`:

```ts
    model: null,
    modelLabel: null,
    sourceFormat: null,
```

Then in Pass 1, immediately after the `if (r.type === "pr-link") { ... }` block (around line 173), add:

```ts
    if (r.type === "terminal-meta") {
      meta.sourceFormat = "terminal";
      const ml = getStr(r, "modelLabel");
      if (ml) meta.modelLabel = ml;
    }
```

(`version` and `cwd` are picked up automatically by the existing generic
`getStr(r, "version")` / `getStr(r, "cwd")` captures; `model` is deliberately
left untouched so it stays null.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/frontend && npx vitest run src/tests/trace/terminalExport.test.ts && npx tsc -b`
Expected: PASS; `tsc` exits 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/bhavya/git/vibeshub
git add webapp/frontend/src/components/trace/types.ts webapp/frontend/src/components/trace/parser.ts webapp/frontend/src/tests/trace/terminalExport.test.ts
git commit -m "feat(trace): read terminal-meta into SessionMeta (sourceFormat, modelLabel)"
```

---

## Task 4: Integration round-trip with the real sample fixture

**Files:**
- Relocate: `2026-05-28-175954-usersbhavyapicturesphotos-libraryphotoslibr.txt` → `webapp/frontend/src/tests/fixtures/sample-terminal-export.txt`
- Test: `webapp/frontend/src/tests/trace/terminalExport.test.ts`

- [ ] **Step 1: Relocate the sample as a fixture**

```bash
cd /Users/bhavya/git/vibeshub
git mv "2026-05-28-175954-usersbhavyapicturesphotos-libraryphotoslibr.txt" webapp/frontend/src/tests/fixtures/sample-terminal-export.txt
```

(If git refuses because the file is untracked, use a plain `mv` to the same destination.)

- [ ] **Step 2: Write the failing test**

Append to `webapp/frontend/src/tests/trace/terminalExport.test.ts` (the `fs`/`path` imports mirror `parser.test.ts`):

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL = readFileSync(
  join(__dirname, "../fixtures/sample-terminal-export.txt"),
  "utf-8",
);

describe("real export round-trips through buildSession", () => {
  const { jsonl, recovered } = terminalExportToJsonl(REAL);
  const session = buildSession(parseJsonl(jsonl));

  it("recovers content", () => {
    expect(recovered).toBe(true);
    expect(session.meta.userPromptCount).toBeGreaterThan(0);
    expect(session.meta.toolCallCount).toBeGreaterThan(0);
    expect(session.meta.assistantTextCount).toBeGreaterThan(0);
  });

  it("marks provenance and leaves unrecoverable metadata empty", () => {
    expect(session.meta.sourceFormat).toBe("terminal");
    expect(session.meta.modelLabel).toBe("Opus 4.8");
    const t = session.meta.tokens;
    expect(t.input + t.output + t.cacheRead + t.cacheCreate).toBe(0);
    expect(session.meta.assistantThinkMs).toBe(0); // no timestamps to derive from
  });

  it("counts the real tools (Skill, Bash, Update, Write)", () => {
    expect(Object.keys(session.meta.toolCounts)).toEqual(
      expect.arrayContaining(["Skill", "Bash", "Update", "Write"]),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails (then passes — no new code)**

Run: `cd webapp/frontend && npx vitest run src/tests/trace/terminalExport.test.ts`
Expected: PASS if the fixture is in place. If it FAILs on a tool name (e.g. `Update`/`Write` not found), that's a real converter gap — fix `TOOL_CALL_RE`/`TOOL_SUMMARY_RE` in `terminalExport.ts` until the assertions pass; do not weaken the assertions for the four explicit tool names.

- [ ] **Step 4: Commit**

```bash
cd /Users/bhavya/git/vibeshub
git add webapp/frontend/src/tests/fixtures/sample-terminal-export.txt webapp/frontend/src/tests/trace/terminalExport.test.ts
git commit -m "test(trace): round-trip the real terminal export through buildSession"
```

---

## Task 5: `uploadTrace` accepts a `sourceExport` file

**Files:**
- Modify: `webapp/frontend/src/api.ts:148-171`
- Test: `webapp/frontend/src/tests/api.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `webapp/frontend/src/tests/api.test.ts` (match the file's existing `vi.stubGlobal`/fetch-mock style; this shows the assertion shape):

```ts
import { describe, expect, it, vi } from "vitest";
import { uploadTrace } from "../api";

describe("uploadTrace source_export", () => {
  it("appends source_export only when provided", async () => {
    const calls: FormData[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(init.body as FormData);
        return new Response(
          JSON.stringify({ short_id: "abc", trace_url: "/t/abc", created: true }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const jsonl = new File(["{}\n"], "chat.jsonl");
    const raw = new File(["banner"], "chat.txt");

    await uploadTrace({ transcript: jsonl, sourceExport: raw });
    expect(calls[0].has("source_export")).toBe(true);

    await uploadTrace({ transcript: jsonl });
    expect(calls[1].has("source_export")).toBe(false);

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/frontend && npx vitest run src/tests/api.test.ts`
Expected: FAIL — `source_export` is never appended (`calls[0].has` is false), or a type error on `sourceExport`.

- [ ] **Step 3: Write minimal implementation**

In `webapp/frontend/src/api.ts`, add `sourceExport` to the interface:

```ts
export interface UploadTraceArgs {
  transcript: File;
  subagents?: File | null;
  sourceExport?: File | null;
  isPrivate?: boolean;
  prUrl?: string | null;
  repoFullName?: string | null;
}
```

And in `uploadTrace`, after the `subagents` append:

```ts
  if (args.subagents) form.append("subagents", args.subagents);
  if (args.sourceExport) form.append("source_export", args.sourceExport);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/frontend && npx vitest run src/tests/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/bhavya/git/vibeshub
git add webapp/frontend/src/api.ts webapp/frontend/src/tests/api.test.ts
git commit -m "feat(api): uploadTrace accepts an optional source_export file"
```

---

## Task 6: `UploadPage` converts `.txt` on submit

**Files:**
- Modify: `webapp/frontend/src/routes/UploadPage.tsx:71-123`
- Test: `webapp/frontend/src/tests/routes/UploadPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `webapp/frontend/src/tests/routes/UploadPage.test.tsx` (mirror the file's existing render/mock setup — it already mocks `../../api` and `../../auth/AuthContext`; reuse those). This asserts the `.txt` branch converts and attaches the raw file:

```ts
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { UploadPage } from "../../routes/UploadPage";

// (Assumes useAuth is mocked to return a signed-in user, as in the existing
// tests in this file. If not already present, add that mock here.)

describe("UploadPage .txt conversion", () => {
  it("uploads a converted .jsonl and attaches the raw .txt", async () => {
    const spy = vi
      .spyOn(api, "uploadTrace")
      .mockResolvedValue({ short_id: "abc", trace_url: "/t/abc", created: true });

    render(
      <MemoryRouter>
        <UploadPage />
      </MemoryRouter>,
    );

    const exportText =
      " ▐▛███▜▌   Claude Code v2.1.156\n  ~/git/vibeshub\n\n❯ fix it\n⏺ ok\n";
    const file = new File([exportText], "session.txt", { type: "text/plain" });
    const input = screen.getByLabelText(/Transcript file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /Upload trace/i }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const arg = spy.mock.calls[0][0];
    expect(arg.transcript.name).toBe("session.jsonl");
    expect(arg.sourceExport?.name).toBe("session.txt");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/frontend && npx vitest run src/tests/routes/UploadPage.test.tsx`
Expected: FAIL — `uploadTrace` is called with the raw `.txt` as `transcript` and no `sourceExport`.

- [ ] **Step 3: Write minimal implementation**

In `webapp/frontend/src/routes/UploadPage.tsx`, add the import:

```ts
import {
  looksLikeTerminalExport,
  terminalExportToJsonl,
} from "../components/trace/terminalExport";
```

Change the `.jsonl` input to also accept `.txt`:

```tsx
              accept=".jsonl,.txt"
```

And replace the body of `onSubmit` (currently `.then/.catch`) with an async version that converts `.txt` first:

```tsx
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!transcript) return;
    setStatus({ kind: "uploading" });

    let toUpload: File = transcript;
    let sourceExport: File | null = null;

    if (transcript.name.toLowerCase().endsWith(".txt")) {
      const text = await transcript.text();
      if (!looksLikeTerminalExport(text)) {
        setStatus({
          kind: "error",
          message:
            "This .txt does not look like a Claude Code export. Upload the .jsonl session file instead.",
        });
        return;
      }
      const { jsonl, recovered } = terminalExportToJsonl(text);
      if (!recovered) {
        setStatus({
          kind: "error",
          message:
            "Could not reconstruct this text export. For a full trace, upload the .jsonl session file at ~/.claude/projects/<session>.jsonl.",
        });
        return;
      }
      toUpload = new File([jsonl], transcript.name.replace(/\.txt$/i, ".jsonl"), {
        type: "application/jsonl",
      });
      sourceExport = transcript;
    }

    try {
      const result = await uploadTrace({
        transcript: toUpload,
        subagents,
        sourceExport,
        isPrivate: selection.kind === "none" ? isPrivate : false,
        prUrl: selection.kind === "pr" ? selection.prUrl : null,
        repoFullName:
          selection.kind === "repo"
            ? selection.repoFullName
            : selection.kind === "pr"
              ? selection.repoFullName
              : null,
      });
      navigate(`/t/${result.short_id}`);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.body || `Upload failed (${err.status})`
          : err instanceof Error
            ? err.message
            : String(err);
      setStatus({ kind: "error", message });
    }
  }
```

Also update the label text under the transcript field for clarity:

```tsx
              Transcript file (.jsonl, or a .txt export)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/frontend && npx vitest run src/tests/routes/UploadPage.test.tsx && npx tsc -b`
Expected: PASS; `tsc` exits 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/bhavya/git/vibeshub
git add webapp/frontend/src/routes/UploadPage.tsx webapp/frontend/src/tests/routes/UploadPage.test.tsx
git commit -m "feat(upload): convert .txt terminal exports to synthetic jsonl on submit"
```

---

## Task 7: Viewer "Imported from text export" chip

**Files:**
- Modify: `webapp/frontend/src/components/trace/Hero.tsx:104-137`
- Modify: `webapp/frontend/src/styles/viewer.css` (append)
- Test: `webapp/frontend/src/tests/trace/metaline.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `webapp/frontend/src/tests/trace/metaline.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetaLine } from "../../components/trace/Hero";
import type { Session } from "../../components/trace/types";

function makeSession(over: Partial<Session["meta"]>): Session {
  return {
    stream: [],
    meta: {
      sessionId: null,
      aiTitle: null,
      firstPrompt: null,
      cwd: null,
      gitBranch: null,
      model: null,
      modelLabel: null,
      sourceFormat: null,
      version: null,
      permissionMode: null,
      startedAt: null,
      endedAt: null,
      prLink: null,
      tokens: { input: 0, cacheCreate: 0, cacheRead: 0, output: 0 },
      assistantThinkMs: 0,
      toolCounts: {},
      toolCallCount: 0,
      userPromptCount: 0,
      assistantTextCount: 0,
      agents: [],
      ...over,
    },
  };
}

describe("MetaLine", () => {
  it("shows the import chip and modelLabel for terminal traces", () => {
    render(
      <MetaLine session={makeSession({ sourceFormat: "terminal", modelLabel: "Opus 4.8" })} />,
    );
    expect(screen.getByText(/Imported from text export/i)).toBeTruthy();
    expect(screen.getByText("Opus 4.8")).toBeTruthy();
  });

  it("renders no chip for an ordinary trace", () => {
    render(<MetaLine session={makeSession({ model: "claude-opus-4-8" })} />);
    expect(screen.queryByText(/Imported from text export/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/frontend && npx vitest run src/tests/trace/metaline.test.tsx`
Expected: FAIL — `MetaLine` is not exported / chip not rendered.

- [ ] **Step 3: Write minimal implementation**

In `webapp/frontend/src/components/trace/Hero.tsx`, change `function MetaLine` to `export function MetaLine`, show `modelLabel` when `model` is absent, and render the chip. Replace lines 104-136 with:

```tsx
export function MetaLine({ session }: { session: Session }) {
  const meta = session.meta;
  const items: Array<{ k: string; v: string }> = [];
  const modelVal = meta.model ?? meta.modelLabel;
  if (modelVal) items.push({ k: "model", v: modelVal });
  if (meta.gitBranch) items.push({ k: "branch", v: meta.gitBranch });
  if (meta.cwd) items.push({ k: "cwd", v: meta.cwd });
  if (meta.version) items.push({ k: "cli", v: meta.version });
  if (meta.permissionMode)
    items.push({ k: "permissions", v: meta.permissionMode });
  const t = meta.tokens;
  const tokensTotal = t.input + t.cacheCreate + t.output + t.cacheRead;
  if (tokensTotal > 0) {
    items.push({
      k: "tokens",
      v: `${fmtTokens(tokensTotal)} (${fmtTokens(t.output)} out · ${fmtTokens(t.cacheRead)} cache)`,
    });
  }
  const imported = meta.sourceFormat === "terminal";
  if (items.length === 0 && !imported) return null;
  return (
    <div className="meta-wrap">
      <div className="metaline">
        {imported && (
          <span
            className="metaline-item meta-import-chip"
            title="Reconstructed from a Claude Code text export. Token counts, timings, and thinking are not available."
          >
            Imported from text export
          </span>
        )}
        {items.map((it, i) => (
          <span className="metaline-item" key={i}>
            <span className="kv-key">{it.k}</span>
            <span className="kv-val">{it.v}</span>
            {i < items.length - 1 && (
              <span className="metaline-sep">·</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
```

Append to `webapp/frontend/src/styles/viewer.css`:

```css
/* Provenance chip for traces reconstructed from a .txt terminal export. */
.vibeshub-viewer .meta-import-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--text-strong);
  font-size: 11px;
  font-weight: 600;
  cursor: help;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/frontend && npx vitest run src/tests/trace/metaline.test.tsx && npx tsc -b`
Expected: PASS; `tsc` exits 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/bhavya/git/vibeshub
git add webapp/frontend/src/components/trace/Hero.tsx webapp/frontend/src/styles/viewer.css webapp/frontend/src/tests/trace/metaline.test.tsx
git commit -m "feat(viewer): show an 'Imported from text export' chip + model label"
```

---

## Task 8: Backend `source_format` column + migration

**Files:**
- Modify: `webapp/backend/app/storage/models.py:66-74`
- Create: `webapp/backend/alembic/versions/<rev>_add_source_format_to_traces.py`

- [ ] **Step 1: Add the column to the model**

In `webapp/backend/app/storage/models.py`, in `class Trace`, add after the `blob_prefix` column (around line 67):

```python
    blob_prefix: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    # "terminal" when the trace was reconstructed from a .txt export (its raw
    # bytes are archived at {blob_prefix}source_export.txt); null otherwise.
    source_format: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
```

(Test DBs build the schema from the models via `Base.metadata.create_all`, so
this alone makes the column available to the suite. The migration below is for
production Postgres / persistent SQLite.)

- [ ] **Step 2: Scaffold the migration with correct revision ids**

Run (this auto-sets `down_revision` to the current head):

```bash
cd /Users/bhavya/git/vibeshub/webapp/backend
.venv/bin/alembic revision -m "add source_format to traces"
```

- [ ] **Step 3: Fill in the migration body**

Open the new file under `alembic/versions/` and set `upgrade`/`downgrade` to (leave the generated `revision`/`down_revision` lines as-is):

```python
def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.add_column(
            "traces",
            sa.Column("source_format", sa.String(length=32), nullable=True),
        )
    else:
        with op.batch_alter_table("traces", recreate="always") as batch_op:
            batch_op.add_column(
                sa.Column("source_format", sa.String(length=32), nullable=True)
            )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.drop_column("traces", "source_format")
    else:
        with op.batch_alter_table("traces", recreate="always") as batch_op:
            batch_op.drop_column("source_format")
```

- [ ] **Step 4: Verify the migration applies and reverses**

Run:

```bash
cd /Users/bhavya/git/vibeshub/webapp/backend
VIBESHUB_DATABASE_URL="sqlite:///./_mig_check.db" .venv/bin/alembic upgrade head
VIBESHUB_DATABASE_URL="sqlite:///./_mig_check.db" .venv/bin/alembic downgrade -1
rm -f _mig_check.db
```

Expected: both commands exit 0 with no error. (If `alembic` reads a sync URL
differently in this project, use the same URL form the other migration tests
use; the key is upgrade then downgrade succeed.)

- [ ] **Step 5: Commit**

```bash
cd /Users/bhavya/git/vibeshub
git add webapp/backend/app/storage/models.py webapp/backend/alembic/versions/
git commit -m "feat(db): add source_format column to traces"
```

---

## Task 9: Backend stores + redacts the raw export

**Files:**
- Modify: `webapp/backend/app/api/trace_service.py:80-176`
- Modify: `webapp/backend/app/api/uploads.py:39-120`
- Test: `webapp/backend/tests/test_uploads.py`

- [ ] **Step 1: Write the failing tests**

Append to `webapp/backend/tests/test_uploads.py`:

```python
@pytest.mark.asyncio
async def test_uploads_stores_redacted_source_export(client, tmp_path):
    cookies, _ = await authed_cookies(client, login="alice")
    raw = b"banner\n\xe2\x9d\xaf do a thing with sk-ant-" + b"A" * 30 + b"\n"
    r = client.post(
        "/api/uploads",
        files={
            "transcript": ("chat.jsonl", b'{"type":"terminal-meta"}\n{"type":"user","message":{"content":"hi"}}\n'),
            "source_export": ("chat.txt", raw),
        },
        cookies=cookies,
    )
    assert r.status_code == 201, r.text
    short_id = r.json()["short_id"]

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == short_id)
        )).scalar_one()
    assert trace.source_format == "terminal"

    blob_dir = client.app.state.settings.blob_dir
    stored = (blob_dir / "traces" / short_id / "source_export.txt").read_bytes()
    assert b"sk-ant-" not in stored
    assert b"[REDACTED:anthropic_key]" in stored


@pytest.mark.asyncio
async def test_uploads_without_source_export_has_null_format(client):
    cookies, _ = await authed_cookies(client, login="alice")
    r = client.post(
        "/api/uploads",
        files={"transcript": ("chat.jsonl", b'{"type":"user"}\n')},
        cookies=cookies,
    )
    assert r.status_code == 201, r.text
    short_id = r.json()["short_id"]
    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == short_id)
        )).scalar_one()
    assert trace.source_format is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webapp/backend && .venv/bin/pytest tests/test_uploads.py -k source_export -v`
Expected: FAIL — `create_upload` rejects the unknown `source_export` field or `source_format` is never set / blob absent.

- [ ] **Step 3a: Extend the service**

In `webapp/backend/app/api/trace_service.py`, add two parameters to
`create_or_update_trace` (after `is_private: bool,`):

```python
    is_private: bool,
    source_export_bytes: bytes | None = None,
    source_format: str | None = None,
) -> TraceWriteResult:
```

After the `main.jsonl` put (line ~112), store the raw export when present:

```python
    await blob_store.put(f"{blob_prefix}main.jsonl", unpacked.main_bytes)
    if source_export_bytes is not None:
        await blob_store.put(
            f"{blob_prefix}source_export.txt", source_export_bytes
        )
```

Set the column in BOTH the update branch and the create branch. In the
`if existing is not None:` branch add:

```python
        trace.source_format = source_format
```

In the `else:` branch, add `source_format=source_format,` to the `Trace(...)`
constructor (next to `is_private=is_private,`).

- [ ] **Step 3b: Extend the endpoint**

In `webapp/backend/app/api/uploads.py`, add the import:

```python
from app.redact.patterns import redact_jsonl
```

Add the parameter to `create_upload` (after `subagents`):

```python
    subagents: UploadFile | None = File(default=None),
    source_export: UploadFile | None = File(default=None),
```

After the existing size checks for `main_bytes`/`zip_bytes` (around line 67),
read and redact the raw export:

```python
    source_export_bytes: bytes | None = None
    source_format: str | None = None
    if source_export is not None:
        raw = await source_export.read()
        if len(main_bytes) + len(zip_bytes or b"") + len(raw) > settings.max_trace_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"upload exceeds {settings.max_trace_bytes} bytes",
            )
        source_export_bytes, _ = redact_jsonl(raw)
        source_format = "terminal"
```

Pass both into the service call (add to the `create_or_update_trace(...)` kwargs):

```python
        is_private=assoc_private,
        source_export_bytes=source_export_bytes,
        source_format=source_format,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webapp/backend && .venv/bin/pytest tests/test_uploads.py -v`
Expected: PASS (all upload tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
cd /Users/bhavya/git/vibeshub
git add webapp/backend/app/api/trace_service.py webapp/backend/app/api/uploads.py webapp/backend/tests/test_uploads.py
git commit -m "feat(uploads): store + redact the raw .txt export; set source_format"
```

---

## Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Frontend — full unit suite + typecheck + build**

Run: `cd webapp/frontend && npx vitest run && npx tsc -b && npm run build`
Expected: all tests pass; `tsc` exits 0; build succeeds.

- [ ] **Step 2: Backend — full suite**

Run: `cd webapp/backend && .venv/bin/pytest -q`
Expected: all tests pass.

- [ ] **Step 3: Manual smoke (optional but recommended)**

Use the `run` skill (or the project's dev-server command) to start the app,
sign in, and upload the fixture `sample-terminal-export.txt` via the upload
page. Confirm: it redirects to a trace; the viewer shows the prompts, assistant
text, and a tool timeline; the "Imported from text export" chip is present;
tokens/timings are blank. Then confirm a normal `.jsonl` upload still works and
shows no chip.

- [ ] **Step 4: Final commit (if any smoke-fix changes were needed)**

```bash
cd /Users/bhavya/git/vibeshub
git add -A
git commit -m "chore: terminal-export support verification fixups"
```

---

## Notes for the implementer

- **DRY/YAGNI:** the converter intentionally does *not* try to reconstruct
  tokens, timestamps, thinking, or untruncated tool I/O — that data is not in
  the `.txt`. Don't add speculative recovery.
- **Don't touch the view path:** `buildSession`, `TraceView`, `AgentBody`,
  `Outcome` must remain unchanged. The synthetic jsonl flows through them as-is.
- **Redaction is byte-level** (`redact_jsonl` is a misnomer — it's `pattern.sub`
  over bytes), so it applies to the raw `.txt` unchanged. Don't write a second
  redactor.
- If a converter assertion in Task 4 fails on a real tool name, fix the
  converter regexes — not the assertion.
