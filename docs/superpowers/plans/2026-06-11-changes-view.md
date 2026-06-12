# Changes View (Trace-Native Net Diff) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Conversation / Changes toggle to the trace viewer whose Changes mode shows a file-grouped diff of everything the session changed, with each hunk captioned by the prompt that produced it and superseded hunks collapsed.

**Architecture:** A new pure module `changes.ts` maps the parsed `Session` stream (plus subagent streams) to `FileChange[]`, reusing the existing `buildWriteRows` diff pipeline per tool call and adding an exact-match supersede pass. The private `useSubagentStreams` hook is lifted out of `Outcome.tsx` so `TraceViewer` fetches subagent streams once and shares them with both the Outcome panel and the changes model. New `ChangesView`/`FileChangeCard` components render the model with the existing `DiffView`; `ThreadControls` gains the mode pills. Client-side only; no backend changes; works on every already-stored trace.

**Tech Stack:** React + TypeScript + vitest + @testing-library/react (`npm test` in `webapp/frontend`). Spec: `docs/superpowers/specs/2026-06-11-changes-view-design.md`.

---

## Environment rules (read before every task)

- Frontend tests: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test` (or `npx vitest run <file>` for one file).
- Other sessions switch branches in this same checkout. **Every commit must verify the branch in the same shell command**, e.g.
  `git branch --show-current | grep -qx changes-view && git commit -m "..."`.
- Do NOT use a git worktree: `webapp/frontend/node_modules` is checkout-local, so tests only run in this checkout. The per-commit branch check is the mitigation for the shared checkout.
- Never use em-dashes ("—") in user-facing strings (UI copy). Code comments are fine but avoid them anyway.
- Backend: untouched by this plan.

## Facts discovered during planning (trust these)

1. Thread cards carry `data-uuid` attributes (`UserPrompt.tsx:12`, `tool/ToolCard.tsx:130`, etc.); rails jump via `document.querySelector('[data-uuid="..."]')`. **Collapsed tool runs (`ToolGroup`) render NO `data-uuid` for their tools** (see the comment at `Timeline.tsx:278-280`), so every jump needs a fallback to the prompt card's uuid.
2. Subagent streams are NOT part of `Session`. `Outcome.tsx:78-117` fetches them per-component via a private `useSubagentStreams(trace)` hook (filters out `guardian` agents, swallows per-agent failures). It returns bare streams, losing the `AgentSummary` pairing; the lifted hook must return `{ agent, stream }` entries because changes needs `tool_use_id` to find the spawning Task card.
3. `AgentSummary` (`src/types.ts:1-7`) = `{ agent_id, tool_use_id: string | null, agent_type, description, message_count }`. A subagent's spawning Task call is the main-stream `tool_use` event whose `id === agent.tool_use_id`.
4. The diff row pipeline is already complete: `buildWriteRows(input, patch)` (`diff.ts:138-168`) prefers `structuredPatch` (via `extractPatch(result?.toolUseResult?.structuredPatch)`), then `input.content` (Write), then `old_string`/`new_string` LCS, then `input.edits[]`. `DiffView` renders `DiffRow[]` with a `MAX_ROWS = 800` cap. Reuse all of it; write no new diff math.
5. `deriveFiles` (`Outcome.tsx:36-74`) is the existing files-touched walk: file-edit tools are `Write | Edit | MultiEdit | apply_patch`, all carrying `input.file_path` (codex `apply_patch` included, see `outcome.test.tsx:90`). "new" = first write is a `Write` to a path never `Read` anywhere. Mirror these rules exactly.
6. `Hero.tsx` reuses its `Props` interface for the internal `HeroEyebrow` component, so adding required props to `Props` requires narrowing `HeroEyebrow`'s props to `Pick<Props, "session" | "trace" | "rawHref">`.
7. CSS lives in `src/styles/viewer.css`, scoped under `.vibeshub-viewer`, using tokens `--bg`, `--bg-subtle`, `--bg-inset`, `--border-subtle`, `--text`, `--text-faint`, `--radius-sm`, `--font-mono`, `--diff-add-num`, `--diff-del-num`, `--color-link`, `--accent-strong` (defined in `tokens.css`; dark theme overrides exist, so never hardcode colors).
8. Component tests wrap in `MemoryRouter` (Hero renders `Link`s) and `cleanup()` in `afterEach`; jsdom lacks `Element.scrollIntoView`, mock it. See `src/tests/trace/outcome.test.tsx` for the `makeSession`/`makeTrace` fixture style.
9. Render call sites are singular: `Outcome` only from `Hero.tsx:219`, `Hero`/`ThreadControls`/`Thread` only from `TraceViewer.tsx`, `TraceViewer` only from `routes/TraceView.tsx:119` (whose props don't change). No other callers to update.

## File structure

Create:
- `webapp/frontend/src/components/trace/changes.ts` (pure model: Session stream + subagent entries -> FileChange[])
- `webapp/frontend/src/components/trace/useSubagentStreams.ts` (lifted hook, now returning paired entries)
- `webapp/frontend/src/components/trace/ChangesView.tsx` (index strip + file cards)
- `webapp/frontend/src/components/trace/FileChangeCard.tsx` (one file card: header, caption groups, hunks, stubs)
- `webapp/frontend/src/tests/trace/changes.test.ts`
- `webapp/frontend/src/tests/trace/ChangesView.test.tsx`
- `webapp/frontend/src/tests/trace/TraceViewer.test.tsx`

Modify:
- `webapp/frontend/src/components/trace/Outcome.tsx` (delete private hook, take subagent props)
- `webapp/frontend/src/components/trace/Hero.tsx` (pass-through props)
- `webapp/frontend/src/components/trace/ThreadControls.tsx` (mode pills)
- `webapp/frontend/src/components/trace/TraceViewer.tsx` (mode state, hash, jump, wiring)
- `webapp/frontend/src/styles/viewer.css` (changes-view styles)
- `webapp/frontend/src/tests/trace/outcome.test.tsx` (new props)

---

### Task 1: Feature branch

- [ ] **Step 1: Create the branch**

```bash
cd /Users/bhavya/git/vibeshub && git checkout main && git pull --ff-only && git checkout -b changes-view && git branch --show-current
```

Expected output: `changes-view`.

---

### Task 2: `changes.ts` model (TDD)

**Files:**
- Create: `webapp/frontend/src/components/trace/changes.ts`
- Test: `webapp/frontend/src/tests/trace/changes.test.ts`

- [ ] **Step 1: Write the failing tests**

`webapp/frontend/src/tests/trace/changes.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildFileChanges,
  changeAnchorId,
  type SubagentEntry,
} from "../../components/trace/changes";
import type { StreamEvent, ToolResult } from "../../components/trace/types";
import type { AgentSummary } from "../../types";

// Monotonic fixture clock: ISO timestamps compare lexicographically, which is
// all buildFileChanges relies on for ordering.
let clock = 0;
beforeEach(() => {
  clock = 0;
});
function ts(): string {
  clock += 1;
  const m = String(Math.floor(clock / 60)).padStart(2, "0");
  const s = String(clock % 60).padStart(2, "0");
  return `2026-06-11T10:${m}:${s}Z`;
}

function prompt(uuid: string, text: string): StreamEvent {
  return { kind: "user_prompt", text, ts: ts(), uuid };
}

