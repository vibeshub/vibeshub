import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { AuthWidget } from "../components/AuthWidget";

const mockUser = {
  id: "u-1",
  login: "alice",
  name: "Alice",
  avatar_url: "https://avatars/alice.png",
  has_private_access: false,
};

vi.mock("../auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../auth/AuthContext";

describe("AuthWidget", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders Sign in link when anonymous", () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      loading: false, user: null, refresh: vi.fn(), signOut: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={["/alice"]}>
        <AuthWidget />
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: /sign in with github/i });
    expect(link).toHaveAttribute(
      "href",
      "/api/auth/github/login?next=%2Falice",
    );
  });

  it("renders @login as a link to the workspace when authenticated", () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      loading: false, user: mockUser, refresh: vi.fn(), signOut: vi.fn(),
    });

    render(
      <MemoryRouter>
        <AuthWidget />
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: /@alice/i });
    expect(link).toHaveAttribute("href", "/home");
  });

  it("renders nothing while loading", () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      loading: true, user: null, refresh: vi.fn(), signOut: vi.fn(),
    });

    const { container } = render(
      <MemoryRouter>
        <AuthWidget />
      </MemoryRouter>,
    );
    expect(container.textContent).toBe("");
  });
});
