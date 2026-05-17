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
    const isWrapped = (s: string) => {
      const t = s.trim();
      const m = t.match(
        /^<([a-zA-Z][a-zA-Z0-9_-]*)>[\s\S]*<\/([a-zA-Z][a-zA-Z0-9_-]*)>$/,
      );
      return m !== null && m[1] === m[2];
    };
    const promptsFromRecords: string[] = [];
    for (const r of records as Array<Record<string, unknown>>) {
      if (!(r.type === "user" && r.message)) continue;
      if (r.isMeta === true) continue;
      const content = (r.message as { content: unknown }).content;
      if (typeof content === "string") {
        promptsFromRecords.push(content);
      } else if (Array.isArray(content)) {
        for (const c of content as Array<Record<string, unknown>>) {
          if (
            c.type === "text" &&
            typeof c.text === "string" &&
            c.text.length > 0 &&
            !isWrapped(c.text)
          ) {
            promptsFromRecords.push(c.text);
          }
        }
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

describe("buildSession with array-content user messages (IDE format)", () => {
  // Newer Claude Code (e.g. claude-vscode) wraps the first user prompt in an
  // array of content items, prepending system wrappers like <ide_opened_file>.
  // The parser must still recognize the user-typed text as a user prompt.
  const fixture = [
    JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "text",
            text: "<ide_opened_file>The user opened the file /foo/App.tsx in the IDE.</ide_opened_file>",
          },
          { type: "text", text: "first user prompt here" },
        ],
      },
      uuid: "u1",
      timestamp: "2026-05-17T03:25:28.648Z",
      sessionId: "s1",
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        id: "msg_1",
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "ok" }],
      },
      uuid: "a1",
      timestamp: "2026-05-17T03:26:00.000Z",
      sessionId: "s1",
    }),
    JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "second prompt" }],
      },
      uuid: "u2",
      timestamp: "2026-05-17T03:30:00.000Z",
      sessionId: "s1",
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        id: "msg_2",
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "done" }],
      },
      uuid: "a2",
      timestamp: "2026-05-17T03:30:30.000Z",
      sessionId: "s1",
    }),
  ].join("\n");

  it("treats user-typed text in array content as a user_prompt", () => {
    const session = buildSession(parseJsonl(fixture));
    expect(session.meta.userPromptCount).toBe(2);
    expect(session.meta.firstPrompt).toBe("first user prompt here");
  });

  it("classifies fully tag-wrapped text as system_text, not user prompt", () => {
    const session = buildSession(parseJsonl(fixture));
    const systemTexts = session.stream.filter((e) => e.kind === "system_text");
    expect(systemTexts.length).toBe(1);
    expect((systemTexts[0] as { text: string }).text).toMatch(
      /^<ide_opened_file>/,
    );
  });

  it("derives assistantThinkMs from timestamps when turn_duration events are absent", () => {
    const session = buildSession(parseJsonl(fixture));
    // turn 1: 03:25:28.648 → 03:26:00.000 ≈ 31.352s
    // turn 2: 03:30:00.000 → 03:30:30.000 = 30s
    // total ≈ 61.352s
    expect(session.meta.assistantThinkMs).toBeGreaterThan(60_000);
    expect(session.meta.assistantThinkMs).toBeLessThan(62_000);
  });
});

describe("buildSession with skill-injected meta records", () => {
  // When the Skill tool is invoked, Claude Code emits a synthetic user record
  // with `isMeta: true` and `sourceToolUseID` pointing at the Skill tool_use.
  // Its content[].text is the skill body the model receives. These records
  // must NOT appear as user prompts in the rendered trace.
  const fixture = [
    JSON.stringify({
      type: "user",
      message: { role: "user", content: "actual user prompt" },
      uuid: "u1",
      timestamp: "2026-05-17T03:25:00.000Z",
      sessionId: "s1",
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        id: "msg_1",
        role: "assistant",
        model: "claude-opus-4-7",
        content: [
          {
            type: "tool_use",
            id: "toolu_skill1",
            name: "Skill",
            input: { skill: "superpowers:using-superpowers" },
          },
        ],
      },
      uuid: "a1",
      timestamp: "2026-05-17T03:25:10.000Z",
      sessionId: "s1",
    }),
    JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_skill1",
            content: "Launching skill: superpowers:using-superpowers",
          },
        ],
      },
      uuid: "u2",
      timestamp: "2026-05-17T03:25:11.000Z",
      sessionId: "s1",
    }),
    JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "text",
            text: "Base directory for this skill: /tmp/foo\n\nSkill body content here.",
          },
        ],
      },
      isMeta: true,
      sourceToolUseID: "toolu_skill1",
      uuid: "u3",
      timestamp: "2026-05-17T03:25:11.500Z",
      sessionId: "s1",
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        id: "msg_2",
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "done" }],
      },
      uuid: "a2",
      timestamp: "2026-05-17T03:25:20.000Z",
      sessionId: "s1",
    }),
  ].join("\n");

  it("does not emit isMeta user records as user_prompt events", () => {
    const session = buildSession(parseJsonl(fixture));
    const prompts = session.stream.filter((e) => e.kind === "user_prompt");
    expect(prompts).toHaveLength(1);
    expect((prompts[0] as { text: string }).text).toBe("actual user prompt");
  });

  it("does not emit isMeta user records as system_text events", () => {
    const session = buildSession(parseJsonl(fixture));
    const sys = session.stream.filter((e) => e.kind === "system_text");
    expect(sys).toHaveLength(0);
  });

  it("does not pick an isMeta record as firstPrompt", () => {
    const session = buildSession(parseJsonl(fixture));
    expect(session.meta.firstPrompt).toBe("actual user prompt");
  });

  it("does not count isMeta records toward userPromptCount", () => {
    const session = buildSession(parseJsonl(fixture));
    expect(session.meta.userPromptCount).toBe(1);
  });

  it("attaches the meta record text to the Skill tool_use as injectedText", () => {
    const session = buildSession(parseJsonl(fixture));
    const skill = session.stream.find(
      (e) => e.kind === "tool_use" && e.name === "Skill",
    );
    expect(skill).toBeDefined();
    const result = (skill as { result: { injectedText?: string } | null })
      .result;
    expect(result?.injectedText).toBe(
      "Base directory for this skill: /tmp/foo\n\nSkill body content here.",
    );
  });
});
