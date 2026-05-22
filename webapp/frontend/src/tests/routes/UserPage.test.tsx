import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { UserPage } from "../../routes/UserPage";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../../auth/AuthContext";

const mockUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

const overview = (traceCount: number) => ({
  login: "alice",
  stats: {
    trace_count: traceCount,
    repo_count: traceCount > 0 ? 2 : 0,
    message_count: 1234,
    byte_size: 4096,
    last_trace_at: traceCount > 0 ? "2026-05-20T00:00:00Z" : null,
  },
  repos:
    traceCount > 0
      ? [{ repo_full_name: "alice/repo", repo_name: "repo", trace_count: 3 }]
      : [],
  traces:
    traceCount > 0
      ? [
          {
            trace_id: "id-1",
            short_id: "abc1234567",
            owner_login: "alice",
            repo_full_name: "alice/repo",
            pr_number: 3,
            pr_url: "https://github.com/alice/repo/pull/3",
            pr_title: "Add the thing",
            platform: "claude-code",
            byte_size: 4096,
            message_count: 12,
            created_at: "2026-05-20T00:00:00Z",
          },
        ]
      : [],
});

const githubUser = {
  login: "alice",
  name: "Alice",
  bio: null,
  avatar_url: null,
  html_url: "https://github.com/alice",
  followers: 42,
  following: 7,
  public_repos: 10,
  total_public_stars: 99,
  top_languages: ["TypeScript"],
  created_at: "2020-01-01T00:00:00Z",
  stars_truncated: false,
};

const contributions = {
  login: "alice",
  total: 0,
  days: [],
};

/** Routes a mocked fetch by URL path to the right JSON payload. */
function mockFetch(traceCount: number) {
  vi.spyOn(global, "fetch").mockImplementation((input) => {
    const url = String(input);
    let body: unknown = {};
    if (url.includes("/api/users/")) body = overview(traceCount);
    else if (url.includes("/contributions")) body = contributions;
    else if (url.includes("/api/github/users/")) body = githubUser;
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
}

function renderUserPage() {
  return render(
    <MemoryRouter initialEntries={["/alice"]}>
      <Routes>
        <Route path=":owner" element={<UserPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const ownerAuth = {
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
};

const visitorAuth = {
  loading: false,
  user: null,
  refresh: vi.fn(),
  signOut: vi.fn(),
};

describe("UserPage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders the merged stat strip", async () => {
    mockUseAuth.mockReturnValue(visitorAuth);
    mockFetch(1);
    renderUserPage();
    // "42" is the GitHub follower count — waiting on it confirms both
    // the overview and the GitHub-user fetch have resolved.
    await waitFor(() =>
      expect(screen.getByText("42")).toBeInTheDocument(),
    );
    // "Messages" / "Followers" are unique to the stat strip. ("Traces"
    // and "Repositories" are deliberately not asserted — those strings
    // also appear on the tab buttons.)
    expect(screen.getByText("Messages")).toBeInTheDocument();
    expect(screen.getByText("Followers")).toBeInTheDocument();
    expect(screen.getByText("1.2k")).toBeInTheDocument(); // 1234 messages
  });

  it("shows owner affordances when viewing your own profile", async () => {
    mockUseAuth.mockReturnValue(ownerAuth);
    mockFetch(1);
    renderUserPage();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /copy profile link/i }),
      ).toBeInTheDocument(),
    );
    // The greeting line renders the owner's bold first name, "Alice".
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText(/Capturing more/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Working in private repos\?/i),
    ).toBeInTheDocument();
  });

  it("hides owner affordances from other visitors", async () => {
    mockUseAuth.mockReturnValue(visitorAuth);
    mockFetch(1);
    renderUserPage();
    await waitFor(() =>
      expect(screen.getByText("Followers")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /copy profile link/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(screen.queryByText(/Capturing more/i)).not.toBeInTheDocument();
  });

  it("shows the onboarding card for the owner with zero traces", async () => {
    mockUseAuth.mockReturnValue(ownerAuth);
    mockFetch(0);
    renderUserPage();
    await waitFor(() =>
      expect(
        screen.getByText(/Capture your first Claude Code session/i),
      ).toBeInTheDocument(),
    );
  });

  it("shows a plain empty state for a visitor on an empty profile", async () => {
    mockUseAuth.mockReturnValue(visitorAuth);
    mockFetch(0);
    renderUserPage();
    await waitFor(() =>
      expect(screen.getByText(/No traces yet/i)).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(/Capture your first Claude Code session/i),
    ).not.toBeInTheDocument();
  });
});
