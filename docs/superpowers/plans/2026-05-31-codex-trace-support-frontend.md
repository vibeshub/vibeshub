# Codex Trace Support — Frontend Implementation Plan (Phase B of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a raw OpenAI Codex CLI rollout in the existing trace viewer with native cards (shell, apply_patch, plan, subagents), by converting it to the canonical Claude-shaped record model at render time.

**Architecture:** A raw Codex rollout is stored verbatim by the backend and served by `/raw`. At render time the viewer detects it (`looksLikeCodex`) and converts it (`codexToJsonl`) into the same synthetic records `buildSession` already consumes, exactly as the existing `terminalExport.ts` does for Claude `.txt`. A single shared `buildSessionFromRaw` entry point applies that dispatch at **all three** parse sites (top-level trace, subagent expand, Outcome's subagent streams) so Codex subagents render too. Tool names stay Codex-native and map onto existing card bodies. Converting at render time (not upload) is deliberate: the raw rollout is the stored source of truth, so the converter can be improved later with no re-upload (spec §11).

**Tech Stack:** React 19, TypeScript, Vite, Vitest. Tests: `cd webapp/frontend && npm test`.

**Ships independently:** Yes — dormant for Codex until the plugin emits Codex traces, and inert for Claude/terminal traces (both fail `looksLikeCodex`). Land after the backend plan, before/with the plugin plan.

**Spec:** `docs/superpowers/specs/2026-05-31-codex-trace-support-design.md` (§6, §11).

---

## File Structure

- Create: `webapp/frontend/src/components/trace/codexExport.ts` — `looksLikeCodex` + `codexToJsonl` (detection, record mapping, apply_patch parsing, token math).
- Create: `webapp/frontend/src/components/trace/sessionFromRaw.ts` — the single `buildSessionFromRaw(text)` dispatch.
- Create: `webapp/frontend/src/components/trace/tool/PlanBody.tsx` — the `update_plan` checklist card.
- Modify: `parser.ts` (add `codex-meta` branch), `types.ts` (widen `sourceFormat`), `tools.ts` (Codex tool registry), `tool/ToolCard.tsx` (route Codex tools), `format.ts` (Codex tool summaries), `Thread.tsx` + `AssistantText.tsx` (source-aware avatar), `Hero.tsx` (Codex chip), `Outcome.tsx` (apply_patch files + guardian skip), `routes/TraceView.tsx`, `tool/AgentBody.tsx` (use `buildSessionFromRaw`), `styles/viewer.css`.
- Create: `webapp/frontend/src/tests/fixtures/sample-codex.jsonl`, `sample-codex-subagent.jsonl`; tests `src/tests/trace/codexExport.test.ts`.

---

## Task 1: `codexExport.ts` — detection + converter

The core. Converts a Codex rollout to synthetic Claude-shaped records. Read `terminalExport.ts` first; this mirrors its record shapes (one block per `assistant` record, a unique truthy top-level `uuid` on every content record).

**Files:**
- Create: `webapp/frontend/src/components/trace/codexExport.ts`
- Test: `webapp/frontend/src/tests/trace/codexExport.test.ts`

- [ ] **Step 1: Write the failing test**

Create `webapp/frontend/src/tests/trace/codexExport.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { looksLikeCodex, codexToJsonl } from "../../components/trace/codexExport";
import { buildSession, parseJsonl } from "../../components/trace/parser";

const ROLLOUT = [
  JSON.stringify({ timestamp: "2026-05-31T16:20:17.129Z", type: "session_meta",
    payload: { id: "019e7ed6", cwd: "/Users/x/repo", cli_version: "0.135.0",
      git: { branch: "main" } } }),
  JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.5" } }),
  JSON.stringify({ type: "event_msg", payload: { type: "user_message",
    message: "list the files" } }),
  JSON.stringify({ type: "response_item", timestamp: "2026-05-31T16:20:20Z",
    payload: { type: "message", role: "assistant",
      content: [{ type: "output_text", text: "on it" }] } }),
  JSON.stringify({ type: "response_item", payload: { type: "function_call",
    name: "exec_command", call_id: "c1", arguments: JSON.stringify({ cmd: "ls", workdir: "/repo" }) } }),
  JSON.stringify({ type: "response_item", payload: { type: "function_call_output",
    call_id: "c1", output: "Process exited with code 0\nOriginal token count: 5\nOutput:\nfile.txt" } }),
  JSON.stringify({ type: "response_item", payload: { type: "function_call",
    name: "exec_command", call_id: "c2",
    arguments: JSON.stringify({ cmd: "apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: a.txt\n@@\n-old\n+new\n*** End Patch\nEOF" }) } }),
  JSON.stringify({ type: "response_item", payload: { type: "function_call_output",
    call_id: "c2", output: "Process exited with code 0\nOutput:\nDone" } }),
  JSON.stringify({ type: "response_item", payload: { type: "function_call",
    name: "spawn_agent", call_id: "c3",
    arguments: JSON.stringify({ agent_type: "default", message: "go research" }) } }),
  JSON.stringify({ type: "response_item", payload: { type: "function_call_output",
    call_id: "c3", output: JSON.stringify({ agent_id: "019e7f09", nickname: "Godel" }) } }),
  JSON.stringify({ type: "event_msg", payload: { type: "token_count",
    info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 12 } } } }),
  JSON.stringify({ type: "event_msg", payload: { type: "task_complete", duration_ms: 4200 } }),
].join("\n") + "\n";

describe("looksLikeCodex", () => {
  it("accepts a Codex rollout and rejects Claude/terminal text", () => {
    expect(looksLikeCodex(ROLLOUT)).toBe(true);
    expect(looksLikeCodex('{"type":"assistant","message":{"content":[]}}\n')).toBe(false);
    expect(looksLikeCodex("Claude Code v2.1\n❯ hi\n⏺ hello\n")).toBe(false);
  });
});

describe("codexToJsonl -> buildSession", () => {
  const session = buildSession(parseJsonl(codexToJsonl(ROLLOUT)));

  it("sets Codex meta", () => {
    expect(session.meta.sourceFormat).toBe("codex");
    expect(session.meta.model).toBe("gpt-5.5");
    expect(session.meta.cwd).toBe("/Users/x/repo");
    expect(session.meta.gitBranch).toBe("main");
  });

  it("emits the real user prompt and assistant text", () => {
    expect(session.meta.firstPrompt).toBe("list the files");
    const texts = session.stream.filter((e) => e.kind === "assistant_text");
    expect(texts.some((e) => (e as { text: string }).text === "on it")).toBe(true);
  });

  it("emits native shell / apply_patch / spawn_agent tool cards", () => {
    const tools = session.stream.filter((e) => e.kind === "tool_use") as Array<{
      name: string; input: Record<string, unknown>; result: unknown;
    }>;
    const names = tools.map((t) => t.name);
    expect(names).toContain("shell");
    expect(names).toContain("apply_patch");
    expect(names).toContain("spawn_agent");

    const shell = tools.find((t) => t.name === "shell")!;
    expect(shell.input.command).toBe("ls");

    const patch = tools.find((t) => t.name === "apply_patch")!;
    expect(patch.input.file_path).toBe("a.txt");
    const sp = (patch.result as { toolUseResult?: { structuredPatch?: unknown[] } })
      ?.toolUseResult?.structuredPatch;
    expect(Array.isArray(sp) && sp.length === 1).toBe(true);

    const spawn = tools.find((t) => t.name === "spawn_agent")!;
    expect(spawn.id).toBe("c3");
    expect(spawn.input.prompt).toBe("go research");
  });

  it("maps tokens (cached is inside input) and active time", () => {
    expect(session.meta.tokens.input).toBe(60); // 100 - 40 cached
    expect(session.meta.tokens.cacheRead).toBe(40);
    expect(session.meta.tokens.output).toBe(12);
    expect(session.meta.assistantThinkMs).toBe(4200);
  });
});
```

Note: this test references `session.meta.sourceFormat === "codex"`, which requires Task 2's `types.ts` widening and `parser.ts` branch; that's fine for TDD — Task 1 makes the converter compile, Task 2 makes `sourceFormat` assert pass. To keep Task 1 green on its own, the converter must be complete; the `sourceFormat` assertion is the one line that goes green in Task 2.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test -- codexExport`
Expected: FAIL — `codexExport` module does not exist (import error).

- [ ] **Step 3: Write `codexExport.ts`**

Create `webapp/frontend/src/components/trace/codexExport.ts`:

```ts
// Convert a raw OpenAI Codex CLI rollout (.jsonl) into the synthetic
// Claude-shaped records `buildSession` consumes. Mirrors terminalExport.ts:
// one content block per `assistant` record, a unique truthy top-level `uuid`
// on every content record.

type AnyRec = Record<string, unknown>;

const APPLY_PATCH_RE = /^\s*apply_patch\b/;

export function looksLikeCodex(text: string): boolean {
  const firstLine = text.slice(0, 16000).split("\n").find((l) => l.trim());
  if (!firstLine) return false;
  try {
    const rec = JSON.parse(firstLine) as AnyRec;
    const payload = rec.payload as AnyRec | undefined;
    return rec.type === "session_meta" && !!payload && typeof payload.id === "string";
  } catch {
    return false;
  }
}

interface PatchHunk {
  oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[];
}
interface ParsedFile { path: string; hunk: PatchHunk; }

function parseExecOutput(output: string): { body: string; exitCode: number | null } {
  const codeM = output.match(/Process exited with code (\d+)/);
  const exitCode = codeM ? Number(codeM[1]) : null;
  const idx = output.indexOf("\nOutput:\n");
  const body = idx >= 0 ? output.slice(idx + "\nOutput:\n".length) : output;
  return { body, exitCode };
}

// Parse an OpenAI `apply_patch` envelope embedded in a shell command into one
// hunk per file. Line numbers are approximate (the envelope omits them), but
// the +/-/context lines are exact, so DiffView renders correctly. Returns null
// when nothing parseable is found.
function parseApplyPatch(cmd: string): ParsedFile[] | null {
  const begin = cmd.indexOf("*** Begin Patch");
  const end = cmd.indexOf("*** End Patch");
  if (begin < 0 || end < 0 || end < begin) return null;
  const bodyLines = cmd.slice(begin, end).split("\n");
  const files: ParsedFile[] = [];
  let current: { path: string; lines: string[] } | null = null;
  const flush = () => {
    if (current && current.lines.length > 0) {
      const added = current.lines.filter((l) => l.startsWith("+")).length;
      const removed = current.lines.filter((l) => l.startsWith("-")).length;
      const ctx = current.lines.length - added - removed;
      files.push({
        path: current.path,
        hunk: { oldStart: 1, oldLines: ctx + removed, newStart: 1, newLines: ctx + added, lines: current.lines },
      });
    }
    current = null;
  };
  for (const line of bodyLines) {
    const fileM = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/);
    if (fileM) { flush(); current = { path: fileM[1].trim(), lines: [] }; continue; }
    if (line.startsWith("***") || line.startsWith("@@")) continue;
    if (current && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))) {
      current.lines.push(line);
    }
  }
  flush();
  return files.length > 0 ? files : null;
}

