import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Faq } from "../../routes/Faq";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: vi.fn(() => ({
    loading: false,
    user: null,
    refresh: vi.fn(),
    signOut: vi.fn(),
  })),
}));

function renderFaq() {
  return render(
    <MemoryRouter initialEntries={["/faq"]}>
      <Routes>
        <Route path="/faq" element={<Faq />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Faq", () => {
  it("renders the page shell with an h1 heading", () => {
    renderFaq();
    expect(
      screen.getByRole("heading", { level: 1, name: /sharing the vibe/i }),
    ).toBeInTheDocument();
  });

  it("renders each topic group heading", () => {
    renderFaq();
    const groups = [
      /getting started/i,
      /compatibility/i,
      /privacy & visibility/i,
      /data security & redaction/i,
      /managing shared sessions/i,
    ];
    for (const name of groups) {
      expect(
        screen.getByRole("heading", { level: 2, name }),
      ).toBeInTheDocument();
    }
  });

  it("renders questions as accordion toggle buttons, collapsed by default", () => {
    renderFaq();
    const toggle = screen.getByRole("button", { name: /what is vibeshub\?/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps answer copy in the DOM even while collapsed (for SEO)", () => {
    renderFaq();
    // The answer text is present in the rendered HTML without any interaction.
    expect(
      screen.getByText(/shareable, replayable traces/i),
    ).toBeInTheDocument();
  });
});
