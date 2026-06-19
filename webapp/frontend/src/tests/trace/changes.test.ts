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
