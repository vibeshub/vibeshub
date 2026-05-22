import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Home } from "../../routes/Home";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../../auth/AuthContext";

const mockUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/home"]}>
      <Routes>
        <Route path="/home" element={<Home />} />
        <Route path="/" element={<div>landing page</div>} />
        <Route path=":owner" element={<div>profile page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Home", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("redirects a signed-in user to their profile page", () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: {
        id: "u-1",
        login: "alice",
        name: "Alice",
        avatar_url: null,
        has_private_access: false,
      },
      refresh: vi.fn(),
      signOut: vi.fn(),
    });
    renderHome();
    expect(screen.getByText("profile page")).toBeInTheDocument();
  });

  it("redirects an anonymous visitor to the landing page", () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: null,
      refresh: vi.fn(),
      signOut: vi.fn(),
    });
    renderHome();
    expect(screen.getByText("landing page")).toBeInTheDocument();
  });

  it("renders an empty shell while the session is resolving", () => {
    mockUseAuth.mockReturnValue({
      loading: true,
      user: null,
      refresh: vi.fn(),
      signOut: vi.fn(),
    });
    const { container } = renderHome();
    expect(container.querySelector(".page-shell")).not.toBeNull();
  });
});
