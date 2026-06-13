import { beforeEach, describe, expect, it } from "vitest";
import {
  buildProvenance,
  orderRegions,
  regionPos,
} from "../../components/trace/provenance";
import type { BlameHunk } from "../../components/trace/provenance";
import type { DiffRow } from "../../components/trace/diff";
import type { SubagentEntry } from "../../components/trace/changes";
import type {
  Session,
  SessionMeta,
  StreamEvent,
  ToolResult,
} from "../../components/trace/types";
import type { AgentSummary } from "../../types";

// Monotonic fixture clock: ISO timestamps compare lexicographically, which is
// all the provenance ordering relies on.
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

function assistant(uuid: string, text: string): StreamEvent {
  return { kind: "assistant_text", text, ts: ts(), msgId: "m1", uuid };
}

function thinking(uuid: string, text: string): StreamEvent {
  return { kind: "thinking", text, ts: ts(), msgId: "m1", uuid };
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

function bash(uuid: string, command: string, result: ToolResult | null = null) {
  return tool("Bash", uuid, { command }, result);
}

function okRun(stdout: string): ToolResult {
  return { content: stdout, toolUseResult: { stdout } };
}

function failRun(stdout: string): ToolResult {
  return { content: stdout, isError: true, toolUseResult: { stdout } };
}

function agent(over: Partial<AgentSummary> = {}): AgentSummary {
  return {
    agent_id: "a1",
    tool_use_id: null,
    agent_type: "Explore",
    description: "scout the changes view",
    message_count: 1,
    ...over,
  };
}

function makeMeta(over: Partial<SessionMeta> = {}): SessionMeta {
  return {
    sessionId: "s1",
    aiTitle: null,
    firstPrompt: null,
    cwd: "/r",
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
  };
}

function makeSession(
  stream: StreamEvent[],
  meta: Partial<SessionMeta> = {},
): Session {
  return { meta: makeMeta(meta), stream };
}

function build(
  stream: StreamEvent[],
  subagents: SubagentEntry[] = [],
  meta: Partial<SessionMeta> = {},
) {
  return buildProvenance(makeSession(stream, meta), subagents, "claude-code");
}

describe("buildProvenance basics", () => {
  it("returns an empty model for a session with no edits", () => {
    const m = build([prompt("p1", "hello"), bash("b1", "ls")]);
    expect(m.files).toEqual([]);
    expect(m.stats.editOps).toBe(0);
    expect(m.stats.bash).toBe(1);
    expect(m.prompts).toHaveLength(1);
    expect(m.prompts[0].note).toBe("wrote no code");
  });

  it("attributes hunks to the prompt active at the edit", () => {
    const m = build([
      prompt("p1", "Fix the bug"),
      tool("Edit", "t1", { file_path: "/r/a.ts", old_string: "x", new_string: "y" }),
      prompt("p2", "Now add tests"),
      tool("Edit", "t2", { file_path: "/r/a.ts", old_string: "q", new_string: "r" }),
    ]);
    expect(m.files).toHaveLength(1);
    const f = m.files[0];
    expect(f.hunks.map((h) => h.promptIdx)).toEqual([1, 2]);
    expect(f.hunks[0].promptUuid).toBe("p1");
    expect(f.hunks[0].jumpUuid).toBe("t1");
    expect(m.prompts[0].note).toBe("1 edit op · +1 lines");
  });

  it("gives prompt ordinal 0 to edits before the first prompt", () => {
    const m = build([
      tool("Write", "t1", { file_path: "/r/a.ts", content: "hello" }),
    ]);
    expect(m.files[0].hunks[0].promptIdx).toBe(0);
    expect(m.files[0].hunks[0].promptUuid).toBeNull();
  });

  it("classifies an unread Write as new and a read path as mod", () => {
    const m = build([
      tool("Write", "t1", { file_path: "/r/new.ts", content: "x" }),
      tool("Read", "t2", { file_path: "/r/old.ts" }),
      tool("Write", "t3", { file_path: "/r/old.ts", content: "x" }),
    ]);
    expect(m.files.find((f) => f.path === "/r/new.ts")!.status).toBe("new");
    expect(m.files.find((f) => f.path === "/r/old.ts")!.status).toBe("mod");
  });

  it("orders files by first touch, tolerating missing timestamps", () => {
    const noTs: StreamEvent = {
      kind: "tool_use",
      name: "Edit",
      input: { file_path: "/r/m.ts", old_string: "a", new_string: "b" },
      id: "id-t2",
      ts: "",
      msgId: "m1",
      uuid: "t2",
      result: null,
    };
    const m = build([
      tool("Edit", "t1", { file_path: "/r/z.ts", old_string: "a", new_string: "b" }),
      noTs,
    ]);
    expect(m.files.map((f) => f.path)).toEqual(["/r/z.ts", "/r/m.ts"]);
  });

  it("uses the command name and args for slash-command prompts", () => {
    const m = build([slashPrompt("p1", "/simplify", "src")]);
    expect(m.prompts[0].text).toBe("/simplify src");
  });

  it("yields one hunk per sub-edit for MultiEdit without a patch", () => {
    const m = build([
      tool("MultiEdit", "t1", {
        file_path: "/r/a.ts",
        edits: [
          { old_string: "one", new_string: "ONE" },
          { old_string: "two", new_string: "TWO" },
        ],
      }),
    ]);
    expect(m.files[0].hunks).toHaveLength(2);
    expect(m.stats.editOps).toBe(2);
  });
});

describe("supersede and stats", () => {
  it("marks a hunk superseded when a later old_string consumes its output", () => {
    const m = build([
      prompt("p1", "first try"),
      tool("Edit", "t1", { file_path: "/r/a.ts", old_string: "base", new_string: "alpha" }),
      prompt("p2", "rewrite it"),
      tool("Edit", "t2", {
        file_path: "/r/a.ts",
        old_string: "alpha plus context",
        new_string: "beta",
      }),
    ]);
    const f = m.files[0];
    expect(f.hunks[0].superseded).toEqual({ turnLabel: "turn 2" });
    expect(f.hunks[1].superseded).toBeNull();
    // File stats count surviving hunks only.
    expect(f.adds).toBe(1);
    expect(f.dels).toBe(1);
  });

  it("does not let a failed Write supersede earlier work", () => {
    const m = build([
      tool("Edit", "t1", { file_path: "/r/a.ts", old_string: "a", new_string: "b" }),
      tool(
        "Write",
        "t2",
        { file_path: "/r/a.ts", content: "fresh" },
        { content: "File has not been read yet.", isError: true },
      ),
    ]);
    const f = m.files[0];
    expect(f.hunks).toHaveLength(1);
    expect(f.hunks[0].superseded).toBeNull();
  });

  it("skips files where every op failed", () => {
    const m = build([
      tool(
        "Write",
        "t1",
        { file_path: "/r/a.ts", content: "x" },
        { content: "nope", isError: true },
      ),
    ]);
    expect(m.files).toEqual([]);
    expect(m.stats.editOps).toBe(1); // still counted as an attempted op
  });
});

describe("failed attempts", () => {
  it("folds a failed write into the retry's attempt chain", () => {
    const m = build([
      prompt("p1", "write the module"),
      tool(
        "Write",
        "t1",
        { file_path: "/r/a.ts", content: "v1" },
        { content: "File has not been read yet. Read it first.", isError: true },
      ),
      tool("Read", "t2", { file_path: "/r/a.ts" }),
      tool("Write", "t3", { file_path: "/r/a.ts", content: "v1" }),
    ]);
    const h = m.files[0].hunks[0];
    expect(h.attemptCount).toBe(2);
    expect(h.attempts).toHaveLength(2);
    expect(h.attempts[0].ok).toBe(false);
    expect(h.attempts[0].label).toContain("File has not been read yet");
    expect(h.attempts[1].ok).toBe(true);
    expect(h.startTs < h.ts).toBe(true);
  });
});

describe("verification runs", () => {
  it("attaches the next test runs after an edit", () => {
    const m = build([
      tool("Edit", "t1", { file_path: "/r/a.ts", old_string: "x", new_string: "y" }),
      bash("b1", "npx vitest run src/tests", okRun("Tests 26 passed (26)")),
      bash("b2", "npm run build", okRun("built in 2.1s")),
      bash("b3", "ls"),
    ]);
    const v = m.files[0].hunks[0].verifications;
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ status: "pass", label: "vitest · 26 passed" });
    expect(v[1]).toMatchObject({ status: "pass", label: "npm run build · ok" });
  });

  it("marks failing runs and reports a none chip when nothing ran", () => {
    const m = build([
      tool("Edit", "t1", { file_path: "/r/a.ts", old_string: "x", new_string: "y" }),
      bash("b1", "npx vitest run", failRun("1 failed | 8 passed")),
      tool("Edit", "t2", { file_path: "/r/b.ts", old_string: "x", new_string: "y" }),
    ]);
    expect(m.files[0].hunks[0].verifications[0]).toMatchObject({
      status: "fail",
      label: "vitest · 1 failed",
    });
    expect(m.files[1].hunks[0].verifications).toEqual([
      {
        status: "none",
        ts: "",
        label: "no test or build run after this change",
      },
    ]);
  });

  it("summarizes the last test run in stats.tests", () => {
    const m = build([
      bash("b1", "npx vitest run", okRun("12 passed")),
      bash("b2", "npm test", okRun("298 passed")),
    ]);
    expect(m.stats.tests).toBe("298 ✓");
  });
});

