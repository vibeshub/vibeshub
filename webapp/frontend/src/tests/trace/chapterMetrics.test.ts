import { describe, it, expect } from "vitest";
import { chapterMetrics } from "../../components/trace/chapterMetrics";
import type { StreamEvent } from "../../components/trace/types";
import type { DigestChapter } from "../../types";

const up = (uuid: string, ts: string): StreamEvent =>
  ({ kind: "user_prompt", text: "x", ts, uuid }) as StreamEvent;
const tool = (uuid: string, ts: string): StreamEvent =>
  ({
    kind: "tool_use", name: "Bash", input: {}, id: uuid, ts, msgId: "m",
    uuid, result: null,
  }) as StreamEvent;
const at = (uuid: string, ts: string): StreamEvent =>
  ({ kind: "assistant_text", text: "x", ts, msgId: "m", uuid }) as StreamEvent;

const chapters = (uuids: string[]): DigestChapter[] =>
  uuids.map((u, i) => ({ anchor_uuid: u, title: `C${i}`, caption: "" }));

const STREAM: StreamEvent[] = [
  up("a", "2026-01-01T00:00:00Z"),
  tool("t1", "2026-01-01T00:00:10Z"),
  tool("t2", "2026-01-01T00:00:20Z"),
  at("b", "2026-01-01T00:01:00Z"),
  tool("t3", "2026-01-01T00:01:30Z"),
];

describe("chapterMetrics", () => {
  it("counts tool_use events within each chapter span", () => {
    const m = chapterMetrics(STREAM, chapters(["a", "b"]));
    expect(m.get("a")!.toolCount).toBe(2);
    expect(m.get("b")!.toolCount).toBe(1);
  });

  it("computes anchor-to-next-anchor duration, last chapter to last event", () => {
    const m = chapterMetrics(STREAM, chapters(["a", "b"]));
    expect(m.get("a")!.durationMs).toBe(60000);
    expect(m.get("b")!.durationMs).toBe(30000);
  });

  it("omits chapters whose anchor is absent from the stream", () => {
    const m = chapterMetrics(STREAM, chapters(["a", "zzz"]));
    expect(m.has("zzz")).toBe(false);
    // Only "a" resolves, so its span runs to the end: 3 tools.
    expect(m.get("a")!.toolCount).toBe(3);
  });

  it("sorts anchors by stream position so spans are never negative", () => {
    const m = chapterMetrics(STREAM, chapters(["b", "a"]));
    expect(m.get("a")!.toolCount).toBe(2);
    expect(m.get("b")!.toolCount).toBe(1);
    expect(m.get("a")!.durationMs).toBe(60000);
  });

  it("returns null duration when timestamps are missing", () => {
    const noTs: StreamEvent[] = [up("a", ""), tool("t", "")];
    const m = chapterMetrics(noTs, chapters(["a"]));
    expect(m.get("a")!.durationMs).toBeNull();
    expect(m.get("a")!.toolCount).toBe(1);
  });
});