// Codex counts cached tokens INSIDE input_tokens; Anthropic's shape excludes
// cache_read from input_tokens. Convert so buildSession's summation matches.
function mapUsage(last: AnyRec): AnyRec {
  const input = (last.input_tokens as number) || 0;
  const cached = (last.cached_input_tokens as number) || 0;
  return {
    input_tokens: Math.max(0, input - cached),
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
    output_tokens: (last.output_tokens as number) || 0,
  };
}

function mapToolCall(
  rawName: string, args: AnyRec, callId: string, patchByCall: Map<string, PatchHunk>,
): { name: string; input: AnyRec } {
  if (rawName === "exec_command") {
    const cmd = String(args.cmd ?? "");
    if (APPLY_PATCH_RE.test(cmd)) {
      const files = parseApplyPatch(cmd);
      if (files && files.length === 1) {
        patchByCall.set(callId, files[0].hunk);
        return { name: "apply_patch", input: { file_path: files[0].path } };
      }
      // multi-file or unparseable: fall through to a shell card showing the
      // raw patch (honest fallback, spec §10).
    }
    return { name: "shell", input: { command: cmd, description: String(args.workdir ?? "") } };
  }
  if (rawName === "update_plan") {
    return { name: "update_plan", input: { plan: args.plan ?? [], explanation: args.explanation ?? "" } };
  }
  if (rawName === "spawn_agent") {
    return { name: "spawn_agent", input: {
      subagent_type: String(args.agent_type ?? "default"),
      model: String(args.model ?? "default"),
      prompt: String(args.message ?? ""),
      description: String(args.message ?? ""),
    } };
  }
  return { name: rawName, input: args };
}

