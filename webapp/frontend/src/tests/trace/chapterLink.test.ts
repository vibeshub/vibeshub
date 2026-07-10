import { describe, expect, it } from "vitest";
import {
  chapterForPos,
  chapterRanges,
  filesByChapter,
} from "../../components/trace/chapterLink";
import type { BlameFile, BlameHunk } from "../../components/trace/provenance";
import type { StreamEvent } from "../../components/trace/types";
import type { DigestChapter } from "../../types";

const up = (uuid: string): StreamEvent =>
  ({ kind: "user_prompt", text: "x", ts: "", uuid }) as StreamEvent;
const tool = (uuid: string): StreamEvent =>
  ({
    kind: "tool_use", name: "Bash", input: {}, id: uuid, ts: "",
    msgId: "m", uuid, result: null,
  }) as StreamEvent;

const STREAM: StreamEvent[] = [up("a"), tool("t1"), up("b"), tool("t2"), tool("t3")];
const CHAPTERS: DigestChapter[] = [
  { anchor_uuid: "a", title: "First", caption: "" },
  { anchor_uuid: "b", title: "Second", caption: "" },
];

function hunk(streamPos: number, adds: number, dels: number): BlameHunk {
  return {
    id: `f#${streamPos}`, jumpUuid: null, promptIdx: 1, promptUuid: null,
    streamPos, startTs: "", ts: "", tool: "Edit", attemptCount: 1,
    agentType: null, retried: false, rows: [], heat: [], adds, dels,
    superseded: null, attempts: [], verifications: [], reasoning: null,
    research: null,
  };
}

function file(path: string, hunks: BlameHunk[]): BlameFile {
  return {
    path, status: "mod", adds: 0, dels: 0, hunks,
    netRows: [], netAdds: 0, netDels: 0, hasNetData: false,
  };
}

describe("chapterRanges", () => {
  it("spans each anchor to the next, last one to stream end", () => {
    const ranges = chapterRanges(STREAM, CHAPTERS);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toMatchObject({ startPos: 0, endPos: 2 });
    expect(ranges[1]).toMatchObject({ startPos: 2, endPos: 5 });
  });

  it("skips chapters whose anchor is not in the stream", () => {
    const ranges = chapterRanges(STREAM, [
      { anchor_uuid: "ghost", title: "Ghost", caption: "" },
      ...CHAPTERS,
    ]);
    expect(ranges).toHaveLength(2);
  });
});

describe("chapterForPos", () => {
  const ranges = chapterRanges(STREAM, CHAPTERS);
  it("finds the containing chapter", () => {
    expect(chapterForPos(ranges, 1)?.title).toBe("First");
    expect(chapterForPos(ranges, 4)?.title).toBe("Second");
  });
  it("returns null for unattributable positions", () => {
    expect(chapterForPos(ranges, -1)).toBeNull();
  });
});

describe("filesByChapter", () => {
  it("buckets surviving hunks by chapter and sums the counts", () => {
    const ranges = chapterRanges(STREAM, CHAPTERS);
    const files = [
      file("/repo/a.ts", [hunk(1, 4, 2), hunk(3, 1, 0)]),
      file("/repo/b.ts", [hunk(4, 7, 0)]),
    ];
    const map = filesByChapter(files, ranges);
    expect(map.get("a")).toEqual([{ path: "/repo/a.ts", adds: 4, dels: 2 }]);
    expect(map.get("b")).toEqual([
      { path: "/repo/a.ts", adds: 1, dels: 0 },
      { path: "/repo/b.ts", adds: 7, dels: 0 },
    ]);
  });

  it("skips superseded hunks", () => {
    const ranges = chapterRanges(STREAM, CHAPTERS);
    const dead = { ...hunk(1, 9, 9), superseded: { turnLabel: "turn 2" } };
    const map = filesByChapter([file("/repo/a.ts", [dead])], ranges);
    expect(map.get("a")).toBeUndefined();
  });
});
