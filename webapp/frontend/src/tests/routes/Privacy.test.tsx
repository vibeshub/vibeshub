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
});
