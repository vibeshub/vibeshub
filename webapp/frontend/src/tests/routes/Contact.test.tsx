import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Contact } from "../../routes/Contact";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: vi.fn(() => ({
    loading: false,
    user: null,
    refresh: vi.fn(),
    signOut: vi.fn(),
  })),
}));

function renderContact() {
  return render(
    <MemoryRouter initialEntries={["/contact"]}>
      <Routes>
        <Route path="/contact" element={<Contact />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Contact", () => {
  it("renders the page shell with a Get in touch heading", () => {
    renderContact();
    expect(
      screen.getByRole("heading", { level: 1, name: /get in touch/i }),
    ).toBeInTheDocument();
  });

  it("shows the contact email as a mailto link", () => {
    renderContact();
    const link = screen.getByRole("link", { name: /bhavya@vibeshub\.ai/i });
    expect(link).toHaveAttribute("href", "mailto:bhavya@vibeshub.ai");
  });
});