describe("rewrite heat", () => {
  it("counts how many ops emitted the same line", () => {
    const shared = "const sharedLine = compute();";
    const m = build([
      tool("Write", "t1", { file_path: "/r/a.ts", content: `${shared}\nold only line` }),
      tool("Write", "t2", { file_path: "/r/a.ts", content: `${shared}\nbrand new line here` }),
    ]);
    const h = m.files[0].hunks[1]; // surviving rewrite
    const heatByText = new Map(h.rows.map((r, i) => [r.text, h.heat[i]]));
    expect(heatByText.get(shared)).toBe(2);
    expect(heatByText.get("brand new line here")).toBe(1);
  });

  it("never heats short structural lines", () => {
    const m = build([
      tool("Write", "t1", { file_path: "/r/a.ts", content: "}" }),
      tool("Write", "t2", { file_path: "/r/a.ts", content: "}" }),
    ]);
    expect(m.files[0].hunks[1].heat).toEqual([1]);
  });
});

describe("ephemeral files", () => {
  it("flags a file removed by a later shell command", () => {
    const m = build([
      tool("Write", "t1", { file_path: "/r/e2e/tmp.spec.ts", content: "x" }),
      bash("b1", "rm e2e/tmp.spec.ts && rm -rf test-results"),
    ]);
    expect(m.files[0].status).toBe("ephemeral");
  });

  it("ignores removals that happen before the last edit", () => {
    const m = build([
      bash("b1", "rm /r/a.ts"),
      tool("Write", "t2", { file_path: "/r/a.ts", content: "x" }),
    ]);
    expect(m.files[0].status).toBe("new");
  });
});

