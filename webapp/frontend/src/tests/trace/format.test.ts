import { describe, expect, it } from "vitest";
import {
  clip,
  fmtDuration,
  fmtDurationCompact,
  fmtTokens,
  inlineFormat,
  renderMarkdownish,
  shortenPath,
  toolSummary,
  truncate,
} from "../../components/trace/format";

describe("fmtDuration", () => {
  it("returns 0s for non-positive values", () => {
    expect(fmtDuration(0)).toBe("0s");
    expect(fmtDuration(-5)).toBe("0s");
  });
  it("formats seconds, minutes, and hours", () => {
    expect(fmtDuration(5_000)).toBe("5s");
    expect(fmtDuration(65_000)).toBe("1m 5s");
    expect(fmtDuration(3_725_000)).toBe("1h 2m");
  });
});

describe("fmtDurationCompact", () => {
  it("scales by unit and uses one decimal", () => {
    expect(fmtDurationCompact(2_500)).toBe("2.5s");
    expect(fmtDurationCompact(90_000)).toBe("1.5m");
    expect(fmtDurationCompact(5_400_000)).toBe("1.5h");
  });
});

describe("fmtTokens", () => {
  it("returns em-dash for null", () => {
    expect(fmtTokens(null)).toBe("—");
  });
  it("formats with k and M suffixes", () => {
    expect(fmtTokens(900)).toBe("900");
    expect(fmtTokens(1_500)).toBe("1.5k");
    expect(fmtTokens(42_000)).toBe("42k");
    expect(fmtTokens(2_500_000)).toBe("2.5M");
  });
});

describe("shortenPath", () => {
  it("strips root prefix", () => {
    expect(shortenPath("/home/x/proj/src/a.ts", "/home/x/proj")).toBe(
      "src/a.ts",
    );
  });
  it("returns full path when root does not match", () => {
    expect(shortenPath("/etc/hosts", "/home/x")).toBe("/etc/hosts");
  });
  it("returns basename when path equals root", () => {
    expect(shortenPath("/x/y", "/x/y")).toBe("y");
  });
});

describe("truncate / clip", () => {
  it("truncate adds ellipsis when over n", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("abc", 5)).toBe("abc");
  });
  it("clip appends ellipsis when over n", () => {
    expect(clip("abcdef", 3)).toBe("abc…");
    expect(clip("abc", 5)).toBe("abc");
  });
});

describe("renderMarkdownish", () => {
  it("splits paragraphs on blank lines", () => {
    const blocks = renderMarkdownish("para 1\n\npara 2");
    expect(blocks).toEqual([
      { type: "p", text: "para 1" },
      { type: "p", text: "para 2" },
    ]);
  });
  it("recognizes headings", () => {
    expect(renderMarkdownish("## Hello")[0]).toEqual({
      type: "h2",
      text: "Hello",
    });
    expect(renderMarkdownish("### Sub")[0]).toEqual({
      type: "h3",
      text: "Sub",
    });
  });
  it("recognizes bullet lists", () => {
    const blocks = renderMarkdownish("- one\n- two\n- three");
    expect(blocks).toEqual([{ type: "ul", items: ["one", "two", "three"] }]);
  });
});

describe("inlineFormat", () => {
  it("parses bold, em, code", () => {
    const parts = inlineFormat("a **b** c *d* e `f` g");
    expect(parts).toEqual([
      { t: "text", text: "a " },
      { t: "strong", text: "b" },
      { t: "text", text: " c " },
      { t: "em", text: "d" },
      { t: "text", text: " e " },
      { t: "code", text: "f" },
      { t: "text", text: " g" },
    ]);
  });
  it("returns plain text when no markers", () => {
    expect(inlineFormat("plain")).toEqual([{ t: "text", text: "plain" }]);
  });
});

describe("toolSummary", () => {
  const root = "/home/x/proj";
  it("Bash → command", () => {
    expect(toolSummary("Bash", { command: "ls -la" }, root)).toBe("ls -la");
  });
  it("Read → shortened file_path", () => {
    expect(
      toolSummary("Read", { file_path: "/home/x/proj/src/a.ts" }, root),
    ).toBe("src/a.ts");
  });
  it("Write → shortened file_path", () => {
    expect(
      toolSummary("Write", { file_path: "/home/x/proj/out.ts" }, root),
    ).toBe("out.ts");
  });
  it("AskUserQuestion → first question + count", () => {
    const input = {
      questions: [{ question: "Pick one?" }, { question: "Also this?" }],
    };
    expect(toolSummary("AskUserQuestion", input, root)).toBe(
      "Pick one? (+1 more)",
    );
  });
  it("TaskUpdate → task id and status", () => {
    expect(
      toolSummary("TaskUpdate", { taskId: "7", status: "completed" }, root),
    ).toBe("Task 7 → completed");
  });
  it("Agent → description", () => {
    expect(toolSummary("Agent", { description: "Audit branch" }, root)).toBe(
      "Audit branch",
    );
  });
  it("unknown tool → stringified input, truncated", () => {
    const summary = toolSummary(
      "Mystery",
      { x: "a".repeat(100) },
      root,
    );
    expect(summary.length).toBeLessThanOrEqual(80);
  });
});
