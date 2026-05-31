import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { looksLikeCodex, codexToJsonl } from "../../components/trace/codexExport";
import { buildSession, parseJsonl } from "../../components/trace/parser";
import { buildSessionFromRaw } from "../../components/trace/sessionFromRaw";
import { toolCat, toolLabel } from "../../components/trace/tools";

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
      name: string; input: Record<string, unknown>; result: unknown; id: string;
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

describe("Codex tool registry", () => {
  it("categorizes and labels Codex tools", () => {
    expect(toolCat("shell")).toBe("bash");
    expect(toolCat("apply_patch")).toBe("write");
    expect(toolCat("update_plan")).toBe("task");
    expect(toolCat("spawn_agent")).toBe("agent");
    expect(toolLabel("shell")).toBe("Shell");
  });
});

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
