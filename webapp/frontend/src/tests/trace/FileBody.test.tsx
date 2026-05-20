import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { FileBody } from "../../components/trace/tool/FileBody";
import type { ToolResult } from "../../components/trace/types";

describe("FileBody write mode", () => {
  it("renders a diff from a structuredPatch", () => {
    const result: ToolResult = {
      content: "",
      toolUseResult: {
        structuredPatch: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 2,
            lines: [" a", "+b"],
          },
        ],
      },
    };
    const { container, getByText } = render(
      <FileBody
        mode="write"
        input={{ file_path: "src/x.ts" }}
        result={result}
        root={null}
      />,
    );
    expect(getByText("Changes")).toBeInTheDocument();
    expect(container.querySelector(".diff-view")).not.toBeNull();
    expect(container.querySelector(".diff-add")).not.toBeNull();
    expect(container.querySelector(".diff-stat-add")?.textContent).toBe("+1");
  });

  it("falls back to an Edit's old/new strings when there is no patch", () => {
    const { container } = render(
      <FileBody
        mode="write"
        input={{ file_path: "a.txt", old_string: "x", new_string: "y" }}
        result={null}
        root={null}
      />,
    );
    expect(container.querySelector(".diff-del")).not.toBeNull();
    expect(container.querySelector(".diff-add")).not.toBeNull();
  });
});
