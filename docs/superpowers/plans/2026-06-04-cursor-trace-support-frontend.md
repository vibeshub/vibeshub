# Cursor Trace Support — Frontend Implementation Plan (Phase B of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Cursor agent traces in the vibeshub viewer with the same canonical model as Claude/Codex — assistant text, thinking, native tool cards, subagents, a "Cursor" badge, and coarse Active Time — by converting the raw Cursor JSONL to canonical records at render time.

**Architecture:** Conversion happens in the browser at the single `buildSessionFromRaw` chokepoint, exactly like Codex. A new `cursorExport.ts` exposes `looksLikeCursor` + `cursorToJsonl`. Cursor's transcript is already Claude-shaped (`role` + `message.content[]`), so the converter mostly passes content blocks through while: adding a synthetic top-level `uuid` per record, emitting a `cursor-meta` marker, stripping the `<user_query>`/`<timestamp>` envelope from user text, parsing coarse timestamps, and assigning deterministic `cursor-agent-<N>` ids to `Task`/`Subagent` tool calls so subagents nest under their spawning card. This code is **dormant** for Cursor until the plugin ships and **inert** for Claude/Codex/terminal (gated behind `looksLikeCursor`).

**Tech Stack:** React + TypeScript, Vitest. Tests run from `webapp/frontend/`: `npm test`.

**Ships independently:** Yes. Inert for existing sources. Should land before the plugin starts emitting Cursor traces.

**Spec:** `docs/superpowers/specs/2026-06-04-cursor-trace-support-design.md` (§6, §7, §10).

**Cursor raw record shape (spec §3.2):** `{"role":"user"|"assistant","message":{"content":[<block>,...]}}` with no top-level `type`/`uuid`/`timestamp` and no `message.id`. Blocks: `{"type":"text","text":...}`, `{"type":"tool_use","name":...,"input":...}`. No `tool_result` blocks. Real user turns wrap text as `<timestamp>Weekday, Mon D, YYYY, H:MM AM/PM (UTC±N)</timestamp>\n<user_query>...\n</user_query>` (spec §3.4). `Task`/`Subagent` tool input is `{subagent_type, description, prompt, ...}` and carries **no id** (spec §3.5).

---

## File Structure

- Create: `webapp/frontend/src/components/trace/cursorExport.ts` — `looksLikeCursor` + `cursorToJsonl`.
- Modify: `webapp/frontend/src/components/trace/sessionFromRaw.ts` — dispatch branch.
- Modify: `webapp/frontend/src/components/trace/parser.ts` — `cursor-meta` branch (~line 199).
- Modify: `webapp/frontend/src/components/trace/types.ts:41` — widen `sourceFormat` union.
- Modify: `webapp/frontend/src/components/trace/tools.ts` — register Cursor tool names.
- Modify: `webapp/frontend/src/components/trace/Thread.tsx:47-49` — source-aware avatar/agent.
- Modify: `webapp/frontend/src/components/trace/Hero.tsx:45,127-148` — eyebrow + chip.
- Modify: `webapp/frontend/src/styles/viewer.css:~1203` — `[data-agent="cursor"]` rule.
- Create: `webapp/frontend/src/tests/trace/cursorExport.test.ts`.
- Create: `webapp/frontend/src/tests/fixtures/sample-cursor.jsonl`, `sample-cursor-subagent.jsonl`.

---

## Task 1: Create `cursorExport.ts` (converter + detector)

**Files:**
- Create: `webapp/frontend/src/components/trace/cursorExport.ts`
- Test: `webapp/frontend/src/tests/trace/cursorExport.test.ts`

- [ ] **Step 1: Write the failing test**

