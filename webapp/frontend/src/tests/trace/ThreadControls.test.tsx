import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ViewTabs } from "../../components/trace/ThreadControls";

describe("ViewTabs toggles", () => {
  it("renders toggles as pills without checkbox glyphs", () => {
    const { container } = render(
      <ViewTabs
        mode="conversation"
        setMode={() => {}}
        hasChanges
        promptCount={2}
        fileCount={2}
        showSystemEvents={false}
        setShowSystemEvents={() => {}}
        expandToolCalls
        setExpandToolCalls={() => {}}
      />,
    );
    expect(container.querySelector(".toggle .check")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show system events" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Expand tool calls" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
