import { describe, expect, it } from "vitest";
import {
  rowsFromStructuredPatch,
  rowsFromNewFile,
  fallbackDiff,
  extractPatch,
  buildWriteRows,
} from "../../components/trace/diff";

describe("rowsFromStructuredPatch", () => {
  it("flattens a hunk into numbered rows with a header", () => {
    const rows = rowsFromStructuredPatch([
      {
        oldStart: 28,
        oldLines: 2,
        newStart: 28,
        newLines: 3,
        lines: [" }", "+added", " after"],
      },
    ]);
    expect(rows).toEqual([
      { kind: "hunk", oldNo: null, newNo: null, text: "@@ -28,2 +28,3 @@" },
      { kind: "ctx", oldNo: 28, newNo: 28, text: "}" },
      { kind: "add", oldNo: null, newNo: 29, text: "added" },
      { kind: "ctx", oldNo: 29, newNo: 30, text: "after" },
    ]);
  });
  it("numbers deletions against the old file only", () => {
    const rows = rowsFromStructuredPatch([
      { oldStart: 5, oldLines: 2, newStart: 5, newLines: 1, lines: [" a", "-b"] },
    ]);
    expect(rows[1]).toEqual({ kind: "ctx", oldNo: 5, newNo: 5, text: "a" });
    expect(rows[2]).toEqual({ kind: "del", oldNo: 6, newNo: null, text: "b" });
  });
});

describe("rowsFromNewFile", () => {
  it("renders every line as an addition", () => {
    expect(rowsFromNewFile("a\nb")).toEqual([
      { kind: "add", oldNo: null, newNo: 1, text: "a" },
      { kind: "add", oldNo: null, newNo: 2, text: "b" },
    ]);
  });
  it("returns no rows for empty content", () => {
    expect(rowsFromNewFile("")).toEqual([]);
  });
});

describe("fallbackDiff", () => {
  it("produces ctx/del/add rows via an LCS line diff", () => {
    expect(fallbackDiff("a\nb\nc", "a\nx\nc")).toEqual([
      { kind: "ctx", oldNo: 1, newNo: 1, text: "a" },
      { kind: "del", oldNo: 2, newNo: null, text: "b" },
      { kind: "add", oldNo: null, newNo: 2, text: "x" },
      { kind: "ctx", oldNo: 3, newNo: 3, text: "c" },
    ]);
  });
  it("treats an empty old string as all additions", () => {
    expect(fallbackDiff("", "x")).toEqual([
      { kind: "add", oldNo: null, newNo: 1, text: "x" },
    ]);
  });
  it("handles a pure deletion", () => {
    expect(fallbackDiff("a\nb", "a")).toEqual([
      { kind: "ctx", oldNo: 1, newNo: 1, text: "a" },
      { kind: "del", oldNo: 2, newNo: null, text: "b" },
    ]);
  });
  it("handles a pure addition", () => {
    expect(fallbackDiff("a", "a\nb")).toEqual([
      { kind: "ctx", oldNo: 1, newNo: 1, text: "a" },
      { kind: "add", oldNo: null, newNo: 2, text: "b" },
    ]);
  });
  it("returns no rows when both strings are empty", () => {
    expect(fallbackDiff("", "")).toEqual([]);
  });
});

describe("extractPatch", () => {
  it("returns null for non-patch values", () => {
    expect(extractPatch(undefined)).toBeNull();
    expect(extractPatch("nope")).toBeNull();
    expect(extractPatch([])).toBeNull();
    expect(extractPatch([{ foo: 1 }])).toBeNull();
  });
  it("normalizes a valid patch array", () => {
    expect(
      extractPatch([
        { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [" a"] },
      ]),
    ).toEqual([
      { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [" a"] },
    ]);
  });
  it("defaults missing line counts and coerces line entries to strings", () => {
    expect(
      extractPatch([{ oldStart: 1, newStart: 1, lines: [2] }]),
    ).toEqual([
      { oldStart: 1, oldLines: 0, newStart: 1, newLines: 0, lines: ["2"] },
    ]);
  });
});

describe("buildWriteRows", () => {
  it("prefers a structured patch", () => {
    const rows = buildWriteRows({ content: "ignored" }, [
      { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["+x"] },
    ]);
    expect(rows).toEqual([
      { kind: "hunk", oldNo: null, newNo: null, text: "@@ -1,1 +1,1 @@" },
      { kind: "add", oldNo: null, newNo: 1, text: "x" },
    ]);
  });
  it("falls back to new-file rows from Write content", () => {
    expect(buildWriteRows({ content: "a\nb" }, null)).toEqual([
      { kind: "add", oldNo: null, newNo: 1, text: "a" },
      { kind: "add", oldNo: null, newNo: 2, text: "b" },
    ]);
  });
  it("falls back to an Edit's old/new strings", () => {
    expect(
      buildWriteRows({ old_string: "a", new_string: "b" }, null),
    ).toEqual([
      { kind: "del", oldNo: 1, newNo: null, text: "a" },
      { kind: "add", oldNo: null, newNo: 1, text: "b" },
    ]);
  });
  it("concatenates a MultiEdit's edits", () => {
    expect(
      buildWriteRows(
        { edits: [{ old_string: "a", new_string: "b" }, { old_string: "c", new_string: "d" }] },
        null,
      ),
    ).toEqual([
      { kind: "del", oldNo: 1, newNo: null, text: "a" },
      { kind: "add", oldNo: null, newNo: 1, text: "b" },
      { kind: "del", oldNo: 1, newNo: null, text: "c" },
      { kind: "add", oldNo: null, newNo: 1, text: "d" },
    ]);
  });
  it("returns no rows when there is nothing to show", () => {
    expect(buildWriteRows({}, null)).toEqual([]);
  });
  it("falls through an empty patch array to Write content", () => {
    expect(buildWriteRows({ content: "a" }, [])).toEqual([
      { kind: "add", oldNo: null, newNo: 1, text: "a" },
    ]);
  });
});
