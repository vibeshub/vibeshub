import { describe, expect, it } from "vitest";
import { looksLikeCursor, cursorToJsonl } from "../../components/trace/cursorExport";
import { buildSession, parseJsonl } from "../../components/trace/parser";
import { buildSessionFromRaw } from "../../components/trace/sessionFromRaw";
import { toolCat, toolLabel } from "../../components/trace/tools";

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
  const jsonl = cursorToJsonl(CURSOR);
  const session = buildSession(parseJsonl(jsonl));

  it("marks the source as cursor", () => {
    expect(session.meta.sourceFormat).toBe("cursor");
  });
  it("strips the user_query/timestamp envelope from the first prompt", () => {
    expect(session.meta.firstPrompt).toBe("help me debug");
  });
  it("parses the coarse user-turn timestamp onto the user record", () => {
    // 7:30 PM UTC-7 == 02:30Z the next day.
    const userRec = jsonl.trim().split("\n").map((l) => JSON.parse(l)).find((r) => r.type === "user");
    expect(userRec.timestamp).toBe("2026-06-04T02:30:00.000Z");
  });
  it("splits assistant blocks into separate stream events with native tool cards", () => {
    const names = session.stream
      .filter((e) => e.kind === "tool_use")
      .map((e) => (e as { name: string }).name);
    expect(names).toContain("Read");
    expect(names).toContain("Shell");
    expect(names).toContain("Subagent");
    expect(
      session.stream.some((e) => e.kind === "assistant_text" && (e as { text: string }).text === "Looking now."),
    ).toBe(true);
  });
  it("assigns a deterministic cursor-agent-N id to the Subagent call", () => {
    const ids = session.stream
      .filter((e) => e.kind === "tool_use" &&
        ((e as { name: string }).name === "Subagent" || (e as { name: string }).name === "Task"))
      .map((e) => (e as { id: string }).id);
    expect(ids).toEqual(["cursor-agent-0"]);
  });
});

describe("cursor-meta parser branch", () => {
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
});

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
