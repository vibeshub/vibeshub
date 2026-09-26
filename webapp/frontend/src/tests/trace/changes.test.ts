import { describe, expect, it } from "vitest";
import { collectOps } from "../../components/trace/changes";
import type { StreamEvent, ToolResult } from "../../components/trace/types";

function editEvent(result: ToolResult | null): StreamEvent {
  return {
    kind: "tool_use",
    name: "Edit",
    input: { file_path: "/r/a.ts", old_string: "x", new_string: "y" },
    id: "id1",
    ts: "2026-06-19T10:00:00Z",
    msgId: "m1",
    uuid: "t1",
    result,
  };
}

describe("collectOps captures file content for the net diff", () => {
  it("reads originalFile and content from toolUseResult", () => {
    const { ops } = collectOps(
      [
        editEvent({
          content: "ok",
          toolUseResult: { originalFile: "before", content: "after" },
        }),
      ],
      [],
    );
    expect(ops).toHaveLength(1);
    expect(ops[0].originalFile).toBe("before");
    expect(ops[0].finalContent).toBe("after");
  });

  it("leaves them null when toolUseResult is absent", () => {
    const { ops } = collectOps([editEvent(null)], []);
    expect(ops[0].originalFile).toBeNull();
    expect(ops[0].finalContent).toBeNull();
  });
});

describe("collectOps attributes subagent edits to the dispatching tool", () => {
  function promptEvent(uuid: string): StreamEvent {
    return { kind: "user_prompt", text: "do it", ts: "2026-06-19T10:00:00Z", uuid };
  }
  function dispatch(name: string): StreamEvent {
    return {
      kind: "tool_use",
      name,
      input: { subagent_type: "refactor", prompt: "go" },
      id: "toolu_dispatch",
      ts: "2026-06-19T10:00:01Z",
      msgId: "m1",
      uuid: "u-dispatch",
      result: null,
    };
  }
  const subEdit: StreamEvent = {
    kind: "tool_use",
    name: "Edit",
    input: { file_path: "/r/sub.ts", old_string: "x", new_string: "y" },
    id: "toolu_sub",
    ts: "2026-06-19T10:00:02Z",
    msgId: "m2",
    uuid: "u-sub",
    result: null,
  };

  it.each(["Agent", "Task", "Subagent", "spawn_agent"])(
    "links a %s dispatch to the prompt that was active",
    (name) => {
      const { ops } = collectOps(
        [promptEvent("p1"), dispatch(name)],
        [
          {
            agent: {
              agent_id: "a1",
              tool_use_id: "toolu_dispatch",
              agent_type: "refactor",
              description: "",
              message_count: 1,
            },
            stream: [subEdit],
          },
        ],
      );
      expect(ops).toHaveLength(1);
      expect(ops[0].prompt.ordinal).toBe(1);
      expect(ops[0].jumpUuid).toBe("u-dispatch");
    },
  );
});
