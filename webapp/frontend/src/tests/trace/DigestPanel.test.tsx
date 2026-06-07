import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

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
    expect(screen.getByText("webapp/backend/app/main.py")).toBeInTheDocument();
    expect(screen.getByText("test_health.py")).toBeInTheDocument();
    expect(screen.getByText("Considered a new router; YAGNI")).toBeInTheDocument();
  });

  it("does not render chapter jump chips (owned by the rail now)", () => {
    render(<DigestPanel digest={sampleDigest} />);
    expect(screen.queryByText("Frame")).not.toBeInTheDocument();
    expect(screen.queryByText("Land")).not.toBeInTheDocument();
    expect(screen.queryByText(/Jump to/i)).not.toBeInTheDocument();
  });
});
