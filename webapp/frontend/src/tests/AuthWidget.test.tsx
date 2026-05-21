import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { AuthWidget } from "../components/AuthWidget";

const mockUser = {
  id: "u-1",
  login: "alice",
  name: "Alice",
  avatar_url: "https://avatars/alice.png",
  has_private_access: false,
};

const mockUserWithPrivate = { ...mockUser, has_private_access: true };

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

  it("renders @login and a Sign out button when authenticated", () => {
    const signOut = vi.fn();
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      loading: false, user: mockUser, refresh: vi.fn(), signOut,
    });

    render(
      <MemoryRouter>
        <AuthWidget />
      </MemoryRouter>,
    );

    expect(screen.getByText("@alice")).toBeInTheDocument();

    // Open the dropdown
    fireEvent.click(screen.getByRole("button", { name: /@alice/i }));

    // Now Sign out is in the DOM
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(signOut).toHaveBeenCalled();
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

  it("shows Enable private repositories when the user lacks the scope", () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      loading: false, user: mockUser, refresh: vi.fn(), signOut: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={["/alice/repo"]}>
        <AuthWidget />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /@alice/i }));
    const link = screen.getByRole("link", {
      name: /enable private repositories/i,
    });
    expect(link.getAttribute("href")).toContain("scope=private");
  });

  it("hides Enable private repositories once the user has the scope", () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      loading: false, user: mockUserWithPrivate, refresh: vi.fn(),
      signOut: vi.fn(),
    });

    render(
      <MemoryRouter>
        <AuthWidget />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /@alice/i }));
    expect(
      screen.queryByRole("link", { name: /enable private repositories/i }),
    ).toBeNull();
  });
});
