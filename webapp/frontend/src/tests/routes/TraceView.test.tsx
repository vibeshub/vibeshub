import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { TraceView } from "../../routes/TraceView";
import { useAuth } from "../../auth/AuthContext";

const mockUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

const anonAuth = {
  loading: false,
  user: null,
  refresh: vi.fn(),
  signOut: vi.fn(),
};

function authAs(login: string) {
  return {
    loading: false,
    user: { id: "u1", login, name: login, avatar_url: null },
    refresh: vi.fn(),
    signOut: vi.fn(),
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(
  join(__dirname, "../fixtures/sample-session.jsonl"),
  "utf-8",
);

const SHORT_ID = "abcd123456";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="t/:shortId" element={<TraceView />} />
        <Route
          path=":owner/:repo/pull/:number/:shortId"
          element={<TraceView />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function mockFetchSequence(traceSummary: object) {
  vi.spyOn(global, "fetch").mockImplementation((input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.endsWith(`/api/traces/${SHORT_ID}`)) {
      return Promise.resolve(
        new Response(JSON.stringify(traceSummary), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (url.endsWith(`/api/traces/${SHORT_ID}/raw`)) {
      return Promise.resolve(
        new Response(FIXTURE, {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      );
    }
    return Promise.reject(new Error(`unexpected URL: ${url}`));
  });
}

describe("TraceView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockUseAuth.mockReturnValue(anonAuth);
  });

  it("renders the hero title and at least one tool card from the parsed trace", async () => {
    mockFetchSequence({
      trace_id: "id",
      short_id: SHORT_ID,
      owner_login: "alice",
      repo_full_name: "alice/repo",
      pr_number: 7,
      pr_url: "https://github.com/alice/repo/pull/7",
      pr_title: "Add thing",
      platform: "claude-code",
      byte_size: FIXTURE.length,
      message_count: 100,
      created_at: "2026-05-17T00:00:00Z",
      is_private: false,
    });

    renderAt(`/alice/repo/pull/7/${SHORT_ID}`);

    await waitFor(() => {
      expect(
        screen.getAllByText(/SESSION ·/i).length,
      ).toBeGreaterThan(0);
    });

    // Hero title is the aiTitle from the fixture.
    const heroTitle = await screen.findByText(
      "Add startup credential smoke-check",
    );
    expect(heroTitle.tagName.toLowerCase()).toBe("h1");

    // At least one tool head button should appear.
    const toolButtons = screen.getAllByRole("button", { expanded: false });
    expect(toolButtons.length).toBeGreaterThan(0);

    // Thread controls render.
    expect(
      screen.getByRole("button", { name: /show system events/i }),
    ).toBeInTheDocument();
  });

  it("renders a Compact toggle in the thread controls", async () => {
    mockFetchSequence({
      trace_id: "id",
      short_id: SHORT_ID,
      owner_login: "alice",
      repo_full_name: "alice/repo",
      pr_number: 7,
      pr_url: "https://github.com/alice/repo/pull/7",
      pr_title: "Add thing",
      platform: "claude-code",
      byte_size: FIXTURE.length,
      message_count: 100,
      created_at: "2026-05-17T00:00:00Z",
      is_private: false,
    });

    renderAt(`/alice/repo/pull/7/${SHORT_ID}`);

    expect(
      await screen.findByRole("button", { name: /compact/i }),
    ).toBeInTheDocument();
  });

  it("folds consecutive tool calls into group lines when Compact is on", async () => {
    mockFetchSequence({
      trace_id: "id",
      short_id: SHORT_ID,
      owner_login: "alice",
      repo_full_name: "alice/repo",
      pr_number: 7,
      pr_url: "https://github.com/alice/repo/pull/7",
      pr_title: "Add thing",
      platform: "claude-code",
      byte_size: FIXTURE.length,
      message_count: 100,
      created_at: "2026-05-17T00:00:00Z",
      is_private: false,
    });

    renderAt(`/alice/repo/pull/7/${SHORT_ID}`);

    const toggle = await screen.findByRole("button", { name: /compact/i });

    // Off by default — no tool-group summary lines.
    expect(
      screen.queryAllByRole("button", { name: /tool call/i }),
    ).toHaveLength(0);

    fireEvent.click(toggle);

    // On — runs of consecutive tool calls collapse into group lines.
    expect(
      screen.getAllByRole("button", { name: /tool call/i }).length,
    ).toBeGreaterThan(0);
  });

  it("expands a tool group to reveal the individual tool cards", async () => {
    mockFetchSequence({
      trace_id: "id",
      short_id: SHORT_ID,
      owner_login: "alice",
      repo_full_name: "alice/repo",
      pr_number: 7,
      pr_url: "https://github.com/alice/repo/pull/7",
      pr_title: "Add thing",
      platform: "claude-code",
      byte_size: FIXTURE.length,
      message_count: 100,
      created_at: "2026-05-17T00:00:00Z",
      is_private: false,
    });

    renderAt(`/alice/repo/pull/7/${SHORT_ID}`);

    const toggle = await screen.findByRole("button", { name: /compact/i });
    fireEvent.click(toggle);

    const groups = screen.getAllByRole("button", { name: /tool call/i });
    const before = screen.getAllByRole("button").length;

    fireEvent.click(groups[0]);

    expect(groups[0]).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("button").length).toBeGreaterThan(before);
  });

  it("renders a lone tool call as its own group when Compact is on", async () => {
    mockFetchSequence({
      trace_id: "id",
      short_id: SHORT_ID,
      owner_login: "alice",
      repo_full_name: "alice/repo",
      pr_number: 7,
      pr_url: "https://github.com/alice/repo/pull/7",
      pr_title: "Add thing",
      platform: "claude-code",
      byte_size: FIXTURE.length,
      message_count: 100,
      created_at: "2026-05-17T00:00:00Z",
      is_private: false,
    });

    renderAt(`/alice/repo/pull/7/${SHORT_ID}`);

    const toggle = await screen.findByRole("button", { name: /compact/i });
    fireEvent.click(toggle);

    // The fixture has tool calls isolated between assistant text — each
    // renders as a group of one.
    expect(screen.getAllByText("1 tool call").length).toBeGreaterThan(0);
  });

  it("shows an error state when the trace summary fetch fails", async () => {
    vi.spyOn(global, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith(`/api/traces/${SHORT_ID}`)) {
        return Promise.resolve(new Response("nope", { status: 500 }));
      }
      return Promise.resolve(new Response("", { status: 200 }));
    });

    renderAt(`/alice/repo/pull/7/${SHORT_ID}`);

    await waitFor(() => {
      expect(screen.getByText(/500/)).toBeInTheDocument();
    });
  });

  it("shows a sign-in gate when the trace summary returns 401", async () => {
    vi.spyOn(global, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith(`/api/traces/${SHORT_ID}`)) {
        return Promise.resolve(
          new Response(JSON.stringify({ detail: "auth_required" }), {
            status: 401,
          }),
        );
      }
      return Promise.resolve(new Response("", { status: 200 }));
    });

    renderAt(`/alice/repo/pull/7/${SHORT_ID}`);

    const link = await screen.findByRole("link", {
      name: /sign in with github/i,
    });
    expect(link.getAttribute("href")).toContain("/api/auth/github/login");
  });

  it("shows an enable-private gate when the summary returns 403", async () => {
    vi.spyOn(global, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith(`/api/traces/${SHORT_ID}`)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ detail: "private_scope_required" }),
            { status: 403 },
          ),
        );
      }
      return Promise.resolve(new Response("", { status: 200 }));
    });

    renderAt(`/alice/repo/pull/7/${SHORT_ID}`);

    const link = await screen.findByRole("link", {
      name: /enable private repositories/i,
    });
    expect(link.getAttribute("href")).toContain("scope=private");
  });

  it("renders a clean not-found state when the summary returns 404", async () => {
    mockUseAuth.mockReturnValue(authAs("bob"));
    vi.spyOn(global, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith(`/api/traces/${SHORT_ID}`)) {
        return Promise.resolve(
          new Response(JSON.stringify({ detail: "not_found" }), {
            status: 404,
          }),
        );
      }
      if (url.endsWith(`/api/traces/${SHORT_ID}/raw`)) {
        return Promise.resolve(
          new Response(JSON.stringify({ detail: "not_found" }), {
            status: 404,
          }),
        );
      }
      return Promise.resolve(new Response("", { status: 200 }));
    });

    renderAt(`/t/${SHORT_ID}`);

    expect(
      await screen.findByRole("heading", { name: /not found/i }),
    ).toBeInTheDocument();
    // No raw ApiError string leaks through from either fetch.
    expect(screen.queryByText(/ApiError/)).not.toBeInTheDocument();
    expect(screen.queryByText(/404/)).not.toBeInTheDocument();
  });

  it("renders a standalone trace with no repo or PR", async () => {
    mockFetchSequence({
      trace_id: "id",
      short_id: SHORT_ID,
      owner_login: "alice",
      repo_full_name: null,
      pr_number: null,
      pr_url: null,
      pr_title: null,
      platform: "claude-code",
      byte_size: FIXTURE.length,
      message_count: 100,
      created_at: "2026-05-17T00:00:00Z",
      is_private: false,
    });

    const { container } = renderAt(`/t/${SHORT_ID}`);

    await waitFor(() =>
      expect(screen.queryByText(/Loading trace/i)).not.toBeInTheDocument(),
    );
    // The standalone TraceHeader renders no "View on GitHub" link and
    // falls back to a generic "Trace <short_id>" title.
    const heading = await screen.findByRole("heading", {
      name: `Trace ${SHORT_ID}`,
      level: 1,
    });
    const header = heading.closest("header");
    expect(header).not.toBeNull();
    expect(
      header!.textContent?.toLowerCase(),
    ).not.toContain("view on github");
    void container;
  });

  it("renders a Private badge for a private trace", async () => {
    mockFetchSequence({
      trace_id: "id",
      short_id: SHORT_ID,
      owner_login: "alice",
      repo_full_name: "alice/repo",
      pr_number: 7,
      pr_url: "https://github.com/alice/repo/pull/7",
      pr_title: "Add thing",
      platform: "claude-code",
      byte_size: FIXTURE.length,
      message_count: 100,
      created_at: "2026-05-17T00:00:00Z",
      is_private: true,
    });

    renderAt(`/alice/repo/pull/7/${SHORT_ID}`);

    const badge = await screen.findByText(/Private/);
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain("🔒");
  });

  it("renders the manage menu for the trace owner", async () => {
    mockUseAuth.mockReturnValue(authAs("alice"));
    mockFetchSequence({
      trace_id: "id",
      short_id: SHORT_ID,
      owner_login: "alice",
      repo_full_name: null,
      pr_number: null,
      pr_url: null,
      pr_title: null,
      platform: "claude-code",
      byte_size: FIXTURE.length,
      message_count: 100,
      created_at: "2026-05-17T00:00:00Z",
      is_private: false,
    });

    renderAt(`/t/${SHORT_ID}`);

    const trigger = await screen.findByRole("button", { name: /^owner$/i });
    expect(trigger).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(
      await screen.findByRole("dialog", { name: /manage trace/i }),
    ).toBeInTheDocument();
  });

  it("hides the manage menu from a non-owner", async () => {
    mockUseAuth.mockReturnValue(authAs("bob"));
    mockFetchSequence({
      trace_id: "id",
      short_id: SHORT_ID,
      owner_login: "alice",
      repo_full_name: null,
      pr_number: null,
      pr_url: null,
      pr_title: null,
      platform: "claude-code",
      byte_size: FIXTURE.length,
      message_count: 100,
      created_at: "2026-05-17T00:00:00Z",
      is_private: false,
    });

    renderAt(`/t/${SHORT_ID}`);

    await waitFor(() =>
      expect(screen.queryByText(/Loading trace/i)).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /^owner$/i }),
    ).not.toBeInTheDocument();
  });

  it("hides the manage menu from an anonymous visitor", async () => {
    mockUseAuth.mockReturnValue(anonAuth);
    mockFetchSequence({
      trace_id: "id",
      short_id: SHORT_ID,
      owner_login: "alice",
      repo_full_name: null,
      pr_number: null,
      pr_url: null,
      pr_title: null,
      platform: "claude-code",
      byte_size: FIXTURE.length,
      message_count: 100,
      created_at: "2026-05-17T00:00:00Z",
      is_private: false,
    });

    renderAt(`/t/${SHORT_ID}`);

    await waitFor(() =>
      expect(screen.queryByText(/Loading trace/i)).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /^owner$/i }),
    ).not.toBeInTheDocument();
  });
});
