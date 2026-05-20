import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { DiffView } from "../../components/trace/tool/DiffView";
import type { DiffRow } from "../../components/trace/diff";

const rows: DiffRow[] = [
  { kind: "hunk", oldNo: null, newNo: null, text: "@@ -1,1 +1,2 @@" },
  { kind: "ctx", oldNo: 1, newNo: 1, text: "const a = 1;" },
  { kind: "add", oldNo: null, newNo: 2, text: "const b = 2;" },
];

describe("DiffView", () => {
  it("renders one row per DiffRow with the code text", () => {
    const { container, getByText } = render(
      <DiffView rows={rows} lang="javascript" />,
    );
    expect(container.querySelectorAll(".diff-row")).toHaveLength(3);
    expect(getByText("@@ -1,1 +1,2 @@")).toBeInTheDocument();
    expect(container.querySelector(".diff-add")).not.toBeNull();
    expect(container.textContent).toContain("const b = 2;");
  });
  it("shows old and new line numbers in the gutters", () => {
    const { container } = render(<DiffView rows={rows} lang={null} />);
    const ctx = container.querySelector(".diff-ctx")!;
    const gutters = ctx.querySelectorAll(".diff-gutter");
    expect(gutters[0].textContent).toBe("1");
    expect(gutters[1].textContent).toBe("1");
  });
  it("renders nothing for an empty row list", () => {
    const { container } = render(<DiffView rows={[]} lang={null} />);
    expect(container.firstChild).toBeNull();
  });
});