describe("subagents", () => {
  it("attributes subagent hunks and splits the attribution bar", () => {
    const stream = [
      prompt("p1", "refactor the module"),
      tool("Task", "t-task", { subagent_type: "refactor", prompt: "go" }),
      tool("Edit", "t1", {
        file_path: "/r/main.ts",
        old_string: "a",
        new_string: "b1\nb2\nb3",
      }),
    ];
    const entries: SubagentEntry[] = [
      {
        agent: agent({ tool_use_id: "id-t-task", agent_type: "refactor" }),
        stream: [
          tool("Edit", "s1", { file_path: "/r/c.ts", old_string: "u", new_string: "v" }),
        ],
      },
    ];
    const m = build(stream, entries);
    const sub = m.files.find((f) => f.path === "/r/c.ts")!;
    expect(sub.hunks[0].agentType).toBe("refactor");
    expect(sub.hunks[0].promptIdx).toBe(1);
    const ai = m.attribution.slices.find((s) => s.key === "ai")!;
    const ag = m.attribution.slices.find((s) => s.key === "agent")!;
    expect(ai.lines).toBe(3);
    expect(ag).toMatchObject({ label: "refactor subagent", lines: 1, pct: 25 });
    expect(m.attribution.slices.find((s) => s.key === "human")!.lines).toBe(0);
  });

  it("links read-only research subagents to later hunks from the same prompt", () => {
    const stream = [
      prompt("p1", "rethink the diff view"),
      tool("Task", "t-task", { subagent_type: "Explore", prompt: "scout" }),
      tool("Write", "t1", { file_path: "/r/new.ts", content: "x" }),
    ];
    const entries: SubagentEntry[] = [
      {
        agent: agent({ tool_use_id: "id-t-task", agent_type: "Explore" }),
        stream: [
          tool("Read", "s1", { file_path: "/r/a.ts" }),
          tool("Read", "s2", { file_path: "/r/b.ts" }),
        ],
      },
    ];
    const m = build(stream, entries);
    const h = m.files[0].hunks[0];
    expect(h.research).toEqual({
      agentType: "Explore",
      description: "scout the changes view",
      reads: 2,
      editOps: 0,
    });
    expect(m.attribution.notes[0]).toBe(
      "The Explore subagent made 2 reads but wrote 0 lines.",
    );
    // Research-only agents still get a zero-line legend slice.
    expect(
      m.attribution.slices.find((s) => s.label === "Explore subagent"),
    ).toMatchObject({ lines: 0 });
  });
});

