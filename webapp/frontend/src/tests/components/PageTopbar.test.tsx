import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PageTopbar } from "../../components/PageTopbar";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../../auth/AuthContext";

const mockUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

function renderTopbar() {
  return render(
    <MemoryRouter>
      <PageTopbar crumbs={[]} />
    </MemoryRouter>,
  );
}

describe("PageTopbar", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows an Upload link pointing at /vibeviewer for a signed-in user", () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: { id: "u1", login: "alice", name: "Alice", avatar_url: null },
      refresh: vi.fn(),
      signOut: vi.fn(),
    });
    renderTopbar();
    const link = screen.getByRole("link", { name: /upload/i });
    expect(link).toHaveAttribute("href", "/vibeviewer");
  });

  it("hides the Upload link from an anonymous visitor", () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: null,
      refresh: vi.fn(),
      signOut: vi.fn(),
    });
    renderTopbar();
    expect(
      screen.queryByRole("link", { name: /upload/i }),
    ).not.toBeInTheDocument();
  });
});