export function codexToJsonl(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const records: AnyRec[] = [];
  let recN = 0;
  const uuid = () => `codex-rec-${recN++}`;
  let model: string | null = null;
  let lastAssistant: AnyRec | null = null;
  const patchByCall = new Map<string, PatchHunk>();

  const pushAssistant = (block: AnyRec, ts: string): void => {
    const rec: AnyRec = {
      type: "assistant", uuid: uuid(), timestamp: ts,
      message: { id: `codex-msg-${recN}`, model, content: [block] },
    };
    records.push(rec);
    lastAssistant = rec;
  };

  for (const raw of lines) {
    let rec: AnyRec;
    try { rec = JSON.parse(raw) as AnyRec; } catch { continue; }
    const ts = String(rec.timestamp ?? "");
    const payload = (rec.payload ?? {}) as AnyRec;

    if (rec.type === "session_meta") {
      const git = (payload.git ?? {}) as AnyRec;
      records.push({
        type: "codex-meta", source: "codex", uuid: uuid(), timestamp: ts,
        sessionId: payload.id ?? null, cwd: payload.cwd ?? null,
        gitBranch: git.branch ?? null, version: payload.cli_version ?? null,
      });
      continue;
    }
    if (rec.type === "turn_context") {
      if (typeof payload.model === "string") model = payload.model;
      continue;
    }
    if (rec.type === "event_msg") {
      const pt = payload.type;
      if (pt === "user_message" && typeof payload.message === "string" && payload.message) {
        records.push({ type: "user", uuid: uuid(), timestamp: ts, message: { content: payload.message } });
      } else if (pt === "token_count" && lastAssistant) {
        const info = (payload.info ?? {}) as AnyRec;
        const lastUse = info.last_token_usage as AnyRec | undefined;
        if (lastUse) (lastAssistant.message as AnyRec).usage = mapUsage(lastUse);
      } else if (pt === "task_complete" && typeof payload.duration_ms === "number") {
        records.push({ type: "system", subtype: "turn_duration", durationMs: payload.duration_ms, uuid: uuid(), timestamp: ts });
      }
      continue;
    }
    if (rec.type === "response_item") {
      const pt = payload.type;
      if (pt === "message" && payload.role === "assistant") {
        for (const part of (payload.content as AnyRec[]) ?? []) {
          if (part && part.type === "output_text") {
            pushAssistant({ type: "text", text: String(part.text ?? "") }, ts);
          }
        }
      } else if (pt === "reasoning") {
        const parts = [...((payload.summary as AnyRec[]) ?? []), ...((payload.content as AnyRec[]) ?? [])];
        for (const s of parts) {
          if (s && typeof s.text === "string" && s.text) pushAssistant({ type: "thinking", thinking: s.text }, ts);
        }
      } else if (pt === "function_call") {
        const callId = String(payload.call_id ?? "");
        let args: AnyRec = {};
        try { args = JSON.parse(String(payload.arguments ?? "{}")) as AnyRec; } catch { args = {}; }
        const { name, input } = mapToolCall(String(payload.name ?? ""), args, callId, patchByCall);
        pushAssistant({ type: "tool_use", id: callId, name, input }, ts);
      } else if (pt === "function_call_output") {
        const callId = String(payload.call_id ?? "");
        const { body, exitCode } = parseExecOutput(String(payload.output ?? ""));
        const toolUseResult: AnyRec = { stdout: body };
        if (exitCode !== null) toolUseResult.exitCode = exitCode;
        const hunk = patchByCall.get(callId);
        if (hunk) toolUseResult.structuredPatch = [hunk];
        records.push({
          type: "user", uuid: uuid(), timestamp: ts,
          message: { content: [{ type: "tool_result", tool_use_id: callId, content: body, is_error: exitCode !== null && exitCode !== 0 }] },
          toolUseResult,
        });
      }
      continue;
    }
  }
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes (except the `sourceFormat` line)**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test -- codexExport`
Expected: PASS for `looksLikeCodex`, prompt/text, tool cards, and tokens/active-time. The single `expect(session.meta.sourceFormat).toBe("codex")` assertion FAILS until Task 2 (parser doesn't yet handle `codex-meta`). That is the intended hand-off to Task 2.

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/components/trace/codexExport.ts webapp/frontend/src/tests/trace/codexExport.test.ts
git commit -m "frontend: codexExport converter (Codex rollout -> canonical records)"
```

---

## Task 2: `parser.ts` `codex-meta` branch + widen `sourceFormat`

**Files:**
- Modify: `webapp/frontend/src/components/trace/types.ts` (the `sourceFormat` union)
- Modify: `webapp/frontend/src/components/trace/parser.ts` (add a `codex-meta` branch next to `terminal-meta`)

- [ ] **Step 1: The failing assertion already exists**

The `expect(session.meta.sourceFormat).toBe("codex")` line in `codexExport.test.ts` (Task 1) is the failing test for this task.

- [ ] **Step 2: Run to confirm it fails**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test -- codexExport`
Expected: that one assertion FAILS (`sourceFormat` is `null`).

- [ ] **Step 3: Widen the type and add the parser branch**

In `webapp/frontend/src/components/trace/types.ts`, change the `SessionMeta.sourceFormat` field:

```ts
  sourceFormat: "terminal" | null;
```
to:
```ts
  sourceFormat: "terminal" | "codex" | null;
```

In `webapp/frontend/src/components/trace/parser.ts`, add a branch right after the existing `if (r.type === "terminal-meta") { ... }` block:

```ts
    if (r.type === "codex-meta") {
      meta.sourceFormat = "codex";
      const cwd = getStr(r, "cwd");
      if (cwd) meta.cwd = cwd;
      const branch = getStr(r, "gitBranch");
      if (branch) meta.gitBranch = branch;
      const version = getStr(r, "version");
      if (version) meta.version = version;
      const sid = getStr(r, "sessionId");
      if (sid) meta.sessionId = sid;
    }
```

(Model is carried on each assistant record's `message.model` and picked up by the existing generic capture, so it is not set here.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test -- codexExport`
Expected: PASS (all assertions, including `sourceFormat === "codex"`).

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/components/trace/types.ts webapp/frontend/src/components/trace/parser.ts
git commit -m "frontend: parser reads codex-meta marker, sourceFormat gains codex"
```

---

## Task 3: `buildSessionFromRaw` + wire all three parse sites

**Files:**
- Create: `webapp/frontend/src/components/trace/sessionFromRaw.ts`
- Modify: `routes/TraceView.tsx:66`, `tool/AgentBody.tsx:4,40`, `Outcome.tsx:94`
- Test: `webapp/frontend/src/tests/trace/codexExport.test.ts` (add)

- [ ] **Step 1: Write the failing test**

Append to `codexExport.test.ts`:

```ts
import { buildSessionFromRaw } from "../../components/trace/sessionFromRaw";

describe("buildSessionFromRaw dispatch", () => {
  it("renders a raw Codex rollout (the subagent re-parse path)", () => {
    const session = buildSessionFromRaw(ROLLOUT);
    expect(session.meta.sourceFormat).toBe("codex");
    expect(session.stream.length).toBeGreaterThan(0);
  });

  it("passes a Claude jsonl through unchanged", () => {
    const claude = '{"type":"assistant","uuid":"u1","message":{"id":"m","content":[{"type":"text","text":"hi"}]}}\n';
    const session = buildSessionFromRaw(claude);
    expect(session.meta.sourceFormat).toBeNull();
    expect(session.stream.some((e) => e.kind === "assistant_text")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test -- codexExport`
Expected: FAIL — `sessionFromRaw` module does not exist.

- [ ] **Step 3: Create the shared entry and wire the sites**

Create `webapp/frontend/src/components/trace/sessionFromRaw.ts`:

```ts
import { buildSession, parseJsonl } from "./parser";
import { looksLikeCodex, codexToJsonl } from "./codexExport";
import { looksLikeTerminalExport, terminalExportToJsonl } from "./terminalExport";
import type { Session } from "./types";

// The single entry point for turning a raw stored transcript into a Session.
// Stored Codex rollouts are raw (converted here at render time); stored Claude
// and already-converted terminal traces pass through unchanged.
export function buildSessionFromRaw(text: string): Session {
  let jsonl = text;
  if (looksLikeCodex(text)) {
    jsonl = codexToJsonl(text);
  } else if (looksLikeTerminalExport(text)) {
    jsonl = terminalExportToJsonl(text).jsonl;
  }
  return buildSession(parseJsonl(jsonl));
}
```

In `webapp/frontend/src/routes/TraceView.tsx`, replace `buildSession(parseJsonl(body.jsonl))` (line ~66) with `buildSessionFromRaw(body.jsonl)`, and update the import to add `buildSessionFromRaw` from `../components/trace/sessionFromRaw` (keep the existing `parseJsonl`/`buildSession` import only if still used elsewhere; remove if not).

In `webapp/frontend/src/components/trace/tool/AgentBody.tsx`, change the import line 4 from:
```ts
import { buildSession, parseJsonl } from "../parser";
```
to:
```ts
import { buildSessionFromRaw } from "../sessionFromRaw";
```
and line 40 from `setNested(buildSession(parseJsonl(jsonl)));` to `setNested(buildSessionFromRaw(jsonl));`.

In `webapp/frontend/src/components/trace/Outcome.tsx`, change line 94 from `.then((jsonl) => buildSession(parseJsonl(jsonl)).stream)` to `.then((jsonl) => buildSessionFromRaw(jsonl).stream)`, and update its import (replace `buildSession, parseJsonl` from `./parser` with `buildSessionFromRaw` from `./sessionFromRaw`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test`
Expected: PASS (new dispatch tests plus the full existing suite — no regressions in parser/terminalExport/outcome tests).

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/components/trace/sessionFromRaw.ts webapp/frontend/src/routes/TraceView.tsx webapp/frontend/src/components/trace/tool/AgentBody.tsx webapp/frontend/src/components/trace/Outcome.tsx
git commit -m "frontend: route all three raw-parse sites through buildSessionFromRaw"
```

---

## Task 4: Native Codex tool cards (registry, routing, summaries, PlanBody)

**Files:**
- Modify: `tools.ts`, `tool/ToolCard.tsx`, `format.ts`
- Create: `tool/PlanBody.tsx`, CSS in `styles/viewer.css`
- Test: `webapp/frontend/src/tests/trace/codexExport.test.ts` (add a tools.ts assertion)

- [ ] **Step 1: Write the failing test**

Append to `codexExport.test.ts`:

```ts
import { toolCat, toolLabel } from "../../components/trace/tools";

describe("Codex tool registry", () => {
  it("categorizes and labels Codex tools", () => {
    expect(toolCat("shell")).toBe("bash");
    expect(toolCat("apply_patch")).toBe("write");
    expect(toolCat("update_plan")).toBe("task");
    expect(toolCat("spawn_agent")).toBe("agent");
    expect(toolLabel("shell")).toBe("Shell");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test -- codexExport`
Expected: FAIL — `toolCat("shell")` returns `"other"`.

- [ ] **Step 3: Add registry entries, routing, summaries, and PlanBody**

In `webapp/frontend/src/components/trace/tools.ts`, add these entries to `TOOL_META`:

```ts
  shell: { cat: "bash", label: "Shell" },
  apply_patch: { cat: "write", label: "Apply patch" },
  update_plan: { cat: "task", label: "Plan" },
  spawn_agent: { cat: "agent", label: "Subagent" },
  wait_agent: { cat: "agent", label: "Wait for agent" },
  web_search: { cat: "read", label: "Web search" },
```

Create `webapp/frontend/src/components/trace/tool/PlanBody.tsx`:

```tsx
interface Props {
  input: Record<string, unknown>;
}

function symbolFor(status: unknown): string {
  if (status === "completed") return "✓";
  if (status === "in_progress") return "◐";
  return "○";
}

export function PlanBody({ input }: Props) {
  const plan = (input.plan as Array<{ step?: string; status?: string }>) || [];
  if (plan.length === 0) return null;
  return (
    <ol className="plan-body">
      {plan.map((p, i) => (
        <li key={i} className={`plan-item plan-${p.status ?? "pending"}`}>
          <span className="plan-status">{symbolFor(p.status)}</span>
          <span className="plan-step">{p.step ?? ""}</span>
        </li>
      ))}
    </ol>
  );
}
```

In `webapp/frontend/src/components/trace/tool/ToolCard.tsx`, import `PlanBody` and extend the `renderBody` switch: add `case "shell":` to the existing `Bash` body, add `apply_patch` to the write `FileBody`, add a `update_plan` case, and add `spawn_agent` to the `Agent` case:

```ts
    case "Bash":
    case "shell":
      return <BashBody input={event.input} result={event.result} />;
```
```ts
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "apply_patch":
      return (
        <FileBody mode="write" input={event.input} result={event.result} root={root} />
      );
```
```ts
    case "update_plan":
      return <PlanBody input={event.input} />;
```
```ts
    case "Agent":
    case "spawn_agent":
      return (
        <AgentBody
          input={event.input}
          toolUseId={event.id}
          shortId={shortId}
          agents={agents}
        />
      );
```

In `webapp/frontend/src/components/trace/format.ts`, add cases to `toolSummary`'s switch:

```ts
    case "shell":
      return s("command") || s("description") || "";
    case "apply_patch":
      return shortenPath(s("file_path") || "", root);
    case "update_plan": {
      const plan = (input.plan as Array<{ status?: string }>) || [];
      const done = plan.filter((p) => p?.status === "completed").length;
      return `${done}/${plan.length} steps`;
    }
    case "spawn_agent":
      return (
        s("description") ||
        (s("subagent_type") ? `dispatch ${s("subagent_type")}` : "")
      );
```

Add to `webapp/frontend/src/styles/viewer.css`:

```css
.plan-body { margin: 0; padding-left: 0; list-style: none; }
.plan-item { display: flex; gap: 8px; padding: 2px 0; }
.plan-item .plan-status { width: 1em; color: var(--text-muted); }
.plan-item.plan-completed .plan-step { text-decoration: line-through; opacity: 0.7; }
.plan-item.plan-in_progress .plan-status { color: var(--tool-task); }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test`
Expected: PASS (registry test plus full suite).

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/components/trace/tools.ts webapp/frontend/src/components/trace/tool/ToolCard.tsx webapp/frontend/src/components/trace/tool/PlanBody.tsx webapp/frontend/src/components/trace/format.ts webapp/frontend/src/styles/viewer.css
git commit -m "frontend: native Codex tool cards (shell, apply_patch, plan, spawn_agent)"
```

---

## Task 5: Source-aware branding + Outcome (apply_patch files, guardian skip)

**Files:**
- Modify: `AssistantText.tsx`, `Thread.tsx`, `Hero.tsx`, `Outcome.tsx`
- Test: `webapp/frontend/src/tests/trace/outcome.test.tsx` (add) — uses the existing `makeSession`/`makeTrace` factories

- [ ] **Step 1: Write the failing test**

Add to `webapp/frontend/src/tests/trace/outcome.test.tsx` (it has `makeSession`/`makeTrace` and renders inside `<MemoryRouter>`; import what it already imports). Add a `deriveFiles`-level assertion by rendering a session whose stream has a Codex `apply_patch` tool_use and asserting the file appears. If `deriveFiles` is not exported, assert via the rendered Outcome DOM that the path shows. Concretely, assert the guardian filter and apply_patch by unit-testing the exported helper if available; otherwise add this DOM test:

```tsx
it("counts apply_patch as a touched file", () => {
  const session = makeSession({
    sourceFormat: "codex",
    toolCounts: { apply_patch: 1 },
    toolCallCount: 1,
  });
  session.stream = [
    {
      kind: "tool_use", name: "apply_patch", id: "c2",
      input: { file_path: "src/a.ts" }, ts: "", msgId: "", uuid: "u1", result: null,
    },
  ];
  render(
    <MemoryRouter>
      <Outcome session={session} trace={makeTrace({ agents: [] })} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/a\.ts/)).toBeTruthy();
});
```

(Adjust the `Outcome` prop names to match its actual signature in the file.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test -- outcome`
Expected: FAIL — `deriveFiles` ignores `apply_patch`, so the path is not rendered.

- [ ] **Step 3: Implement branding + Outcome changes**

In `webapp/frontend/src/components/trace/Outcome.tsx`:
- In `deriveFiles`, extend the write check to include `apply_patch`:
```ts
      if (e.name === "Write" || e.name === "Edit" || e.name === "MultiEdit" || e.name === "apply_patch") {
        writes.push({ path: fp, name: e.name, ts: e.ts });
      }
```
  and treat a path with no prior `Read` written by `apply_patch` as `"mod"` (it usually edits existing files), i.e. keep the existing rule but only `Write` flips to `"new"`:
```ts
    const kind: "new" | "mod" =
      w.name === "Write" && !reads.has(w.path) ? "new" : "mod";
```
  (no change needed — `apply_patch` already falls to `"mod"`).
- In `useSubagentStreams`, skip guardians so files-touched and the subagent panel ignore review threads:
```ts
    const agents = (trace.agents ?? []).filter((a) => a.agent_type !== "guardian");
```

In `webapp/frontend/src/components/trace/AssistantText.tsx`, make the avatar source-aware via props (default keeps Claude's "C"):

```tsx
interface Props {
  event: AssistantTextEvent;
  avatar?: string;
  agent?: string;
}

export function AssistantText({ event, avatar = "C", agent = "claude" }: Props) {
  return (
    <div className="assistant-text" data-uuid={event.uuid}>
      <div className="assistant-avatar" data-agent={agent}>{avatar}</div>
      <div className="assistant-text-body">
        <Markdown text={event.text} />
      </div>
    </div>
  );
}
```

In `webapp/frontend/src/components/trace/Thread.tsx`, compute the avatar from session meta once and pass it where it renders `<AssistantText event={e} />`:

```tsx
  const isCodex = session.meta.sourceFormat === "codex";
  const avatarChar = isCodex ? "Cx" : "C";
  const agentKind = isCodex ? "codex" : "claude";
  // ... in the assistant_text branch:
  //   <AssistantText event={e} avatar={avatarChar} agent={agentKind} />
```

Add to `webapp/frontend/src/styles/viewer.css`:
```css
.assistant-avatar[data-agent="codex"] { font-size: 0.62em; letter-spacing: 0; background: var(--tool-agent); }
```

In `webapp/frontend/src/components/trace/Hero.tsx`, in `MetaLine` (which already shows an "Imported from text export" chip when `meta.sourceFormat === "terminal"`), add a Codex chip:
```tsx
  const isCodex = meta.sourceFormat === "codex";
  // ... where the imported chip renders, add:
  //   {isCodex && <span className="meta-chip">Codex CLI</span>}
```
and in `HeroEyebrow`, render the platform label nicely (Codex traces have `trace.platform === "codex"`): replace `<span>{trace.platform}</span>` with:
```tsx
      <span>{trace.platform === "codex" ? "Codex CLI" : trace.platform}</span>
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test`
Expected: PASS (the apply_patch files test plus the full suite).

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/components/trace/Outcome.tsx webapp/frontend/src/components/trace/AssistantText.tsx webapp/frontend/src/components/trace/Thread.tsx webapp/frontend/src/components/trace/Hero.tsx webapp/frontend/src/styles/viewer.css webapp/frontend/src/tests/trace/outcome.test.tsx
git commit -m "frontend: source-aware avatar/chip, apply_patch files-touched, skip guardian subagents"
```

---

## Task 6: Real-fixture round-trip + subagent re-parse regression

Proves a realistic Codex rollout (with a subagent child) renders, and guards the §6.1 re-parse fix.

**Files:**
- Create: `webapp/frontend/src/tests/fixtures/sample-codex.jsonl`, `sample-codex-subagent.jsonl`
- Test: `webapp/frontend/src/tests/trace/codexExport.test.ts` (add)

- [ ] **Step 1: Create fixtures**

`sample-codex.jsonl` — a hand-authored native rollout: a `session_meta`, a `turn_context` (model `gpt-5.5`), an `event_msg` `user_message`, an assistant `output_text`, an `exec_command` + output, an `apply_patch`-via-exec + output, a `spawn_agent` (call_id `c_spawn`) + `{agent_id, nickname}` output, a `token_count`, and a `task_complete`. (You can serialize the `ROLLOUT` array from Task 1's test to a file, then extend it.)

`sample-codex-subagent.jsonl` — a child rollout: a `session_meta` with `thread_source:"subagent"` + `forked_from_id`, a `turn_context`, an `event_msg` `user_message` (the spawn task), an assistant `output_text`, and one `exec_command` + output.

- [ ] **Step 2: Write the failing test**

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CODEX = readFileSync(join(__dirname, "../fixtures/sample-codex.jsonl"), "utf-8");
const CHILD = readFileSync(join(__dirname, "../fixtures/sample-codex-subagent.jsonl"), "utf-8");

describe("real Codex fixtures", () => {
  it("renders the main rollout with tool cards and tokens", () => {
    const s = buildSessionFromRaw(CODEX);
    expect(s.meta.sourceFormat).toBe("codex");
    expect(s.meta.toolCallCount).toBeGreaterThan(0);
    expect(s.meta.firstPrompt).toBeTruthy();
  });

  it("renders a Codex subagent child (the AgentBody/Outcome re-parse path)", () => {
    const child = buildSessionFromRaw(CHILD);
    expect(child.meta.sourceFormat).toBe("codex");
    expect(child.stream.length).toBeGreaterThan(0);
    expect(child.stream.some((e) => e.kind === "assistant_text" || e.kind === "tool_use")).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify it fails, then passes**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test -- codexExport`
Expected: FAIL if the fixtures are missing/malformed; once the fixtures parse, PASS. No new implementation — this exercises Tasks 1-5. The second test is the regression guard for the §6.1 fix: a Codex child only renders non-empty because `buildSessionFromRaw` (not raw `buildSession`) is used at the subagent parse sites.

- [ ] **Step 4: Run the full suite**

Run: `cd /Users/bhavya/git/vibeshub/webapp/frontend && npm test`
Expected: PASS (entire suite).

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/tests/fixtures/sample-codex.jsonl webapp/frontend/src/tests/fixtures/sample-codex-subagent.jsonl webapp/frontend/src/tests/trace/codexExport.test.ts
git commit -m "frontend: real Codex fixtures + subagent re-parse regression test"
```

---

## Self-Review (completed during authoring)

- **Spec coverage (§6):** `codexExport.ts` (§6.1) → Task 1; record mapping table (§6.2) → Task 1; reasoning (§6.3) → Task 1 (encrypted skipped, summary/content emitted as thinking); native cards (§6.4) → Task 4; branding (§6.5) → Task 5; `sourceFormat`/types (§6.6) → Task 2; subagent touches (§6.7): `spawn_agent` routing → Task 4, field normalization in converter → Task 1 (`mapToolCall`), guardian skip → Task 5, the three parse sites → Task 3, `deriveFiles` apply_patch → Task 5. The §6.1 regression is guarded in Task 6.
- **Placeholders:** none — full converter code in Task 1, exact edits elsewhere, every step has the `npm test` command.
- **Type consistency:** `looksLikeCodex(string): boolean`, `codexToJsonl(string): string`, `buildSessionFromRaw(string): Session` used consistently; `sourceFormat` widened in Task 2 before any test asserts `"codex"`; `AssistantText` gains optional `avatar`/`agent` props (default-compatible with all existing call sites).
- **Note on the web path:** unlike terminal `.txt` (converted at upload), a Codex `.jsonl` dragged into `/vibeviewer` is uploaded raw and converted at render via `buildSessionFromRaw`, preserving the reparse-without-reupload invariant (spec §11). No `VibeViewer.tsx` conversion branch is needed; the backend stores the raw bytes and `TraceView` converts on open.
