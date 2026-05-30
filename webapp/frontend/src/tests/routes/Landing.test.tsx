import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Landing } from "../../routes/Landing";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../api", () => ({
  fetchRepoOverview: vi.fn(),
}));

import { useAuth } from "../../auth/AuthContext";
import { fetchRepoOverview } from "../../api";

const mockUseAuth = useAuth as unknown as Mock;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="vibeviewer" element={<div>vibeviewer sentinel</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Landing", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockUseAuth.mockReturnValue({ loading: false, user: null });
    (fetchRepoOverview as Mock).mockReset();
    // Degrade to skeleton; no state update fires on rejection.
    (fetchRepoOverview as Mock).mockRejectedValue(new Error("no network in test"));
  });

  it("leads with team-collaboration messaging", () => {
    renderPage();
    expect(
      screen.getByText(/Your team.?s work, finally legible/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Faster, deeper review/i)).toBeInTheDocument();
    expect(screen.getByText(/Searchable team history/i)).toBeInTheDocument();
  });

  it("drops the solo brag-post framing from the front page", () => {
    renderPage();
    expect(screen.queryByText(/Brag posts/i)).not.toBeInTheDocument();
  });

  it("offers solo visitors a subtle pointer to the vibeviewer", () => {
    renderPage();
    expect(
      screen.getByText(/just want to show off a session/i),
    ).toBeInTheDocument();
  });
});