function slashPrompt(uuid: string, name: string, args: string): StreamEvent {
  return {
    kind: "user_prompt",
    text: `${name} ${args}`,
    ts: ts(),
    uuid,
    command: { name, args },
  };
}

function tool(
  name: string,
  uuid: string,
  input: Record<string, unknown>,
  result: ToolResult | null = null,
): StreamEvent {
  return {
    kind: "tool_use",
    name,
    input,
    id: `id-${uuid}`,
    ts: ts(),
    msgId: "m1",
    uuid,
    result,
  };
}

function agent(over: Partial<AgentSummary> = {}): AgentSummary {
  return {
    agent_id: "a1",
    tool_use_id: null,
    agent_type: "refactor",
    description: "desc",
    message_count: 1,
    ...over,
  };
}

describe("buildFileChanges basics", () => {
  it("returns [] for a session with no file edits", () => {
    const stream = [prompt("p1", "hello"), tool("Bash", "t1", { command: "ls" })];
    expect(buildFileChanges(stream, [])).toEqual([]);
  });

  it("groups edits under the prompt that produced them", () => {
    const stream = [
      prompt("p1", "Fix the bug"),
      tool("Edit", "t1", {
        file_path: "/r/a.ts",
        old_string: "x",
        new_string: "y",
      }),
      prompt("p2", "Now add tests"),
      tool("Edit", "t2", {
        file_path: "/r/a.ts",
        old_string: "q",
        new_string: "r",
      }),
    ];
    const files = buildFileChanges(stream, []);
    expect(files).toHaveLength(1);
    const f = files[0];
    expect(f.path).toBe("/r/a.ts");
    expect(f.groups).toHaveLength(2);
    expect(f.groups[0].promptUuid).toBe("p1");
    expect(f.groups[0].promptExcerpt).toBe("Fix the bug");
    expect(f.groups[0].turnLabel).toBe("turn 1");
    expect(f.groups[1].turnLabel).toBe("turn 2");
    expect(f.groups[0].hunks[0].jumpUuid).toBe("t1");
    const kinds = f.groups[0].hunks[0].rows.map((r) => r.kind);
    expect(kinds).toContain("del");
    expect(kinds).toContain("add");
  });

  it("clips long prompts to about 90 chars", () => {
    const long = "a".repeat(200);
    const stream = [
      prompt("p1", long),
      tool("Edit", "t1", { file_path: "/r/a.ts", old_string: "x", new_string: "y" }),
    ];
    const excerpt = buildFileChanges(stream, [])[0].groups[0].promptExcerpt;
    expect(excerpt.length).toBe(91);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("uses the command name and args for slash-command prompts", () => {
    const stream = [
      slashPrompt("p1", "/simplify", "src"),
      tool("Edit", "t1", { file_path: "/r/a.ts", old_string: "x", new_string: "y" }),
    ];
    expect(buildFileChanges(stream, [])[0].groups[0].promptExcerpt).toBe(
      "/simplify src",
    );
  });

  it("labels edits before any prompt as session start", () => {
    const stream = [
      tool("Write", "t1", { file_path: "/r/a.ts", content: "hello" }),
    ];
    const g = buildFileChanges(stream, [])[0].groups[0];
    expect(g.promptUuid).toBeNull();
    expect(g.turnLabel).toBe("session start");
  });

  it("classifies an unread Write as new and a read path as mod", () => {
    const fresh = buildFileChanges(
      [tool("Write", "t1", { file_path: "/r/new.ts", content: "x" })],
      [],
    );
    expect(fresh[0].kind).toBe("new");
    const readFirst = buildFileChanges(
      [
        tool("Read", "t1", { file_path: "/r/old.ts" }),
        tool("Write", "t2", { file_path: "/r/old.ts", content: "x" }),
      ],
      [],
    );
    expect(readFirst[0].kind).toBe("mod");
  });

  it("orders files by first touch", () => {
    const stream = [
      tool("Edit", "t1", { file_path: "/r/z.ts", old_string: "a", new_string: "b" }),
      tool("Edit", "t2", { file_path: "/r/a.ts", old_string: "a", new_string: "b" }),
    ];
    expect(buildFileChanges(stream, []).map((f) => f.path)).toEqual([
      "/r/z.ts",
      "/r/a.ts",
    ]);
  });

  it("prefers structuredPatch rows when present", () => {
    const result: ToolResult = {
      content: "ok",
      toolUseResult: {
        structuredPatch: [
          { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-a", "+b"] },
        ],
      },
    };
    const stream = [
      tool("Edit", "t1", { file_path: "/r/a.ts", old_string: "a", new_string: "b" }, result),
    ];
    const rows = buildFileChanges(stream, [])[0].groups[0].hunks[0].rows;
    expect(rows[0].kind).toBe("hunk");
  });

  it("yields one hunk per sub-edit for MultiEdit without a patch", () => {
    const stream = [
      tool("MultiEdit", "t1", {
        file_path: "/r/a.ts",
        edits: [
          { old_string: "one", new_string: "ONE" },
          { old_string: "two", new_string: "TWO" },
        ],
      }),
    ];
    expect(buildFileChanges(stream, [])[0].groups[0].hunks).toHaveLength(2);
  });
});

describe("buildFileChanges supersede pass", () => {
  it("marks an edit superseded when a later old_string consumes its output", () => {
    const stream = [
      prompt("p1", "first try"),
      tool("Edit", "t1", { file_path: "/r/a.ts", old_string: "base", new_string: "alpha" }),
      prompt("p2", "rewrite it"),
      tool("Edit", "t2", {
        file_path: "/r/a.ts",
        old_string: "alpha plus context",
        new_string: "beta",
      }),
    ];
    const f = buildFileChanges(stream, [])[0];
    expect(f.groups[0].hunks[0].supersededBy).toEqual({ turnLabel: "turn 2" });
    expect(f.groups[1].hunks[0].supersededBy).toBeNull();
    // Stats count surviving hunks only: fallbackDiff of the second edit.
    expect(f.adds).toBe(1);
    expect(f.dels).toBe(1);
  });

  it("lets a Write supersede every earlier hunk on the file", () => {
    const stream = [
      prompt("p1", "tweak"),
      tool("Edit", "t1", { file_path: "/r/a.ts", old_string: "a", new_string: "b" }),
      prompt("p2", "start over"),
      tool("Write", "t2", { file_path: "/r/a.ts", content: "fresh\nfile" }),
    ];
    const f = buildFileChanges(stream, [])[0];
    expect(f.groups[0].hunks[0].supersededBy).toEqual({ turnLabel: "turn 2" });
    expect(f.kind).toBe("mod"); // first touch was an Edit
  });

  it("does not let a partial edit supersede a Write", () => {
    const stream = [
      tool("Write", "t1", { file_path: "/r/a.ts", content: "line1\nline2\nline3" }),
      tool("Edit", "t2", { file_path: "/r/a.ts", old_string: "line2", new_string: "LINE2" }),
    ];
    const f = buildFileChanges(stream, [])[0];
    expect(f.groups[0].hunks[0].supersededBy).toBeNull();
  });

  it("never matches empty fragments", () => {
    const stream = [
      tool("Write", "t1", { file_path: "/r/a.ts", content: "" }),
      tool("Edit", "t2", { file_path: "/r/a.ts", old_string: "whatever", new_string: "x" }),
      tool("Edit", "t3", { file_path: "/r/b.ts", old_string: "m", new_string: "n" }),
      tool("Edit", "t4", { file_path: "/r/b.ts", old_string: "", new_string: "p" }),
    ];
    const files = buildFileChanges(stream, []);
    const a = files.find((f) => f.path === "/r/a.ts")!;
    expect(a.groups[0].hunks[0].supersededBy).toBeNull();
    const b = files.find((f) => f.path === "/r/b.ts")!;
    expect(b.groups[0].hunks[0].supersededBy).toBeNull();
  });
});

describe("buildFileChanges subagents", () => {
  it("attaches subagent edits to the spawning Task dispatch", () => {
    const stream = [
      prompt("p1", "refactor the module"),
      tool("Task", "t-task", { subagent_type: "refactor", prompt: "go" }),
    ];
    // tool() assigns id `id-<uuid>`; the AgentSummary must point at it.
    const entries: SubagentEntry[] = [
      {
        agent: agent({ tool_use_id: "id-t-task", agent_type: "refactor" }),
        stream: [
          tool("Edit", "s1", { file_path: "/r/c.ts", old_string: "u", new_string: "v" }),
        ],
      },
    ];
    const f = buildFileChanges(stream, entries)[0];
    expect(f.path).toBe("/r/c.ts");
    expect(f.groups[0].agentBadge).toBe("Task[refactor]");
    expect(f.groups[0].turnLabel).toBe("turn 1");
    expect(f.groups[0].promptUuid).toBe("p1");
    expect(f.groups[0].hunks[0].jumpUuid).toBe("t-task");
  });

  it("sends unattributable subagent edits to session start", () => {
    const entries: SubagentEntry[] = [
      {
        agent: agent({ tool_use_id: null, agent_type: "general" }),
        stream: [
          tool("Edit", "s1", { file_path: "/r/c.ts", old_string: "u", new_string: "v" }),
        ],
      },
    ];
    const g = buildFileChanges([], entries)[0].groups[0];
    expect(g.turnLabel).toBe("session start");
    expect(g.promptUuid).toBeNull();
    expect(g.agentBadge).toBe("Task[general]");
    expect(g.hunks[0].jumpUuid).toBeNull();
  });
});

describe("changeAnchorId", () => {
  it("sanitizes paths into stable DOM ids", () => {
    expect(changeAnchorId("/a/b c.ts")).toBe("change--a-b-c-ts");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npx vitest run src/tests/trace/changes.test.ts`
Expected: FAIL with `Failed to resolve import "../../components/trace/changes"`.

- [ ] **Step 3: Implement the module**

`webapp/frontend/src/components/trace/changes.ts`:

```ts
import type { AgentSummary } from "../../types";
import type {
  StreamEvent,
  ToolUseEvent,
  UserPromptEvent,
} from "./types";
import type { DiffRow } from "./diff";
import { buildWriteRows, extractPatch } from "./diff";

// A subagent stream paired with its summary, so edits can be attributed to
// the spawning Task tool call (agent.tool_use_id === Task event id).
export interface SubagentEntry {
  agent: AgentSummary;
  stream: StreamEvent[];
}

export interface ChangeHunk {
  // data-uuid scroll target: the tool card for main-stream edits, the
  // spawning Task card for subagent edits, null when unattributable.
  jumpUuid: string | null;
  ts: string;
  rows: DiffRow[];
  supersededBy: { turnLabel: string } | null;
}

export interface CaptionGroup {
  promptUuid: string | null;
  promptExcerpt: string;
  turnLabel: string;
  agentBadge: string | null;
  hunks: ChangeHunk[];
}

export interface FileChange {
  path: string;
  kind: "new" | "mod";
  adds: number; // surviving hunks only
  dels: number;
  groups: CaptionGroup[];
}

// DOM id for a file card, used by the index strip's scroll links.
export function changeAnchorId(path: string): string {
  return "change-" + path.replace(/[^a-zA-Z0-9_-]/g, "-");
}

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "apply_patch"]);

interface PromptRef {
  uuid: string | null;
  excerpt: string;
  turnLabel: string;
}

const SESSION_START: PromptRef = {
  uuid: null,
  excerpt: "session start",
  turnLabel: "session start",
};

function clipExcerpt(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= 90 ? t : t.slice(0, 90) + "…";
}

function promptRef(e: UserPromptEvent, ordinal: number): PromptRef {
  const raw = e.command
    ? e.command.args
      ? `${e.command.name} ${e.command.args}`
      : e.command.name
    : e.text;
  return {
    uuid: e.uuid || null,
    excerpt: clipExcerpt(raw),
    turnLabel: `turn ${ordinal}`,
  };
}

// One file-edit operation flattened to what grouping and the supersede pass
// need. MultiEdit without a structuredPatch yields one op per sub-edit.
interface EditOp {
  path: string;
  ts: string;
  jumpUuid: string | null;
  prompt: PromptRef;
  agentBadge: string | null;
  isWrite: boolean;
  rows: DiffRow[];
  newContents: string[]; // emitted content, supersede targets
  oldStrings: string[]; // supersede sources
}

function opsFromTool(
  e: ToolUseEvent,
  prompt: PromptRef,
  jumpUuid: string | null,
  agentBadge: string | null,
): EditOp[] {
  const path = typeof e.input.file_path === "string" ? e.input.file_path : null;
  if (!path) return [];
  const patch = extractPatch(e.result?.toolUseResult?.structuredPatch);
  const base = { path, ts: e.ts, jumpUuid, prompt, agentBadge };

  if (e.name === "MultiEdit" && Array.isArray(e.input.edits) && !patch) {
    // No whole-call patch: one hunk per sub-edit (line numbers restart per
    // edit, matching the existing tool-card fallback in buildWriteRows).
    const ops: EditOp[] = [];
    for (const raw of e.input.edits) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      if (typeof o.old_string !== "string" || typeof o.new_string !== "string") {
        continue;
      }
      ops.push({
        ...base,
        isWrite: false,
        rows: buildWriteRows(
          { old_string: o.old_string, new_string: o.new_string },
          null,
        ),
        newContents: [o.new_string],
        oldStrings: [o.old_string],
      });
    }
    return ops;
  }

  const rows = buildWriteRows(e.input, patch);
  const newContents: string[] = [];
  const oldStrings: string[] = [];
  if (typeof e.input.content === "string") newContents.push(e.input.content);
  if (typeof e.input.new_string === "string") {
    newContents.push(e.input.new_string);
  }
  if (typeof e.input.old_string === "string") {
    oldStrings.push(e.input.old_string);
  }
  if (Array.isArray(e.input.edits)) {
    for (const raw of e.input.edits) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      if (typeof o.new_string === "string") newContents.push(o.new_string);
      if (typeof o.old_string === "string") oldStrings.push(o.old_string);
    }
  }
  if (newContents.length === 0 && patch) {
    // structuredPatch-only shapes (e.g. codex apply_patch): match on the
    // joined added lines.
    const added = rows.filter((r) => r.kind === "add").map((r) => r.text);
    if (added.length > 0) newContents.push(added.join("\n"));
  }
  return [
    { ...base, isWrite: e.name === "Write", rows, newContents, oldStrings },
  ];
}

export function buildFileChanges(
  stream: StreamEvent[],
  subagents: SubagentEntry[],
): FileChange[] {
  // Pass over the main stream: prompt ordinals, the prompt active at each
  // tool call, Task dispatch lookups, and Read paths (for new/mod).
  const reads = new Set<string>();
  const ops: EditOp[] = [];
  const taskByToolId = new Map<
    string,
    { uuid: string | null; prompt: PromptRef }
  >();
  let current = SESSION_START;
  let ordinal = 0;

  for (const e of stream) {
    if (e.kind === "user_prompt") {
      ordinal += 1;
      current = promptRef(e, ordinal);
      continue;
    }
    if (e.kind !== "tool_use") continue;
    if (e.name === "Read" && typeof e.input.file_path === "string") {
      reads.add(e.input.file_path);
    }
    if (e.name === "Task") {
      taskByToolId.set(e.id, { uuid: e.uuid || null, prompt: current });
    }
    if (WRITE_TOOLS.has(e.name)) {
      ops.push(...opsFromTool(e, current, e.uuid || null, null));
    }
  }

  // Subagent streams: edits attach to the spawning Task card and the prompt
  // that was active when it was dispatched.
  for (const { agent, stream: sub } of subagents) {
    const dispatch = agent.tool_use_id
      ? taskByToolId.get(agent.tool_use_id)
      : undefined;
    const prompt = dispatch?.prompt ?? SESSION_START;
    const jumpUuid = dispatch?.uuid ?? null;
    const badge = `Task[${agent.agent_type}]`;
    for (const e of sub) {
      if (e.kind !== "tool_use") continue;
      if (e.name === "Read" && typeof e.input.file_path === "string") {
        reads.add(e.input.file_path);
      }
      if (WRITE_TOOLS.has(e.name)) {
        ops.push(...opsFromTool(e, prompt, jumpUuid, badge));
      }
    }
  }

  const byPath = new Map<string, EditOp[]>();
  for (const op of ops) {
    const list = byPath.get(op.path) ?? [];
    list.push(op);
    byPath.set(op.path, list);
  }

  const files: Array<{ change: FileChange; firstTs: string }> = [];
  for (const [path, list] of byPath) {
    // ISO timestamps compare lexicographically; sort is stable so ts ties
    // keep stream order.
    list.sort((a, b) => a.ts.localeCompare(b.ts));

    // Supersede pass: a Write replaces everything before it; an edit whose
    // old_string textually contains ALL of an earlier hunk's emitted content
    // replaces that hunk. Exact substring only; empty fragments never match
    // (false negatives are fine, false positives are not).
    const superseded = new Array<{ turnLabel: string } | null>(
      list.length,
    ).fill(null);
    for (let j = 0; j < list.length; j++) {
      const later = list[j];
      for (let i = 0; i < j; i++) {
        if (superseded[i]) continue;
        if (later.isWrite) {
          superseded[i] = { turnLabel: later.prompt.turnLabel };
          continue;
        }
        const targets = list[i].newContents.filter((c) => c !== "");
        if (targets.length === 0) continue;
        const consumed = later.oldStrings.some(
          (s) => s !== "" && targets.every((c) => s.includes(c)),
        );
        if (consumed) {
          superseded[i] = { turnLabel: later.prompt.turnLabel };
        }
      }
    }

    const groups: CaptionGroup[] = [];
    let adds = 0;
    let dels = 0;
    list.forEach((op, idx) => {
      const hunk: ChangeHunk = {
        jumpUuid: op.jumpUuid,
        ts: op.ts,
        rows: op.rows,
        supersededBy: superseded[idx],
      };
      if (!hunk.supersededBy) {
        for (const r of op.rows) {
          if (r.kind === "add") adds += 1;
          else if (r.kind === "del") dels += 1;
        }
      }
      const last = groups[groups.length - 1];
      if (
        last &&
        last.promptUuid === op.prompt.uuid &&
        last.agentBadge === op.agentBadge
      ) {
        last.hunks.push(hunk);
      } else {
        groups.push({
          promptUuid: op.prompt.uuid,
          promptExcerpt: op.prompt.excerpt,
          turnLabel: op.prompt.turnLabel,
          agentBadge: op.agentBadge,
          hunks: [hunk],
        });
      }
    });

    const first = list[0];
    const kind: "new" | "mod" =
      first.isWrite && !reads.has(path) ? "new" : "mod";
    files.push({ change: { path, kind, adds, dels, groups }, firstTs: first.ts });
  }

  files.sort((a, b) => a.firstTs.localeCompare(b.firstTs));
  return files.map((f) => f.change);
}
```

- [ ] **Step 4: Run the tests until green**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npx vitest run src/tests/trace/changes.test.ts`
Expected: all PASS. Common traps: the `tool()` helper's `id` is `id-<uuid>` while `jumpUuid` is the bare `uuid` (the Task lookup keys on `id`, jump targets on `uuid`); the excerpt clip is 90 chars + "…" = 91; `f.kind` for the Write-supersedes test is "mod" because the FIRST touch was an Edit.

- [ ] **Step 5: Commit**

```bash
cd /Users/bhavya/git/vibeshub && git add webapp/frontend/src/components/trace/changes.ts webapp/frontend/src/tests/trace/changes.test.ts && git branch --show-current | grep -qx changes-view && git commit -m "feat: add trace-native file change model (changes.ts)"
```

---

### Task 3: Lift `useSubagentStreams`; Outcome and Hero take subagent props

**Files:**
- Create: `webapp/frontend/src/components/trace/useSubagentStreams.ts`
- Modify: `webapp/frontend/src/components/trace/Outcome.tsx`
- Modify: `webapp/frontend/src/components/trace/Hero.tsx`
- Modify: `webapp/frontend/src/components/trace/TraceViewer.tsx`
- Modify: `webapp/frontend/src/tests/trace/outcome.test.tsx`

- [ ] **Step 1: Create the hook file**

`webapp/frontend/src/components/trace/useSubagentStreams.ts`:

```ts
import { useEffect, useState } from "react";
import type { TraceSummary } from "../../types";
import type { SubagentEntry } from "./changes";
import { buildSessionFromRaw } from "./sessionFromRaw";
import { fetchAgentJsonl } from "../../api";

// Fetch and parse every subagent's stream once per trace, paired with its
// AgentSummary so consumers can attribute events to the spawning Task call.
// Guardian subagents are review threads and are excluded. Failures are
// swallowed per-agent so one broken subagent doesn't blank the consumers.
export function useSubagentStreams(trace: TraceSummary): {
  entries: SubagentEntry[];
  loading: boolean;
} {
  const [entries, setEntries] = useState<SubagentEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(
    (trace.agents?.length ?? 0) > 0,
  );

  useEffect(() => {
    const agents = (trace.agents ?? []).filter(
      (a) => a.agent_type !== "guardian",
    );
    if (agents.length === 0) {
      setEntries([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all(
      agents.map((a) =>
        fetchAgentJsonl(trace.short_id, a.agent_id)
          .then(
            (jsonl): SubagentEntry => ({
              agent: a,
              stream: buildSessionFromRaw(jsonl).stream,
            }),
          )
          .catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return;
      setEntries(results.filter((r): r is SubagentEntry => r !== null));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [trace.short_id, trace.agents]);

  return { entries, loading };
}
```

- [ ] **Step 2: Refactor `Outcome.tsx` to take props instead of fetching**

In `webapp/frontend/src/components/trace/Outcome.tsx`:

1. Delete the whole `useSubagentStreams` function (lines 76-117) and its imports: remove `import { buildSessionFromRaw } from "./sessionFromRaw";` and `import { fetchAgentJsonl } from "../../api";` (keep the react imports; the summary-overflow logic still uses them).
2. Add to the imports: `import type { SubagentEntry } from "./changes";`
3. Change the Props interface to:

```ts
interface Props {
  session: Session;
  trace: TraceSummary;
  subagents: SubagentEntry[];
  subagentsLoading: boolean;
}
```

4. In the component, replace

```ts
  const { streams: subStreams, loading: subLoading } =
    useSubagentStreams(trace);
```

with

```ts
  const subStreams = useMemo(
    () => subagents.map((s) => s.stream),
    [subagents],
  );
  const subLoading = subagentsLoading;
```

and change the function signature to `export function Outcome({ session, trace, subagents, subagentsLoading }: Props) {`.

- [ ] **Step 3: Thread the props through `Hero.tsx`**

1. Add to imports: `import type { SubagentEntry } from "./changes";`
2. Change the Props interface to:

```ts
interface Props {
  session: Session;
  trace: TraceSummary;
  rawHref: string;
  subagents: SubagentEntry[];
  subagentsLoading: boolean;
  canEdit?: boolean;
  onTraceUpdated?: (trace: TraceSummary) => void;
}
```

3. `HeroEyebrow` reuses `Props`; narrow it so the new required fields aren't demanded at its call site:

```ts
function HeroEyebrow({
  session,
  trace,
  rawHref,
}: Pick<Props, "session" | "trace" | "rawHref">) {
```

4. Update the `Hero` signature to destructure `subagents` and `subagentsLoading`, and pass them on:

```tsx
      <Outcome
        session={session}
        trace={trace}
        subagents={subagents}
        subagentsLoading={subagentsLoading}
      />
```

- [ ] **Step 4: Call the hook in `TraceViewer.tsx`**

Add imports:

```ts
import { useSubagentStreams } from "./useSubagentStreams";
```

Inside `TraceViewer` (before the `empty` check):

```ts
  const { entries: subagents, loading: subagentsLoading } =
    useSubagentStreams(trace);
```

And extend the Hero call:

```tsx
      <Hero
        session={session}
        trace={trace}
        rawHref={rawHref}
        subagents={subagents}
        subagentsLoading={subagentsLoading}
        canEdit={canEditTitle}
        onTraceUpdated={onTraceUpdated}
      />
```

- [ ] **Step 5: Update `outcome.test.tsx`**

Change `renderOutcome` to pass the new props:

```tsx
function renderOutcome(session: Session, trace: TraceSummary) {
  return render(
    <MemoryRouter>
      <Outcome
        session={session}
        trace={trace}
        subagents={[]}
        subagentsLoading={false}
      />
    </MemoryRouter>,
  );
}
```

- [ ] **Step 6: Run the full frontend suite**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test`
Expected: all PASS (Outcome behavior is unchanged for zero agents; no other component fetches agent streams).

- [ ] **Step 7: Commit**

```bash
cd /Users/bhavya/git/vibeshub && git add webapp/frontend/src/components/trace/useSubagentStreams.ts webapp/frontend/src/components/trace/Outcome.tsx webapp/frontend/src/components/trace/Hero.tsx webapp/frontend/src/components/trace/TraceViewer.tsx webapp/frontend/src/tests/trace/outcome.test.tsx && git branch --show-current | grep -qx changes-view && git commit -m "refactor: lift useSubagentStreams to TraceViewer, pair streams with agents"
```

---

### Task 4: `ChangesView` + `FileChangeCard` components and CSS (TDD)

**Files:**
- Create: `webapp/frontend/src/components/trace/FileChangeCard.tsx`
- Create: `webapp/frontend/src/components/trace/ChangesView.tsx`
- Modify: `webapp/frontend/src/styles/viewer.css` (append at end)
- Test: `webapp/frontend/src/tests/trace/ChangesView.test.tsx`

- [ ] **Step 1: Write the failing component tests**

`webapp/frontend/src/tests/trace/ChangesView.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChangesView } from "../../components/trace/ChangesView";
import type { FileChange } from "../../components/trace/changes";
import type { Session } from "../../components/trace/types";

function makeSession(): Session {
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
    },
  };
}