Create `webapp/frontend/src/tests/trace/cursorExport.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { looksLikeCursor, cursorToJsonl } from "../../components/trace/cursorExport";
import { buildSession, parseJsonl } from "../../components/trace/parser";

const CURSOR = [
  JSON.stringify({
    role: "user",
    message: { content: [{ type: "text",
      text: "<timestamp>Wednesday, Jun 3, 2026, 7:30 PM (UTC-7)</timestamp>\n<user_query>\nhelp me debug\n</user_query>" }] },
  }),
  JSON.stringify({
    role: "assistant",
    message: { content: [
      { type: "text", text: "Looking now." },
      { type: "tool_use", name: "Read", input: { path: "/x/main.py" } },
      { type: "tool_use", name: "Shell", input: { command: "ls" } },
    ] },
  }),
  JSON.stringify({
    role: "assistant",
    message: { content: [
      { type: "tool_use", name: "Subagent",
        input: { subagent_type: "explore", description: "Bug sweep", prompt: "Find bugs" } },
    ] },
  }),
].join("\n");

describe("looksLikeCursor", () => {
  it("accepts a Cursor transcript", () => {
    expect(looksLikeCursor(CURSOR)).toBe(true);
  });
  it("rejects a Claude record (has top-level type)", () => {
    expect(looksLikeCursor('{"type":"user","uuid":"u1","message":{"content":[]}}')).toBe(false);
  });
  it("rejects a Codex rollout", () => {
    expect(looksLikeCursor('{"type":"session_meta","payload":{"id":"x"}}')).toBe(false);
  });
  it("rejects non-JSON / empty", () => {
    expect(looksLikeCursor("not json")).toBe(false);
    expect(looksLikeCursor("")).toBe(false);
  });
});

describe("cursorToJsonl -> buildSession", () => {
  const session = buildSession(parseJsonl(cursorToJsonl(CURSOR)));

  it("marks the source as cursor", () => {
    expect(session.meta.sourceFormat).toBe("cursor");
  });
  it("strips the user_query/timestamp envelope from the first prompt", () => {
    expect(session.firstPrompt).toBe("help me debug");
  });
  it("parses the coarse user-turn timestamp", () => {
    // 7:30 PM UTC-7 == 02:30Z next day
    expect(session.startedAt).toBe("2026-06-04T02:30:00.000Z");
  });
  it("renders assistant text and native tool cards", () => {
    const names = session.events.flatMap((e) =>
      e.kind === "assistant" ? e.blocks.filter((b) => b.type === "tool_use").map((b) => b.name) : [],
    );
    expect(names).toContain("Read");
    expect(names).toContain("Shell");
    expect(names).toContain("Subagent");
  });
  it("assigns a deterministic cursor-agent-N id to the Subagent call", () => {
    const ids = session.events.flatMap((e) =>
      e.kind === "assistant"
        ? e.blocks.filter((b) => b.type === "tool_use" && (b.name === "Subagent" || b.name === "Task")).map((b) => b.id)
        : [],
    );
    expect(ids).toEqual(["cursor-agent-0"]);
  });
});
```

> NOTE: `session.firstPrompt`, `session.startedAt`, `session.events`, and the event `kind`/`blocks` shape are how the existing `codexExport.test.ts` and `parser.test.ts` assert against a built `Session`. If a property name differs in `types.ts` (e.g. `session.meta.startedAt` or `event.kind === "assistant"` vs another tag), adjust these assertions to match the existing tests in `src/tests/trace/` — do not invent new `Session` fields.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test -- cursorExport`
Expected: FAIL — `cursorExport.ts` does not exist (import error).

- [ ] **Step 3: Write `cursorExport.ts`**

Create `webapp/frontend/src/components/trace/cursorExport.ts`:

```ts
// Convert a raw Cursor agent transcript (.jsonl) into the canonical
// Claude-shaped records buildSession consumes. Cursor records are already
// close to canonical: { role, message: { content: [blocks] } }. We add a
// synthetic top-level uuid per record, emit a cursor-meta marker, strip the
// <user_query>/<timestamp> envelope from user text, parse coarse timestamps,
// and assign deterministic ids to Task/Subagent calls so subagents nest under
// their spawning card (see link_cursor_subagents in the plugin — same scheme).