describe("reasoning context", () => {
  it("uses the nearest assistant text before the edit, same turn only", () => {
    const m = build([
      prompt("p1", "go"),
      assistant("a1", "The rail never scrolls because anchors are missing."),
      tool("Edit", "t1", { file_path: "/r/a.ts", old_string: "x", new_string: "y" }),
      prompt("p2", "next"),
      tool("Edit", "t2", { file_path: "/r/a.ts", old_string: "q", new_string: "r" }),
    ]);
    expect(m.files[0].hunks[0].reasoning?.text).toBe(
      "The rail never scrolls because anchors are missing.",
    );
    expect(m.files[0].hunks[1].reasoning).toBeNull();
  });

  it("falls back to thinking when no assistant text precedes the edit", () => {
    const m = build([
      prompt("p1", "go"),
      thinking("th1", "I should check the anchor ids first."),
      tool("Edit", "t1", { file_path: "/r/a.ts", old_string: "x", new_string: "y" }),
    ]);
    expect(m.files[0].hunks[0].reasoning?.text).toBe(
      "I should check the anchor ids first.",
    );
  });
});

describe("outcome", () => {
  it("collects test, commit, PR and merge events in time order", () => {
    const m = build(
      [
        tool("Edit", "t1", { file_path: "/r/a.ts", old_string: "x", new_string: "y" }),
        bash("b1", "npm test", okRun("298 passed")),
        bash("b2", 'git commit -m "Changes view: chapter-grouped diff"'),
        // the PR opens here, at 10:00:04, before the merge command at 10:00:05
        bash("b-spacer", "ls"),
        bash("b3", "gh pr merge 129 --squash"),
      ],
      [],
      {
        gitBranch: "feature-x",
        prLink: {
          number: 129,
          url: "https://github.com/o/r/pull/129",
          repo: "o/r",
          at: "2026-06-11T10:00:04Z",
        },
      },
    );
    expect(m.outcome.map((o) => o.label)).toEqual([
      "Final test run",
      "Commit",
      "PR #129 opened",
      "Merged",
    ]);
    expect(m.outcome[1].detail).toBe(
      '"Changes view: chapter-grouped diff" on feature-x',
    );
  });
});