const SURVIVING: FileChange = {
  path: "/r/src/a.ts",
  kind: "mod",
  adds: 2,
  dels: 1,
  groups: [
    {
      promptUuid: "p1",
      promptExcerpt: "fix the race",
      turnLabel: "turn 3",
      agentBadge: null,
      hunks: [
        {
          jumpUuid: "t1",
          ts: "2026-06-11T10:00:01Z",
          rows: [
            { kind: "del", oldNo: 1, newNo: null, text: "old line" },
            { kind: "add", oldNo: null, newNo: 1, text: "new line" },
            { kind: "add", oldNo: null, newNo: 2, text: "second line" },
          ],
          supersededBy: null,
        },
      ],
    },
  ],
};

const WITH_STUB: FileChange = {
  path: "/r/src/b.ts",
  kind: "new",
  adds: 1,
  dels: 0,
  groups: [
    {
      promptUuid: "p1",
      promptExcerpt: "first try",
      turnLabel: "turn 1",
      agentBadge: "Task[refactor]",
      hunks: [
        {
          jumpUuid: "t2",
          ts: "2026-06-11T10:00:02Z",
          rows: [{ kind: "add", oldNo: null, newNo: 1, text: "abandoned" }],
          supersededBy: { turnLabel: "turn 4" },
        },
      ],
    },
    {
      promptUuid: "p2",
      promptExcerpt: "redo it",
      turnLabel: "turn 4",
      agentBadge: null,
      hunks: [
        {
          jumpUuid: "t3",
          ts: "2026-06-11T10:00:03Z",
          rows: [{ kind: "add", oldNo: null, newNo: 1, text: "kept" }],
          supersededBy: null,
        },
      ],
    },
  ],
};

