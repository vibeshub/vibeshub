import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DigestPanel } from "../../components/trace/DigestPanel";
import type { TraceDigest } from "../../types";


const sampleDigest: TraceDigest = {
  ask: "Add /healthcheck",
  decisions: "Inline in main.py",
  files: "webapp/backend/app/main.py",
  tests: "test_health.py",
  dead_ends: "Considered a new router; YAGNI",
  chapters: [
    { anchor_uuid: "u1", title: "Frame", caption: "User asks." },
    { anchor_uuid: "u2", title: "Land", caption: "Patch shipped." },
  ],
};


describe("DigestPanel", () => {
  it("renders all five bullets", () => {
    render(<DigestPanel digest={sampleDigest} />);
    expect(screen.getByText(/Ask/i)).toBeInTheDocument();
    expect(screen.getByText("Add /healthcheck")).toBeInTheDocument();
    expect(screen.getByText("Inline in main.py")).toBeInTheDocument();
    expect(
      screen.getByText("webapp/backend/app/main.py"),
    ).toBeInTheDocument();
    expect(screen.getByText("test_health.py")).toBeInTheDocument();
    expect(
      screen.getByText("Considered a new router; YAGNI"),
    ).toBeInTheDocument();
  });

  it("renders a chapter rail when chapters present", () => {
    render(<DigestPanel digest={sampleDigest} />);
    expect(screen.getByText("Frame")).toBeInTheDocument();
    expect(screen.getByText("Land")).toBeInTheDocument();
  });

  it("hides the chapter rail when chapters empty", () => {
    render(
      <DigestPanel digest={{ ...sampleDigest, chapters: [] }} />,
    );
    expect(screen.queryByText(/Jump to/i)).not.toBeInTheDocument();
  });

  it("scrolls the chapter anchor into view on click", async () => {
    const user = userEvent.setup();
    const scrollSpy = vi.fn();
    const fakeEl = { scrollIntoView: scrollSpy } as unknown as HTMLElement;
    vi.spyOn(document, "getElementById").mockImplementation((id) =>
      id === "evt-u1" ? fakeEl : null,
    );

    render(<DigestPanel digest={sampleDigest} />);
    await user.click(screen.getByText("Frame"));
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth" });
  });
});