describe("stats", () => {
  it("counts reads, bash and thinking across main and subagent streams", () => {
    const stream = [
      prompt("p1", "go"),
      thinking("th1", "hmm"),
      tool("Read", "r1", { file_path: "/r/a.ts" }),
      tool("Task", "t-task", { subagent_type: "Explore", prompt: "scout" }),
      bash("b1", "ls"),
    ];
    const entries: SubagentEntry[] = [
      {
        agent: agent({ tool_use_id: "id-t-task" }),
        stream: [
          tool("Read", "s1", { file_path: "/r/b.ts" }),
          bash("sb1", "grep -r foo"),
          thinking("sth1", "scanning"),
        ],
      },
    ];
    const m = build(stream, entries);
    expect(m.stats).toMatchObject({
      prompts: 1,
      reads: 2,
      bash: 2,
      thinking: 2,
      subagents: 1,
      files: 0,
      tests: null,
    });
  });
});

function hunkRow(start: number, lines: number): DiffRow {
  return {
    kind: "hunk",
    oldNo: null,
    newNo: null,
    text: `@@ -${start},${lines} +${start},${lines} @@`,
  };
}
function reg(id: string, rows: DiffRow[]): BlameHunk {
  return { id, rows } as unknown as BlameHunk;
}

describe("region ordering", () => {
  it("parses a file-absolute span from the @@ header, null when patch-less", () => {
    expect(regionPos([hunkRow(113, 7)])).toEqual({ start: 113, end: 120 });
    expect(
      regionPos([{ kind: "add", oldNo: null, newNo: 1, text: "x" }]),
    ).toBeNull();
  });

  it("sorts positioned non-overlapping regions by file position", () => {
    const out = orderRegions([
      reg("a", [hunkRow(200, 4)]),
      reg("b", [hunkRow(40, 3)]),
      reg("c", [hunkRow(113, 2)]),
    ]);
    expect(out.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("keeps edit order when any region is patch-less", () => {
    const out = orderRegions([
      reg("a", [hunkRow(200, 4)]),
      reg("b", [{ kind: "add", oldNo: null, newNo: 1, text: "whole file" }]),
    ]);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("keeps edit order when positioned regions overlap", () => {
    const out = orderRegions([
      reg("a", [hunkRow(100, 10)]),
      reg("b", [hunkRow(105, 3)]),
    ]);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("parses the single-count @@ form, defaulting length to 1", () => {
    expect(
      regionPos([{ kind: "hunk", oldNo: null, newNo: null, text: "@@ -5 +7 @@" }]),
    ).toEqual({ start: 7, end: 8 });
  });

  it("treats adjacent non-overlapping regions as orderable (half-open interval)", () => {
    const out = orderRegions([
      reg("b", [hunkRow(110, 3)]), // 110..113
      reg("a", [hunkRow(100, 10)]), // 100..110, ends exactly where b starts
    ]);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("retried flag", () => {
  it("flags a region whose op had failed attempts", () => {
    const m = build([
      tool(
        "Write",
        "t1",
        { file_path: "/r/a.ts", content: "v1" },
        { content: "File has not been read yet.", isError: true },
      ),
      tool("Read", "t2", { file_path: "/r/a.ts" }),
      tool("Write", "t3", { file_path: "/r/a.ts", content: "v1" }),
    ]);
    expect(m.files[0].hunks[0].retried).toBe(true);
  });

  it("leaves a clean edit unretried", () => {
    const m = build([
      tool("Edit", "t1", { file_path: "/r/a.ts", old_string: "x", new_string: "y" }),
    ]);
    expect(m.files[0].hunks[0].retried).toBe(false);
  });
});
