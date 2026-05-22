import { describe, expect, it } from "vitest";
import { formatBreakdown } from "../../components/trace/tools";

describe("formatBreakdown", () => {
  it("counts tools and orders them by first appearance", () => {
    expect(formatBreakdown(["Bash", "Read", "Bash", "Edit"])).toBe(
      "2 Bash · 1 Read · 1 Edit",
    );
  });

  it("uses friendly tool labels from TOOL_META", () => {
    expect(formatBreakdown(["AskUserQuestion", "Agent"])).toBe(
      "1 Ask user · 1 Subagent",
    );
  });

  it("returns an empty string when given no tools", () => {
    expect(formatBreakdown([])).toBe("");
  });
});