type AnyRec = Record<string, unknown>;

const TS_RE = /<timestamp>([\s\S]*?)<\/timestamp>/;
const QUERY_RE = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/;

export function looksLikeCursor(text: string): boolean {
  const nl = text.indexOf("\n");
  const firstLine = (nl === -1 ? text : text.slice(0, nl)).trim();
  if (!firstLine) return false;
  try {
    const rec = JSON.parse(firstLine) as AnyRec;
    if ("type" in rec) return false; // Claude/Codex/terminal records carry a top-level type
    const msg = rec.message as AnyRec | undefined;
    return (
      (rec.role === "user" || rec.role === "assistant") &&
      !!msg && Array.isArray(msg.content)
    );
  } catch {
    return false;
  }
}

// "Wednesday, Jun 3, 2026, 7:30 PM (UTC-7)" -> ISO instant. Coarse (minute
// precision, user turns only). Returns null when unparseable.
function parseCursorTimestamp(raw: string): string | null {
  const m = raw.match(
    /([A-Za-z]+ \d{1,2}, \d{4}),?\s+(\d{1,2}:\d{2})\s*([AaPp][Mm])\s*\(UTC([+-]\d{1,2})(?::?(\d{2}))?\)/,
  );
  if (!m) return null;
  const [, date, hm, ap, offH, offM] = m;
  const wallMs = Date.parse(`${date} ${hm} ${ap.toUpperCase()} UTC`);
  if (Number.isNaN(wallMs)) return null;
  const sign = offH.startsWith("-") ? -1 : 1;
  const offsetMin = parseInt(offH, 10) * 60 + sign * parseInt(offM || "0", 10);
  // wall clock is in (UTC + offset); true UTC = wall - offset.
  return new Date(wallMs - offsetMin * 60_000).toISOString();
}

function userText(content: AnyRec[]): string {
  return content
    .filter((b) => b && b.type === "text")
    .map((b) => String(b.text ?? ""))
    .join("\n");
}

