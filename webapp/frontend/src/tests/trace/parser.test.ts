import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildSession,
  parseJsonl,
  progressByTool,
} from "../../components/trace/parser";

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

describe("buildSession with repeated pr-link records", () => {
  // Claude Code can re-emit the same pr-link record (e.g., on session resume),
  // and PrCard renders one card per pr_link event. Dedupe by URL so the trace
  // shows a single "Pull request opened" card per distinct PR.
  const fixture = [
    JSON.stringify({
      type: "pr-link",
      prNumber: 65,
      prUrl: "https://github.com/Bhavya6187/vibeshub/pull/65",
      prRepository: "Bhavya6187/vibeshub",
      timestamp: "2026-05-17T17:40:00.000Z",
      sessionId: "s1",
    }),
    JSON.stringify({
      type: "pr-link",
      prNumber: 65,
      prUrl: "https://github.com/Bhavya6187/vibeshub/pull/65",
      prRepository: "Bhavya6187/vibeshub",
      timestamp: "2026-05-17T17:41:00.000Z",
      sessionId: "s1",
    }),
    JSON.stringify({
      type: "pr-link",
      prNumber: 66,
      prUrl: "https://github.com/Bhavya6187/vibeshub/pull/66",
      prRepository: "Bhavya6187/vibeshub",
      timestamp: "2026-05-17T17:42:00.000Z",
      sessionId: "s1",
    }),
    JSON.stringify({
      type: "pr-link",
      prNumber: 65,
      prUrl: "https://github.com/Bhavya6187/vibeshub/pull/65",
      prRepository: "Bhavya6187/vibeshub",
      timestamp: "2026-05-17T17:43:00.000Z",
      sessionId: "s1",
    }),
  ].join("\n");

  it("emits one pr_link event per distinct PR URL", () => {
    const session = buildSession(parseJsonl(fixture));
    const prLinks = session.stream.filter((e) => e.kind === "pr_link");
    expect(prLinks.length).toBe(2);
    const urls = prLinks.map(
      (e) =>
        (e as { payload: { prUrl: string } }).payload.prUrl,
    );
    expect(urls).toEqual([
      "https://github.com/Bhavya6187/vibeshub/pull/65",
      "https://github.com/Bhavya6187/vibeshub/pull/66",
    ]);
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

describe("buildSession with slash-command user messages", () => {
  const userRec = (content: unknown, uuid: string, ts: string) =>
    JSON.stringify({
      type: "user",
      message: { role: "user", content },
      uuid,
      timestamp: ts,
      sessionId: "s1",
    });
  const assistantRec = (id: string, uuid: string, ts: string) =>
    JSON.stringify({
      type: "assistant",
      message: {
        id,
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "ok" }],
      },
      uuid,
      timestamp: ts,
      sessionId: "s1",
    });

  it("parses a string-content slash command into a structured command", () => {
    const session = buildSession(
      parseJsonl(
        [
          userRec(
            "<command-message>vibeshub:share-pr</command-message>\n<command-name>/vibeshub:share-pr</command-name>",
            "u1",
            "2026-05-21T10:00:00.000Z",
          ),
          assistantRec("msg_1", "a1", "2026-05-21T10:00:10.000Z"),
        ].join("\n"),
      ),
    );
    const prompts = session.stream.filter((e) => e.kind === "user_prompt");
    expect(prompts).toHaveLength(1);
    const p = prompts[0] as { text: string; command?: { name: string; args: string } };
    expect(p.command).toEqual({ name: "/vibeshub:share-pr", args: "" });
    expect(p.text).toBe("");
  });

  it("extracts command args regardless of tag order and indentation", () => {
    const session = buildSession(
      parseJsonl(
        [
          userRec(
            "<command-name>/plugin</command-name>\n            <command-message>plugin</command-message>\n            <command-args>install vibeshub@vibeshub</command-args>",
            "u1",
            "2026-05-21T10:00:00.000Z",
          ),
          assistantRec("msg_1", "a1", "2026-05-21T10:00:10.000Z"),
        ].join("\n"),
      ),
    );
    const p = session.stream.find((e) => e.kind === "user_prompt") as {
      command?: { name: string; args: string };
    };
    expect(p.command).toEqual({ name: "/plugin", args: "install vibeshub@vibeshub" });
  });

  it("uses the formatted slash command as firstPrompt", () => {
    const session = buildSession(
      parseJsonl(
        [
          userRec(
            "<command-name>/plugin</command-name>\n<command-args>marketplace update vibeshub</command-args>",
            "u1",
            "2026-05-21T10:00:00.000Z",
          ),
          assistantRec("msg_1", "a1", "2026-05-21T10:00:10.000Z"),
        ].join("\n"),
      ),
    );
    expect(session.meta.firstPrompt).toBe("/plugin marketplace update vibeshub");
  });

  it("attaches local-command-stdout to the preceding slash command", () => {
    const session = buildSession(
      parseJsonl(
        [
          userRec(
            "<command-name>/reload-plugins</command-name>",
            "u1",
            "2026-05-21T10:00:00.000Z",
          ),
          userRec(
            "<local-command-stdout>Reloaded: 5 plugins · 2 skills</local-command-stdout>",
            "u2",
            "2026-05-21T10:00:01.000Z",
          ),
          assistantRec("msg_1", "a1", "2026-05-21T10:00:10.000Z"),
        ].join("\n"),
      ),
    );
    const prompts = session.stream.filter((e) => e.kind === "user_prompt");
    expect(prompts).toHaveLength(1);
    const p = prompts[0] as { command?: { output?: string } };
    expect(p.command?.output).toBe("Reloaded: 5 plugins · 2 skills");
    expect(session.meta.userPromptCount).toBe(1);
  });

  it("treats the '(no content)' stdout placeholder as empty output", () => {
    const session = buildSession(
      parseJsonl(
        [
          userRec("<command-name>/plugin</command-name>", "u1", "2026-05-21T10:00:00.000Z"),
          userRec(
            "<local-command-stdout>(no content)</local-command-stdout>",
            "u2",
            "2026-05-21T10:00:01.000Z",
          ),
          assistantRec("msg_1", "a1", "2026-05-21T10:00:10.000Z"),
        ].join("\n"),
      ),
    );
    const prompts = session.stream.filter((e) => e.kind === "user_prompt");
    expect(prompts).toHaveLength(1);
    expect((prompts[0] as { command?: { output?: string } }).command?.output).toBe("");
  });

  it("strips ANSI escapes from command output", () => {
    const session = buildSession(
      parseJsonl(
        [
          userRec("<command-name>/model</command-name>", "u1", "2026-05-21T10:00:00.000Z"),
          userRec(
            "<local-command-stdout>Set model to [1mOpus 4.7[22m</local-command-stdout>",
            "u2",
            "2026-05-21T10:00:01.000Z",
          ),
          assistantRec("msg_1", "a1", "2026-05-21T10:00:10.000Z"),
        ].join("\n"),
      ),
    );
    const p = session.stream.find((e) => e.kind === "user_prompt") as {
      command?: { output?: string };
    };
    expect(p.command?.output).toBe("Set model to Opus 4.7");
  });

  it("keeps orphan command output out of the prompt stream", () => {
    const session = buildSession(
      parseJsonl(
        [
          userRec(
            "<local-command-stdout>stray output</local-command-stdout>",
            "u1",
            "2026-05-21T10:00:00.000Z",
          ),
          assistantRec("msg_1", "a1", "2026-05-21T10:00:10.000Z"),
        ].join("\n"),
      ),
    );
    expect(session.stream.filter((e) => e.kind === "user_prompt")).toHaveLength(0);
    expect(session.stream.filter((e) => e.kind === "system_text")).toHaveLength(1);
  });

  it("treats prose that merely mentions command tags as a normal prompt", () => {
    const text =
      "Why does <command-name>/foo</command-name> render as raw XML?";
    const session = buildSession(
      parseJsonl(
        [
          userRec(text, "u1", "2026-05-21T10:00:00.000Z"),
          assistantRec("msg_1", "a1", "2026-05-21T10:00:10.000Z"),
        ].join("\n"),
      ),
    );
    const p = session.stream.find((e) => e.kind === "user_prompt") as {
      text: string;
      command?: unknown;
    };
    expect(p.command).toBeUndefined();
    expect(p.text).toBe(text);
  });
});

describe("parser - progress records", () => {
  it("emits a progress stream event for sidechain hook_progress records", () => {
    const jsonl = [
      JSON.stringify({
        type: "progress",
        data: {
          type: "hook_progress",
          hookEvent: "PostToolUse",
          hookName: "PostToolUse:Glob",
          command: "callback",
        },
        parentToolUseID: "toolu_01abc",
        toolUseID: "toolu_01abc",
        timestamp: "2026-05-19T10:00:00Z",
        uuid: "p1",
        isSidechain: true,
        sessionId: "s",
      }),
    ].join("\n");

    const session = buildSession(parseJsonl(jsonl));
    const progress = session.stream.find((e) => e.kind === "progress");
    expect(progress).toBeDefined();
    if (progress?.kind === "progress") {
      expect(progress.hookEvent).toBe("PostToolUse");
      expect(progress.hookName).toBe("PostToolUse:Glob");
      expect(progress.parentToolUseID).toBe("toolu_01abc");
    }
  });
});

describe("progressByTool", () => {
  it("groups progress events by their parent tool_use id", () => {
    const session = buildSession(
      parseJsonl(
        [
          { type: "progress", data: { hookName: "h1" }, parentToolUseID: "t1", uuid: "p1", timestamp: "2026-05-19T10:00:00Z" },
          { type: "progress", data: { hookName: "h2" }, parentToolUseID: "t1", uuid: "p2", timestamp: "2026-05-19T10:00:01Z" },
          { type: "progress", data: { hookName: "h3" }, parentToolUseID: "t2", uuid: "p3", timestamp: "2026-05-19T10:00:02Z" },
          { type: "progress", data: { hookName: "orphan" }, uuid: "p4", timestamp: "2026-05-19T10:00:03Z" },
        ].map((r) => JSON.stringify(r)).join("\n"),
      ),
    );
    const grouped = progressByTool(session.stream);
    expect(grouped.get("t1")?.length).toBe(2);
    expect(grouped.get("t2")?.length).toBe(1);
    // a progress event with no parentToolUseID is not in the map
    expect([...grouped.keys()].sort()).toEqual(["t1", "t2"]);
  });
});
