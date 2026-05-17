import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildSession, parseJsonl } from "../../components/trace/parser";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(
  join(__dirname, "../fixtures/sample-session.jsonl"),
  "utf-8",
);

describe("parseJsonl", () => {
  it("splits on newlines and JSON.parses each line", () => {
    const records = parseJsonl('{"a":1}\n{"b":2}\n');
    expect(records).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("swallows blank and unparseable lines", () => {
    const records = parseJsonl("\n{not json}\n{\"x\":42}\n\n");
    expect(records).toEqual([{ x: 42 }]);
  });

  it("returns hundreds of records from the sample fixture", () => {
    const records = parseJsonl(FIXTURE);
    expect(records.length).toBeGreaterThan(100);
  });
});

describe("buildSession", () => {
  const records = parseJsonl(FIXTURE);
  const session = buildSession(records);

  it("collects session meta", () => {
    const { meta } = session;
    expect(meta.sessionId).toBeTruthy();
    expect(meta.aiTitle).toBeTruthy();
    expect(meta.model).toBeTruthy();
    expect(meta.cwd).toBeTruthy();
    expect(meta.gitBranch).toBeTruthy();
    expect(meta.startedAt).toBeTruthy();
    expect(meta.endedAt).toBeTruthy();
    expect(Date.parse(meta.endedAt!)).toBeGreaterThanOrEqual(
      Date.parse(meta.startedAt!),
    );
    expect(meta.firstPrompt).toBeTruthy();
  });

  it("extracts the PR link if present in the trace", () => {
    expect(session.meta.prLink).not.toBeNull();
    expect(session.meta.prLink!.url).toMatch(/^https:\/\/github\.com\//);
    expect(session.meta.prLink!.number).toBeGreaterThan(0);
  });

  it("totals token usage across assistant messages", () => {
    const { tokens } = session.meta;
    expect(tokens.input).toBeGreaterThanOrEqual(0);
    expect(tokens.cacheCreate).toBeGreaterThanOrEqual(0);
    expect(tokens.cacheRead).toBeGreaterThanOrEqual(0);
    expect(tokens.output).toBeGreaterThan(0);
  });

  it("aggregates tool counts and per-kind counts", () => {
    const { meta } = session;
    expect(meta.toolCallCount).toBeGreaterThan(0);
    const sumOfCounts = Object.values(meta.toolCounts).reduce(
      (a, b) => a + b,
      0,
    );
    expect(sumOfCounts).toBe(meta.toolCallCount);
    expect(meta.userPromptCount).toBeGreaterThan(0);
    expect(meta.assistantTextCount).toBeGreaterThan(0);
  });

  it("emits user prompts in the same order they appear in the JSONL", () => {
    const promptsFromStream = session.stream
      .filter((e) => e.kind === "user_prompt")
      .map((e) => (e as { text: string }).text);
    const promptsFromRecords: string[] = [];
    for (const r of records as Array<Record<string, unknown>>) {
      if (
        r.type === "user" &&
        r.message &&
        typeof (r.message as { content: unknown }).content === "string"
      ) {
        promptsFromRecords.push(
          (r.message as { content: string }).content,
        );
      }
    }
    expect(promptsFromStream).toEqual(promptsFromRecords);
  });

  it("dedupes assistant content blocks across repeated lines", () => {
    const seen = new Set<string>();
    for (const e of session.stream) {
      if (
        e.kind === "assistant_text" ||
        e.kind === "thinking" ||
        e.kind === "tool_use"
      ) {
        const key = `${e.msgId}|${e.uuid}|${e.kind}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it("attaches tool_result content to tool_use events", () => {
    const toolUses = session.stream.filter((e) => e.kind === "tool_use");
    expect(toolUses.length).toBeGreaterThan(0);
    const withResult = toolUses.filter(
      (e) => e.kind === "tool_use" && e.result != null,
    );
    expect(withResult.length).toBeGreaterThan(0);
  });

  it("includes a pr_link event in the stream when the trace has one", () => {
    const prLink = session.stream.find((e) => e.kind === "pr_link");
    expect(prLink).toBeDefined();
  });
});
