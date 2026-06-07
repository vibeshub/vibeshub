import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ChapterDivider } from "../../components/trace/ChapterDivider";


describe("ChapterDivider", () => {
  it("renders title and caption", () => {
    render(<ChapterDivider title="Frame" caption="User asks for X." />);
    expect(screen.getByText("Frame")).toBeInTheDocument();
    expect(screen.getByText("User asks for X.")).toBeInTheDocument();
  });

  it("renders without caption", () => {
    render(<ChapterDivider title="Frame" caption="" />);
    expect(screen.getByText("Frame")).toBeInTheDocument();
  });

  it("exposes a chapter-<uuid> id when anchorUuid is set", () => {
    const { container } = render(
      <ChapterDivider title="Frame" caption="x" anchorUuid="u1" />,
    );
    expect(container.querySelector("#chapter-u1")).not.toBeNull();
  });

  it("omits the id when anchorUuid is absent", () => {
    const { container } = render(<ChapterDivider title="Frame" caption="x" />);
    expect(container.querySelector("[id^='chapter-']")).toBeNull();
  });
});
