import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { PrTracesList } from "../../routes/PrTracesList";

describe("PrTracesList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a list of traces from the API", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          traces: [
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
              created_at: "2026-05-08T00:00:00Z",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    render(
      <MemoryRouter initialEntries={["/alice/repo/pull/3"]}>
        <Routes>
          <Route
            path=":owner/:repo/pull/:number"
            element={<PrTracesList />}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByText(/Add the thing/i)).toBeInTheDocument()
    );
    expect(
      screen.getByRole("link", { name: /open trace abc1234567/i })
    ).toBeInTheDocument();
  });

  it("shows empty state when no traces exist", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ traces: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    render(
      <MemoryRouter initialEntries={["/alice/repo/pull/3"]}>
        <Routes>
          <Route
            path=":owner/:repo/pull/:number"
            element={<PrTracesList />}
          />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(screen.getByText(/No traces yet/i)).toBeInTheDocument()
    );
  });
});