const NO_DATA: FileChange = {
  path: "/r/src/c.ts",
  kind: "mod",
  adds: 0,
  dels: 0,
  groups: [
    {
      promptUuid: null,
      promptExcerpt: "session start",
      turnLabel: "session start",
      agentBadge: null,
      hunks: [
        {
          jumpUuid: null,
          ts: "",
          rows: [],
          supersededBy: null,
        },
      ],
    },
  ],
};

describe("ChangesView", () => {
  afterEach(() => cleanup());

  it("renders the index strip with stats and a net total", () => {
    render(
      <ChangesView
        session={makeSession()}
        changes={[SURVIVING, WITH_STUB]}
        onJump={() => {}}
      />,
    );
    expect(screen.getByText("2 files · +3 −1 net")).toBeTruthy();
    expect(screen.getAllByText("/r/src/a.ts").length).toBeGreaterThan(0);
    expect(screen.getByText("new file")).toBeTruthy();
  });

  it("fires onJump with the hunk and prompt uuids from the caption", () => {
    const onJump = vi.fn();
    render(
      <ChangesView
        session={makeSession()}
        changes={[SURVIVING]}
        onJump={onJump}
      />,
    );
    fireEvent.click(screen.getByText("jump ↗"));
    expect(onJump).toHaveBeenCalledWith("t1", "p1");
  });

  it("shows captions with turn label and agent badge", () => {
    render(
      <ChangesView
        session={makeSession()}
        changes={[WITH_STUB]}
        onJump={() => {}}
      />,
    );
    expect(screen.getByText(/first try/)).toBeTruthy();
    expect(screen.getByText("turn 1")).toBeTruthy();
    expect(screen.getByText("via Task[refactor]")).toBeTruthy();
  });

  it("collapses superseded hunks behind an expandable stub", () => {
    render(
      <ChangesView
        session={makeSession()}
        changes={[WITH_STUB]}
        onJump={() => {}}
      />,
    );
    expect(screen.queryByText("abandoned")).toBeNull();
    const stub = screen.getByText(/superseded by turn 4/);
    fireEvent.click(stub);
    expect(screen.getByText("abandoned")).toBeTruthy();
  });

  it("renders a no-patch-data row for hunks without rows", () => {
    render(
      <ChangesView
        session={makeSession()}
        changes={[NO_DATA]}
        onJump={() => {}}
      />,
    );
    expect(screen.getByText("no patch data")).toBeTruthy();
    expect(screen.getAllByText("session start").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npx vitest run src/tests/trace/ChangesView.test.tsx`
Expected: FAIL with `Failed to resolve import "../../components/trace/ChangesView"`.

- [ ] **Step 3: Implement `FileChangeCard.tsx`**

`webapp/frontend/src/components/trace/FileChangeCard.tsx`:

```tsx
import { useState } from "react";
import type { CaptionGroup, ChangeHunk, FileChange } from "./changes";
import { changeAnchorId } from "./changes";
import { DiffView } from "./tool/DiffView";
import { langFromPath } from "./highlight";
import { shortenPath } from "./format";

interface Props {
  change: FileChange;
  root: string | null;
  onJump: (jumpUuid: string | null, promptUuid: string | null) => void;
}

function hunkStats(h: ChangeHunk): string {
  let a = 0;
  let d = 0;
  for (const r of h.rows) {
    if (r.kind === "add") a += 1;
    else if (r.kind === "del") d += 1;
  }
  const parts: string[] = [];
  if (a > 0) parts.push(`+${a}`);
  if (d > 0) parts.push(`−${d}`);
  return parts.join(" ");
}

function SupersededHunk({
  hunk,
  lang,
}: {
  hunk: ChangeHunk;
  lang: string | null;
}) {
  const [open, setOpen] = useState(false);
  const stats = hunkStats(hunk);
  return (
    <div className="superseded">
      <button
        type="button"
        className="superseded-stub"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="superseded-arrow">{open ? "▾" : "▸"}</span> 1 hunk
        {stats ? ` (${stats})` : ""} superseded by {hunk.supersededBy!.turnLabel}
      </button>
      {open && (
        <div className="superseded-body">
          <DiffView rows={hunk.rows} lang={lang} />
        </div>
      )}
    </div>
  );
}

function Caption({
  group,
  onJump,
}: {
  group: CaptionGroup;
  onJump: Props["onJump"];
}) {
  const target = group.hunks.find((h) => h.jumpUuid)?.jumpUuid ?? null;
  const canJump = target !== null || group.promptUuid !== null;
  return (
    <div className="change-caption">
      <span className="change-caption-text">
        {group.promptUuid
          ? `↳ “${group.promptExcerpt}”`
          : group.promptExcerpt}
      </span>
      {group.promptUuid && (
        <span className="change-caption-turn">{group.turnLabel}</span>
      )}
      {group.agentBadge && (
        <span className="change-caption-agent">via {group.agentBadge}</span>
      )}
      {canJump && (
        <button
          type="button"
          className="change-caption-jump"
          onClick={() => onJump(target, group.promptUuid)}
        >
          jump ↗
        </button>
      )}
    </div>
  );
}

export function FileChangeCard({ change, root, onJump }: Props) {
  const lang = langFromPath(change.path);
  return (
    <section className="change-card" id={changeAnchorId(change.path)}>
      <div className="file-card change-card-head">
        <span className="file-path">{shortenPath(change.path, root)}</span>
        {change.kind === "new" && (
          <span className="change-new-badge">new file</span>
        )}
        {(change.adds > 0 || change.dels > 0) && (
          <span className="file-stats">
            {change.adds > 0 && (
              <span className="diff-stat-add">+{change.adds}</span>
            )}
            {change.dels > 0 && (
              <span className="diff-stat-del">−{change.dels}</span>
            )}
          </span>
        )}
      </div>
      {change.groups.map((g, gi) => (
        <div key={gi} className="change-group">
          <Caption group={g} onJump={onJump} />
          {g.hunks.map((h, hi) => {
            if (h.supersededBy) {
              return <SupersededHunk key={hi} hunk={h} lang={lang} />;
            }
            if (h.rows.length === 0) {
              return (
                <div key={hi} className="change-nodata">
                  no patch data
                </div>
              );
            }
            return <DiffView key={hi} rows={h.rows} lang={lang} />;
          })}
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 4: Implement `ChangesView.tsx`**

`webapp/frontend/src/components/trace/ChangesView.tsx`:

```tsx
import type { Session } from "./types";
import type { FileChange } from "./changes";
import { changeAnchorId } from "./changes";
import { FileChangeCard } from "./FileChangeCard";
import { shortenPath } from "./format";

interface Props {
  session: Session;
  changes: FileChange[];
  onJump: (jumpUuid: string | null, promptUuid: string | null) => void;
}

export function ChangesView({ session, changes, onJump }: Props) {
  const root = session.meta.cwd;
  const totalAdds = changes.reduce((n, c) => n + c.adds, 0);
  const totalDels = changes.reduce((n, c) => n + c.dels, 0);
  return (
    <div className="changes-view">
      <div className="changes-index">
        {changes.map((c) => (
          <button
            key={c.path}
            type="button"
            className="changes-index-item"
            onClick={() =>
              document
                .getElementById(changeAnchorId(c.path))
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            <span className="changes-index-path">
              {shortenPath(c.path, root)}
            </span>
            {c.kind === "new" && <span className="changes-index-new">new</span>}
            {c.adds > 0 && <span className="diff-stat-add">+{c.adds}</span>}
            {c.dels > 0 && <span className="diff-stat-del">−{c.dels}</span>}
          </button>
        ))}
        <span className="changes-index-total">
          {changes.length} {changes.length === 1 ? "file" : "files"} · +
          {totalAdds} −{totalDels} net
        </span>
      </div>
      {changes.map((c) => (
        <FileChangeCard key={c.path} change={c} root={root} onJump={onJump} />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Append the styles to `viewer.css`**

Append at the end of `webapp/frontend/src/styles/viewer.css`:

```css
/* ----- Changes view (trace-native net diff) ----- */
.vibeshub-viewer .view-pills {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: var(--bg-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  margin-right: 12px;
}
.vibeshub-viewer .view-pill {
  border: 0;
  background: transparent;
  color: var(--text-faint);
  font: inherit;
  font-size: 12px;
  padding: 3px 12px;
  border-radius: 999px;
  cursor: pointer;
}
.vibeshub-viewer .view-pill.on {
  background: var(--bg);
  color: var(--text);
}
.vibeshub-viewer .changes-view {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.vibeshub-viewer .changes-index {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  align-items: baseline;
  padding: 8px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-inset);
  font-family: var(--font-mono);
  font-size: 12px;
}
.vibeshub-viewer .changes-index-item {
  display: inline-flex;
  gap: 6px;
  align-items: baseline;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  cursor: pointer;
  padding: 0;
}
.vibeshub-viewer .changes-index-item:hover .changes-index-path {
  text-decoration: underline;
}
.vibeshub-viewer .changes-index-new {
  color: var(--diff-add-num);
  font-size: 10px;
}
.vibeshub-viewer .changes-index-total {
  margin-left: auto;
  color: var(--text-faint);
  font-size: 11px;
}
.vibeshub-viewer .change-card {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--bg);
  scroll-margin-top: 140px;
}
.vibeshub-viewer .change-card-head {
  margin: 0;
  border-bottom: 1px solid var(--border-subtle);
}
.vibeshub-viewer .change-new-badge {
  font-size: 10px;
  color: var(--diff-add-num);
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 0 7px;
  margin-left: 8px;
}
.vibeshub-viewer .change-caption {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-faint);
  background: var(--bg-subtle);
  border-top: 1px solid var(--border-subtle);
}
.vibeshub-viewer .change-group:first-of-type .change-caption {
  border-top: 0;
}
.vibeshub-viewer .change-caption-text {
  color: var(--text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vibeshub-viewer .change-caption-turn,
.vibeshub-viewer .change-caption-agent {
  flex: 0 0 auto;
}
.vibeshub-viewer .change-caption-agent {
  color: var(--accent-strong);
}
.vibeshub-viewer .change-caption-jump {
  flex: 0 0 auto;
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--color-link);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 0;
}
.vibeshub-viewer .change-caption-jump:hover {
  text-decoration: underline;
}
.vibeshub-viewer .change-card .diff-view {
  border: 0;
  border-radius: 0;
}
.vibeshub-viewer .superseded-stub {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  background: var(--bg-inset);
  color: var(--text-faint);
  font: inherit;
  font-size: 12px;
  padding: 5px 12px;
  cursor: pointer;
}
.vibeshub-viewer .superseded-body .diff-view {
  opacity: 0.55;
}
.vibeshub-viewer .change-nodata {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-faint);
}
```

- [ ] **Step 6: Run the component tests until green**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npx vitest run src/tests/trace/ChangesView.test.tsx`
Expected: all PASS. The "2 files · +3 −1 net" assertion uses U+2212 ("−") exactly as the JSX emits it.

- [ ] **Step 7: Commit**

```bash
cd /Users/bhavya/git/vibeshub && git add webapp/frontend/src/components/trace/ChangesView.tsx webapp/frontend/src/components/trace/FileChangeCard.tsx webapp/frontend/src/styles/viewer.css webapp/frontend/src/tests/trace/ChangesView.test.tsx && git branch --show-current | grep -qx changes-view && git commit -m "feat: ChangesView and FileChangeCard components"
```

---

### Task 5: Mode toggle, hash deep link, and jump wiring (TDD)

**Files:**
- Modify: `webapp/frontend/src/components/trace/ThreadControls.tsx`
- Modify: `webapp/frontend/src/components/trace/TraceViewer.tsx`
- Test: `webapp/frontend/src/tests/trace/TraceViewer.test.tsx`

- [ ] **Step 1: Write the failing tests**

`webapp/frontend/src/tests/trace/TraceViewer.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TraceViewer } from "../../components/trace/TraceViewer";
import type { Session, StreamEvent } from "../../components/trace/types";
import type { TraceSummary } from "../../types";

function makeSession(stream: StreamEvent[]): Session {
  return {
    stream,
    meta: {
      sessionId: "s1",
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
      userPromptCount: 1,
      assistantTextCount: 0,
      agents: [],
    },
  };
}

function makeTrace(): TraceSummary {
  return {
    trace_id: "t1",
    short_id: "abc1234567",
    owner_login: "alice",
    repo_full_name: null,
    pr_number: null,
    pr_url: null,
    pr_title: null,
    title: null,
    platform: "web",
    byte_size: 1024,
    message_count: 5,
    created_at: "2026-06-11T10:00:00Z",
    is_private: false,
    agent_count: 0,
    agents: [],
  };
}

const EDIT_STREAM: StreamEvent[] = [
  {
    kind: "user_prompt",
    text: "tighten the parser",
    ts: "2026-06-11T10:00:01Z",
    uuid: "p1",
  },
  {
    kind: "tool_use",
    name: "Edit",
    input: { file_path: "/r/src/x.ts", old_string: "a", new_string: "b" },
    id: "id-t1",
    ts: "2026-06-11T10:00:02Z",
    msgId: "m1",
    uuid: "t1",
    result: null,
  },
];

function renderViewer(stream: StreamEvent[]) {
  return render(
    <MemoryRouter>
      <TraceViewer
        trace={makeTrace()}
        session={makeSession(stream)}
        shortId="abc1234567"
        rawHref="/raw"
      />
    </MemoryRouter>,
  );
}

describe("TraceViewer changes mode", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    // vitest's jsdom usually provides rAF; the jump effect needs it either way.
    if (typeof window.requestAnimationFrame !== "function") {
      window.requestAnimationFrame = (cb) => {
        cb(0);
        return 0;
      };
    }
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => cleanup());

  it("hides the pills when the session has no file edits", () => {
    renderViewer([EDIT_STREAM[0]]);
    expect(screen.queryByRole("tab", { name: "Changes" })).toBeNull();
  });

  it("switches to the changes view and back", () => {
    renderViewer(EDIT_STREAM);
    expect(screen.getByText("Show system events")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    expect(window.location.hash).toBe("#changes");
    // The path renders twice (index strip + card header), so getAllByText.
    expect(screen.getAllByText("/r/src/x.ts").length).toBeGreaterThan(0);
    expect(screen.queryByText("Show system events")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Conversation" }));
    expect(window.location.hash).toBe("");
    expect(screen.getByText("Show system events")).toBeTruthy();
  });

  it("starts in changes mode when the URL hash is #changes", () => {
    window.history.replaceState(null, "", "/#changes");
    renderViewer(EDIT_STREAM);
    expect(screen.getAllByText("/r/src/x.ts").length).toBeGreaterThan(0);
  });

  it("jump returns to conversation mode and clears the hash", () => {
    renderViewer(EDIT_STREAM);
    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    fireEvent.click(screen.getByText("jump ↗"));
    expect(window.location.hash).toBe("");
    expect(screen.getByText("Show system events")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npx vitest run src/tests/trace/TraceViewer.test.tsx`
Expected: FAIL (no pills rendered; `getByRole("tab", ...)` finds nothing).

- [ ] **Step 3: Add the pills to `ThreadControls.tsx`**

Replace the whole file with:

```tsx
export type ViewMode = "conversation" | "changes";

interface Props {
  showSystemEvents: boolean;
  setShowSystemEvents: (v: boolean) => void;
  expandToolCalls: boolean;
  setExpandToolCalls: (v: boolean) => void;
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
  hasChanges: boolean;
}

function Toggle({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      className={"toggle" + (on ? " on" : "")}
      onClick={onClick}
      type="button"
      aria-pressed={on}
    >
      <span className="check" />
      {label}
    </button>
  );
}

export function ThreadControls({
  showSystemEvents,
  setShowSystemEvents,
  expandToolCalls,
  setExpandToolCalls,
  mode,
  setMode,
  hasChanges,
}: Props) {
  return (
    <div className="thread-controls">
      {hasChanges && (
        <div className="view-pills" role="tablist" aria-label="View mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "conversation"}
            className={"view-pill" + (mode === "conversation" ? " on" : "")}
            onClick={() => setMode("conversation")}
          >
            Conversation
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "changes"}
            className={"view-pill" + (mode === "changes" ? " on" : "")}
            onClick={() => setMode("changes")}
          >
            Changes
          </button>
        </div>
      )}
      {mode === "conversation" && (
        <>
          <Toggle
            on={showSystemEvents}
            onClick={() => setShowSystemEvents(!showSystemEvents)}
            label="Show system events"
          />
          <Toggle
            on={expandToolCalls}
            onClick={() => setExpandToolCalls(!expandToolCalls)}
            label="Expand tool calls"
          />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire mode, hash, and jump in `TraceViewer.tsx`**

Replace the whole file with:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { TraceSummary } from "../../types";
import type { Session } from "./types";
import { ViewerTopbar } from "./ViewerTopbar";
import { JumpStrip } from "./JumpStrip";
import { PromptRail } from "./PromptRail";
import { ChapterRail } from "./ChapterRail";
import { Hero } from "./Hero";
import { ThreadControls, type ViewMode } from "./ThreadControls";
import { Thread } from "./Thread";
import { ChangesView } from "./ChangesView";
import { buildFileChanges } from "./changes";
import { useSubagentStreams } from "./useSubagentStreams";
import { usePersistedBoolean } from "./persistedState";

interface Props {
  trace: TraceSummary;
  session: Session;
  shortId: string;
  rawHref: string;
  repoOwner?: string;
  repoName?: string;
  /** Optional owner-only controls rendered inside the topbar. */
  ownerControls?: ReactNode;
  /** Whether the current viewer owns this trace (enables title editing). */
  canEditTitle?: boolean;
  /** Called with the updated summary after an owner edits the title. */
  onTraceUpdated?: (trace: TraceSummary) => void;
}

export function TraceViewer({
  trace,
  session,
  shortId,
  rawHref,
  repoOwner,
  repoName,
  ownerControls,
  canEditTitle,
  onTraceUpdated,
}: Props) {
  const [showSystemEvents, setShowSystemEvents] = useState(false);
  const [expandToolCalls, setExpandToolCalls] = usePersistedBoolean(
    "vibeshub.trace.expandToolCalls",
    false,
  );

  const { entries: subagents, loading: subagentsLoading } =
    useSubagentStreams(trace);
  const changes = useMemo(
    () => buildFileChanges(session.stream, subagents),
    [session.stream, subagents],
  );

  // #changes in the URL deep-links into Changes mode; leaving the mode
  // (toggle or jump) clears it so shared links stay accurate.
  const [mode, setModeState] = useState<ViewMode>(() =>
    typeof window !== "undefined" && window.location.hash === "#changes"
      ? "changes"
      : "conversation",
  );
  const setMode = (m: ViewMode) => {
    setModeState(m);
    if (typeof window === "undefined") return;
    const base = window.location.pathname + window.location.search;
    window.history.replaceState(
      null,
      "",
      m === "changes" ? `${base}#changes` : base,
    );
  };

  const pendingJump = useRef<{
    jumpUuid: string | null;
    promptUuid: string | null;
  } | null>(null);
  const handleJump = (jumpUuid: string | null, promptUuid: string | null) => {
    pendingJump.current = { jumpUuid, promptUuid };
    setMode("conversation");
  };
  useEffect(() => {
    if (mode !== "conversation" || !pendingJump.current) return;
    const { jumpUuid, promptUuid } = pendingJump.current;
    pendingJump.current = null;
    // Wait one frame so the Thread is mounted before searching for anchors.
    requestAnimationFrame(() => {
      // Collapsed tool groups render no [data-uuid] for their tools; fall
      // back to the prompt card that produced the edit.
      const el =
        (jumpUuid && document.querySelector(`[data-uuid="${jumpUuid}"]`)) ||
        (promptUuid &&
          document.querySelector(`[data-uuid="${promptUuid}"]`)) ||
        null;
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [mode]);

  const empty = session.stream.length === 0;

  return (
    <div className="vibeshub-viewer">
      <div className="viewer-header">
        <ViewerTopbar
          session={session}
          repoOwner={repoOwner}
          repoName={repoName}
          ownerControls={ownerControls}
        />
        <JumpStrip session={session} />
      </div>
      <Hero
        session={session}
        trace={trace}
        rawHref={rawHref}
        subagents={subagents}
        subagentsLoading={subagentsLoading}
        canEdit={canEditTitle}
        onTraceUpdated={onTraceUpdated}
      />
      {empty ? (
        <div className="empty-state">
          This trace has no parseable events.{" "}
          <a href={rawHref}>View raw JSONL ↗</a>
        </div>
      ) : (
        <div className="viewer-body">
          {trace.ai_digest?.chapters?.length ? (
            <ChapterRail session={session} digest={trace.ai_digest} />
          ) : (
            <PromptRail session={session} />
          )}
          <div className="viewer-main">
            <ThreadControls
              showSystemEvents={showSystemEvents}
              setShowSystemEvents={setShowSystemEvents}
              expandToolCalls={expandToolCalls}
              setExpandToolCalls={setExpandToolCalls}
              mode={mode}
              setMode={setMode}
              hasChanges={changes.length > 0}
            />
            {mode === "changes" && changes.length > 0 ? (
              <ChangesView
                session={session}
                changes={changes}
                onJump={handleJump}
              />
            ) : (
              <Thread
                session={session}
                shortId={shortId}
                showSystemEvents={showSystemEvents}
                expandToolCalls={expandToolCalls}
                digest={trace.ai_digest}
              />
            )}
          </div>
        </div>
      )}
      <footer className="viewer-footer">
        <span>session · {session.meta.sessionId ?? ""}</span>
        <span>vibeshub trace viewer</span>
      </footer>
    </div>
  );
}
```

Note: `#changes` with zero edits falls through to the Thread (the `changes.length > 0` guard), and the pills stay hidden; the stale hash is harmless.

- [ ] **Step 5: Run the new tests until green**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npx vitest run src/tests/trace/TraceViewer.test.tsx`
Expected: all PASS (`cwd` is null in the fixture, so `shortenPath` returns the absolute path; it renders in both the index strip and the card header, which is why the assertions use `getAllByText`).

- [ ] **Step 6: Run the full frontend suite**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test`
Expected: all PASS (existing Thread/ToolCard/outcome tests untouched by the wiring).

- [ ] **Step 7: Commit**

```bash
cd /Users/bhavya/git/vibeshub && git add webapp/frontend/src/components/trace/ThreadControls.tsx webapp/frontend/src/components/trace/TraceViewer.tsx webapp/frontend/src/tests/trace/TraceViewer.test.tsx && git branch --show-current | grep -qx changes-view && git commit -m "feat: Conversation / Changes toggle with hash deep link and jump"
```

---

### Task 6: Full verification

- [ ] **Step 1: Full test suite**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test`
Expected: all PASS.

- [ ] **Step 2: Type-check and build**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm run build`
Expected: `tsc -b` clean, vite build succeeds.

- [ ] **Step 3: Manual smoke check (optional but recommended)**

Run `npm run dev` in `webapp/frontend`, open a trace with file edits, and verify: pills appear; Changes shows the index strip and file cards with captions; a superseded stub expands; `jump ↗` lands on the right tool card (or its prompt when tool calls are collapsed); the URL carries `#changes` and a reload lands back in Changes mode.

- [ ] **Step 4: Finish the branch**

Use the superpowers:finishing-a-development-branch skill (merge vs PR decision). Suggested PR title: "Changes view: trace-native net diff with prompt captions". Reference the spec `docs/superpowers/specs/2026-06-11-changes-view-design.md`.
