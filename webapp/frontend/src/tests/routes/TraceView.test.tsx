import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TraceView } from "../../routes/TraceView";

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
});
