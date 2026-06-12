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
