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
});