export function cursorToJsonl(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const records: AnyRec[] = [];
  let recN = 0;
  const uuid = () => `cursor-rec-${recN++}`;
  let lastTs = "";
  let agentN = 0; // ordinal of Task/Subagent dispatches, in document order

  records.push({ type: "cursor-meta", source: "cursor", uuid: uuid(), timestamp: "", sessionId: null, cwd: null });

  for (const raw of lines) {
    let rec: AnyRec;
    try { rec = JSON.parse(raw) as AnyRec; } catch { continue; }
    const role = rec.role;
    const msg = (rec.message ?? {}) as AnyRec;
    const content = (msg.content ?? []) as AnyRec[];
    if (!Array.isArray(content)) continue;

    if (role === "user") {
      const rawText = userText(content);
      const tsM = rawText.match(TS_RE);
      if (tsM) {
        const iso = parseCursorTimestamp(tsM[1]);
        if (iso) lastTs = iso;
      }
      const q = rawText.match(QUERY_RE);
      const clean = (q ? q[1] : rawText.replace(TS_RE, "")).trim();
      records.push({ type: "user", uuid: uuid(), timestamp: lastTs, message: { content: clean } });
      continue;
    }

    if (role === "assistant") {
      const blocks = content.map((b) => {
        if (b && b.type === "tool_use" && (b.name === "Task" || b.name === "Subagent")) {
          return { ...b, id: `cursor-agent-${agentN++}` };
        }
        if (b && b.type === "tool_use" && !b.id) {
          return { ...b, id: `cursor-tool-${recN}-${(b.name as string) ?? "x"}` };
        }
        return b;
      });
      records.push({
        type: "assistant", uuid: uuid(), timestamp: lastTs,
        message: { id: `cursor-msg-${recN}`, model: null, content: blocks },
      });
      continue;
    }
  }
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test -- cursorExport`
Expected: PASS. If the `startedAt`/`firstPrompt`/`events` assertions fail because the `Session` field names differ, fix the **test** assertions to match the real `Session` type (per the NOTE in Step 1), not the converter.

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/components/trace/cursorExport.ts webapp/frontend/src/tests/trace/cursorExport.test.ts
git commit -m "frontend: add cursorExport (looksLikeCursor + cursorToJsonl)"
```

---

## Task 2: Widen the `sourceFormat` type and add the `cursor-meta` parser branch

**Files:**
- Modify: `webapp/frontend/src/components/trace/types.ts:41`
- Modify: `webapp/frontend/src/components/trace/parser.ts` (after line 199)
- Test: extend `webapp/frontend/src/tests/trace/cursorExport.test.ts`

- [ ] **Step 1: Write the failing assertion**

The `it("marks the source as cursor")` assertion from Task 1 already exercises this end-to-end, but it currently passes only if `cursorToJsonl` emits the marker AND `parser.ts` handles it. Add a direct parser unit assertion to `cursorExport.test.ts`:

```ts
it("sets cwd/sessionId from a cursor-meta record", () => {
  const jsonl =
    JSON.stringify({ type: "cursor-meta", source: "cursor", uuid: "m", timestamp: "", cwd: "/repo", sessionId: "sess-1" }) +
    "\n" +
    JSON.stringify({ type: "user", uuid: "u", timestamp: "", message: { content: "hi" } });
  const s = buildSession(parseJsonl(jsonl));
  expect(s.meta.sourceFormat).toBe("cursor");
  expect(s.meta.cwd).toBe("/repo");
  expect(s.meta.sessionId).toBe("sess-1");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test -- cursorExport`
Expected: FAIL — `parser.ts` has no `cursor-meta` branch, so `sourceFormat` stays `null` and the TypeScript union does not include `"cursor"` (type error or runtime null).

- [ ] **Step 3: Widen the union**

In `webapp/frontend/src/components/trace/types.ts`, change line 41:

```ts
  sourceFormat: "terminal" | "codex" | null;
```

to:

```ts
  sourceFormat: "terminal" | "codex" | "cursor" | null;
```

- [ ] **Step 4: Add the `cursor-meta` branch**

In `webapp/frontend/src/components/trace/parser.ts`, immediately after the `codex-meta` block (which ends at line 199 with its closing `}`), add:

```ts
    if (r.type === "cursor-meta") {
      meta.sourceFormat = "cursor";
      const cwd = getStr(r, "cwd");
      if (cwd) meta.cwd = cwd;
      const sid = getStr(r, "sessionId");
      if (sid) meta.sessionId = sid;
    }
```

(`getStr` is the same helper the `codex-meta` branch uses on the lines above.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test -- cursorExport`
Expected: PASS (both the new branch test and all Task 1 assertions).

- [ ] **Step 6: Commit**

```bash
git add webapp/frontend/src/components/trace/types.ts webapp/frontend/src/components/trace/parser.ts webapp/frontend/src/tests/trace/cursorExport.test.ts
git commit -m "frontend: parse cursor-meta and widen sourceFormat union"
```

---

## Task 3: Wire Cursor into the `buildSessionFromRaw` chokepoint

**Files:**
- Modify: `webapp/frontend/src/components/trace/sessionFromRaw.ts`
- Test: extend `webapp/frontend/src/tests/trace/cursorExport.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `cursorExport.test.ts` (import `buildSessionFromRaw` at the top: `import { buildSessionFromRaw } from "../../components/trace/sessionFromRaw";`):

```ts
describe("buildSessionFromRaw dispatch", () => {
  it("converts a raw Cursor transcript", () => {
    expect(buildSessionFromRaw(CURSOR).meta.sourceFormat).toBe("cursor");
  });
  it("leaves a Claude transcript as a passthrough (sourceFormat null)", () => {
    const claude =
      JSON.stringify({ type: "user", uuid: "u1", message: { content: "hi" } }) + "\n" +
      JSON.stringify({ type: "assistant", uuid: "a1", message: { id: "m", content: [{ type: "text", text: "yo" }] } });
    expect(buildSessionFromRaw(claude).meta.sourceFormat).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test -- cursorExport`
Expected: FAIL — `buildSessionFromRaw` does not dispatch Cursor (the raw Cursor text is passed through unchanged, so `sourceFormat` is null).

- [ ] **Step 3: Add the dispatch branch**

In `webapp/frontend/src/components/trace/sessionFromRaw.ts`, add the import (after line 2):

```ts
import { looksLikeCursor, cursorToJsonl } from "./cursorExport";
```

and add a Cursor branch between the Codex and terminal branches:

```ts
  if (looksLikeCodex(text)) {
    jsonl = codexToJsonl(text);
  } else if (looksLikeCursor(text)) {
    jsonl = cursorToJsonl(text);
  } else if (looksLikeTerminalExport(text)) {
    jsonl = terminalExportToJsonl(text).jsonl;
  }
```

Ordering rationale: `looksLikeCodex` keys off a first-line `session_meta` record and `looksLikeCursor` rejects any record with a top-level `type` (which Codex, Claude, and converted-terminal records all have), so the three detectors are mutually exclusive; placing Cursor after Codex is safe.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test -- cursorExport`
Expected: PASS (Cursor dispatches; Claude passthrough still yields `sourceFormat` null).

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/components/trace/sessionFromRaw.ts webapp/frontend/src/tests/trace/cursorExport.test.ts
git commit -m "frontend: dispatch Cursor transcripts in buildSessionFromRaw"
```

---

## Task 4: Register Cursor tool names

`Read`, `Glob`, `Grep`, `WebSearch`, `WebFetch` already exist in `TOOL_META`. Add the Cursor-only names so each routes to the right card category.

**Files:**
- Modify: `webapp/frontend/src/components/trace/tools.ts:8-34`
- Test: extend `webapp/frontend/src/tests/trace/cursorExport.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `cursorExport.test.ts` (import at top: `import { toolCat, toolLabel } from "../../components/trace/tools";`):

```ts
describe("cursor tool registry", () => {
  it("maps Cursor tool names to the right categories", () => {
    expect(toolCat("Shell")).toBe("bash");
    expect(toolCat("AwaitShell")).toBe("bash");
    expect(toolCat("ReadFile")).toBe("read");
    expect(toolCat("Subagent")).toBe("agent");
    expect(toolCat("Task")).toBe("agent");
    expect(toolLabel("ReadFile")).toBe("Read");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test -- cursorExport`
Expected: FAIL — `toolCat("Shell")` returns `"other"` (the default), not `"bash"`.

- [ ] **Step 3: Add the registry entries**

In `webapp/frontend/src/components/trace/tools.ts`, add these entries before the closing `};` of `TOOL_META` (after the Codex block ending at line 33):

```ts
  ReadFile: { cat: "read", label: "Read" },
  Shell: { cat: "bash", label: "Shell" },
  AwaitShell: { cat: "bash", label: "Await shell" },
  Task: { cat: "agent", label: "Subagent" },
  Subagent: { cat: "agent", label: "Subagent" },
```

(`Task`/`Subagent` use `cat: "agent"` so they render via AgentBody and support subagent expansion, matching the Codex `spawn_agent` entry.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test -- cursorExport tools`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/components/trace/tools.ts webapp/frontend/src/tests/trace/cursorExport.test.ts
git commit -m "frontend: register Cursor tool names (Shell, AwaitShell, ReadFile, Task, Subagent)"
```

---

## Task 5: Source-aware avatar, eyebrow, and badge chip

Add a "Cursor" variant alongside Claude Code / Codex CLI in the three render spots and the avatar CSS.

**Files:**
- Modify: `webapp/frontend/src/components/trace/Thread.tsx:47-49`
- Modify: `webapp/frontend/src/components/trace/Hero.tsx:45` and `:127-148`
- Modify: `webapp/frontend/src/styles/viewer.css` (after the `[data-agent="codex"]` rule, ~line 1207)
- Test: extend `cursorExport.test.ts` for the avatar mapping (component-render tests for Hero are optional; mirror `HeroTitle.test.tsx` if added)

- [ ] **Step 1: Thread.tsx — 3-way avatar/agent**

In `webapp/frontend/src/components/trace/Thread.tsx`, replace lines 47-49:

```ts
  const isCodex = session.meta.sourceFormat === "codex";
  const avatarChar = isCodex ? "Cx" : "C";
  const agentKind = isCodex ? "codex" : "claude";
```

with:

```ts
  const sf = session.meta.sourceFormat;
  const avatarChar = sf === "codex" ? "Cx" : sf === "cursor" ? "Cu" : "C";
  const agentKind = sf === "codex" ? "codex" : sf === "cursor" ? "cursor" : "claude";
```

- [ ] **Step 2: Hero.tsx — eyebrow label and badge chip**

In `webapp/frontend/src/components/trace/Hero.tsx`, replace line 45:

```tsx
      <span>{trace.platform === "codex" ? "Codex CLI" : trace.platform}</span>
```

with:

```tsx
      <span>{trace.platform === "codex" ? "Codex CLI" : trace.platform === "cursor" ? "Cursor" : trace.platform}</span>
```

Then in the MetaLine section, change line 128-129:

```tsx
  const isCodex = meta.sourceFormat === "codex";
  if (items.length === 0 && !imported && !isCodex) return null;
```

to:

```tsx
  const isCodex = meta.sourceFormat === "codex";
  const isCursor = meta.sourceFormat === "cursor";
  if (items.length === 0 && !imported && !isCodex && !isCursor) return null;
```

and add a Cursor chip block immediately after the `{isCodex && (...)}` chip (after line 148):

```tsx
        {isCursor && (
          <span
            className="metaline-item meta-import-chip"
            title="Captured from a Cursor agent transcript."
          >
            Cursor
          </span>
        )}
```

- [ ] **Step 3: viewer.css — avatar rule**

In `webapp/frontend/src/styles/viewer.css`, after the `.assistant-avatar[data-agent="codex"]` rule (ends ~line 1207), add:

```css
.vibeshub-viewer .assistant-avatar[data-agent="cursor"] {
  font-size: 0.62em;
  letter-spacing: 0;
  background: var(--tool-agent);
}
```

- [ ] **Step 4: Build + test to verify nothing broke**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test -- cursorExport && npx tsc --noEmit`
Expected: PASS (tests green) and no TypeScript errors (the `sf === "cursor"` comparisons are valid against the widened union).

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/components/trace/Thread.tsx webapp/frontend/src/components/trace/Hero.tsx webapp/frontend/src/styles/viewer.css
git commit -m "frontend: source-aware Cursor avatar, eyebrow, and badge chip"
```

---

## Task 6: Real fixtures + subagent re-parse regression test

Prove a real Cursor transcript (with a subagent) round-trips and that the subagent nests under its spawning card via the `cursor-agent-<N>` id.

**Files:**
- Create: `webapp/frontend/src/tests/fixtures/sample-cursor.jsonl` (a real, redacted Cursor main transcript with at least one `Subagent`/`Task` dispatch)
- Create: `webapp/frontend/src/tests/fixtures/sample-cursor-subagent.jsonl` (the matching child transcript)
- Test: extend `webapp/frontend/src/tests/trace/cursorExport.test.ts`

- [ ] **Step 1: Capture the fixtures**

Copy a real Cursor session, redacting any secrets/paths. The main lives at `~/.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl` and the child at `.../subagents/<sub-uuid>.jsonl`. Save the main as `sample-cursor.jsonl` and one child as `sample-cursor-subagent.jsonl`. Keep them small (a handful of records). The main MUST contain at least one `{"role":"assistant","message":{"content":[{"type":"tool_use","name":"Subagent",...}]}}` dispatch.

- [ ] **Step 2: Write the failing test**

Add to `cursorExport.test.ts` (add fs imports at the top, mirroring `codexExport.test.ts`):

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CURSOR_MAIN = readFileSync(join(__dirname, "../fixtures/sample-cursor.jsonl"), "utf-8");
const CURSOR_CHILD = readFileSync(join(__dirname, "../fixtures/sample-cursor-subagent.jsonl"), "utf-8");

describe("real Cursor fixtures", () => {
  it("converts the main transcript and assigns cursor-agent ids to dispatches", () => {
    const s = buildSession(parseJsonl(cursorToJsonl(CURSOR_MAIN)));
    expect(s.meta.sourceFormat).toBe("cursor");
    const agentIds = s.events.flatMap((e) =>
      e.kind === "assistant"
        ? e.blocks.filter((b) => b.type === "tool_use" && (b.name === "Subagent" || b.name === "Task")).map((b) => b.id)
        : [],
    );
    expect(agentIds.length).toBeGreaterThan(0);
    expect(agentIds[0]).toBe("cursor-agent-0");
  });

  it("converts a child subagent transcript on its own (re-parse at depth)", () => {
    const child = buildSession(parseJsonl(cursorToJsonl(CURSOR_CHILD)));
    expect(child.meta.sourceFormat).toBe("cursor");
    expect(child.events.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run to verify it fails, then passes**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test -- cursorExport`
Expected: FAILS first if the fixtures are missing/malformed; once the fixtures are in place and valid, PASSES with no converter change (the converter from Task 1 already handles this). If the first dispatch id is not `cursor-agent-0`, confirm the fixture's first assistant `Task`/`Subagent` block is the first dispatch in document order.

- [ ] **Step 4: Run the full frontend suite**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test`
Expected: PASS (entire suite green, including Claude/Codex/terminal tests — all inert to the Cursor additions).

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/tests/fixtures/sample-cursor.jsonl webapp/frontend/src/tests/fixtures/sample-cursor-subagent.jsonl webapp/frontend/src/tests/trace/cursorExport.test.ts
git commit -m "frontend: real Cursor fixtures + subagent re-parse regression test"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** §6.1 `cursorExport.ts` (`looksLikeCursor`/`cursorToJsonl`, `cursor-meta`, envelope strip, no synthesized tool_result) → Task 1; §6.2 `parser.ts` `cursor-meta` branch + `sourceFormat` union → Task 2; chokepoint dispatch → Task 3; §6.3 `tools.ts` vocabulary → Task 4; §6.4 source-aware chrome → Task 5; §7 deterministic `cursor-agent-<N>` ids + §11 subagent re-parse → Tasks 1 & 6; §10 coarse timestamps from the `<timestamp>` envelope → Task 1 (`parseCursorTimestamp`).
- **Placeholders:** none — complete code for `cursorExport.ts` and every edit. The one explicit deferral is fixture *content* in Task 6 (real data the engineer captures), with exact path, shape, and required contents specified.
- **Type consistency:** `looksLikeCursor(string) -> boolean`, `cursorToJsonl(string) -> string` (mirroring `looksLikeCodex`/`codexToJsonl`); the marker record type is `"cursor-meta"` with `source: "cursor"` everywhere; `sourceFormat` value is `"cursor"`; the synthetic subagent id is `"cursor-agent-<ordinal>"`, matching the backend test (`tool_use_id == "cursor-agent-0"`) and the plugin linker. The Step-1 NOTE flags that `Session` field names (`firstPrompt`/`startedAt`/`events`/`kind`/`blocks`) must be reconciled against the real `types.ts` rather than invented.
