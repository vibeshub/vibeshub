import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Privacy } from "../../routes/Privacy";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: vi.fn(() => ({
    loading: false,
    user: null,
    refresh: vi.fn(),
    signOut: vi.fn(),
  })),
}));

function renderPrivacy() {
  return render(
    <MemoryRouter initialEntries={["/privacy"]}>
      <Routes>
        <Route path="/privacy" element={<Privacy />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Privacy", () => {
  it("renders the page shell with a Privacy heading", () => {
    renderPrivacy();
    expect(
      screen.getByRole("heading", { level: 1, name: /privacy policy/i }),
    ).toBeInTheDocument();
  });

  it("renders each major policy section", () => {
    renderPrivacy();
    const sections = [
      /what we collect/i,
      /redaction/i,
      /how we use/i,
      /visibility & sharing/i,
      /third parties/i,
      /retention & deletion/i,
      /your rights & contact/i,
      /changes to this policy/i,
    ];
    for (const name of sections) {
      expect(
        screen.getByRole("heading", { level: 2, name }),
      ).toBeInTheDocument();
    }
  });

  it("shows the contact email as a mailto link", () => {
    renderPrivacy();
    const link = screen.getByRole("link", { name: /bhavya@vibeshub\.ai/i });
    expect(link).toHaveAttribute("href", "mailto:bhavya@vibeshub.ai");
  });

  it("states an effective date", () => {
    renderPrivacy();
    expect(screen.getByText(/effective .*2026/i)).toBeInTheDocument();
  });
});
