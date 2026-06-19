import { describe, expect, it } from "vitest";
import { buildNetFile } from "../../components/trace/netdiff";
import type { EditOp } from "../../components/trace/changes";

function makeOp(over: Partial<EditOp>): EditOp {
  return {
    path: "/r/a.ts",
    tool: "Edit",
    ts: "",
    seq: 0,
    streamPos: 0,
    jumpUuid: null,
    prompt: { uuid: null, ordinal: 0, excerpt: "", turnLabel: "session start" },
    agentBadge: null,
    isWrite: false,
    failed: false,
    errorText: null,
    rows: [],
    newContents: [],
    oldStrings: [],
    originalFile: null,
    finalContent: null,
    ...over,
  };
}

const kinds = (d: { netRows: { kind: string; text: string }[] }) =>
  d.netRows.map((r) => [r.kind, r.text]);

describe("buildNetFile", () => {
  it("renders a created file as all additions", () => {
    const op = makeOp({
      tool: "Write",
      isWrite: true,
      finalContent: "a\nb",
      newContents: ["a\nb"],
    });
    const net = buildNetFile("/r/a.ts", [op]);
    expect(net.hasNetData).toBe(true);
    expect(net.netAdds).toBe(2);
    expect(net.netDels).toBe(0);
    expect(kinds(net)).toEqual([
      ["add", "a"],
      ["add", "b"],
    ]);
  });

  it("diffs an edited file from its captured original and attributes the add", () => {
    const op = makeOp({
      seq: 7,
      originalFile: "a\nb\nc",
      finalContent: "a\nx\nc",
      newContents: ["x"],
    });
    const net = buildNetFile("/r/a.ts", [op]);
    expect(kinds(net)).toEqual([
      ["ctx", "a"],
      ["del", "b"],
      ["add", "x"],
      ["ctx", "c"],
    ]);
    expect(net.netRows.find((r) => r.kind === "add")!.hunkId).toBe("/r/a.ts#7");
    expect(net.netRows.find((r) => r.kind === "ctx")!.hunkId).toBeNull();
    expect(net.netRows.find((r) => r.kind === "del")!.hunkId).toBeNull();
  });

  it("uses the first original and the last content across edits", () => {
    const op1 = makeOp({ seq: 1, originalFile: "a", finalContent: "a\nb", newContents: ["b"] });
    const op2 = makeOp({ seq: 2, originalFile: "a\nb", finalContent: "a\nB", newContents: ["B"] });
    const net = buildNetFile("/r/a.ts", [op1, op2]);
    expect(kinds(net)).toEqual([
      ["ctx", "a"],
      ["add", "B"],
    ]);
    expect(net.netRows.find((r) => r.kind === "add")!.hunkId).toBe("/r/a.ts#2");
  });

  it("attributes a shared line to the latest op that wrote it", () => {
    const op1 = makeOp({ seq: 1, isWrite: true, tool: "Write", originalFile: "", finalContent: "shared", newContents: ["shared"] });
    const op2 = makeOp({ seq: 2, originalFile: "shared", finalContent: "shared", newContents: ["shared"] });
    const net = buildNetFile("/r/a.ts", [op1, op2]);
    expect(net.netRows.find((r) => r.kind === "add")!.hunkId).toBe("/r/a.ts#2");
  });

  it("reports an edit-then-revert as no net change", () => {
    const op1 = makeOp({ seq: 1, originalFile: "orig", finalContent: "changed", newContents: ["changed"] });
    const op2 = makeOp({ seq: 2, originalFile: "changed", finalContent: "orig", newContents: ["orig"] });
    const net = buildNetFile("/r/a.ts", [op1, op2]);
    expect(net.hasNetData).toBe(true);
    expect(net.netAdds).toBe(0);
    expect(net.netDels).toBe(0);
    expect(net.netRows.map((r) => r.kind)).toEqual(["ctx"]);
  });

  it("renders a deleted file as all deletions", () => {
    const op = makeOp({ seq: 1, originalFile: "a\nb", finalContent: "a\nb", newContents: ["a\nb"] });
    const net = buildNetFile("/r/a.ts", [op], true);
    expect(net.netAdds).toBe(0);
    expect(net.netDels).toBe(2);
    expect(net.netRows.map((r) => r.kind)).toEqual(["del", "del"]);
  });

  it("falls back when an edit lacks a captured original", () => {
    const op = makeOp({ tool: "Edit", isWrite: false, originalFile: null, finalContent: "after" });
    expect(buildNetFile("/r/a.ts", [op]).hasNetData).toBe(false);
  });

  it("falls back when there is no captured final content", () => {
    const op = makeOp({ tool: "Write", isWrite: true, originalFile: null, finalContent: null });
    expect(buildNetFile("/r/a.ts", [op]).hasNetData).toBe(false);
  });
});
