import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { VibeViewer } from "../../routes/VibeViewer";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../api", () => ({
  uploadTrace: vi.fn(),
  fetchTrace: vi.fn(),
  claimTrace: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public body: string,
    ) {
      super(`API ${status}: ${body}`);
    }
  },
}));

import { useAuth } from "../../auth/AuthContext";
import { uploadTrace, fetchTrace, claimTrace } from "../../api";

const mockUseAuth = useAuth as unknown as Mock;

const anon = { loading: false, user: null };
const signedIn = {
  loading: false,
  user: { id: "u1", login: "alice", name: "Alice", avatar_url: null },
};

const summary = {
  trace_id: "t1",
  short_id: "k3p9wq",
  owner_login: null,
  repo_full_name: null,
  pr_number: null,
  pr_url: null,
  pr_title: null,
  title: "Refactor Stripe webhook idempotency handler",
  platform: "claude-code",
  byte_size: 1234,
  message_count: 72,
  created_at: "2026-05-29T00:00:00Z",
  is_private: false,
  agent_count: 0,
  agents: [],
};

function renderPage(entries = ["/vibeviewer"]) {
  return render(
    <MemoryRouter initialEntries={entries}>
      <Routes>
        <Route path="vibeviewer" element={<VibeViewer />} />
        <Route path="t/:shortId" element={<div>trace view sentinel</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function fileInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

describe("VibeViewer", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    (uploadTrace as Mock).mockReset();
    (fetchTrace as Mock).mockReset();
    (claimTrace as Mock).mockReset();
    try {
      window.localStorage.clear();
    } catch {
      // ignore
    }
  });

  it("renders the idle hero, dropzone, and the three acquisition methods", () => {
    mockUseAuth.mockReturnValue(anon);
    renderPage();
    expect(screen.getByText(/Drop your transcript here/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Three ways to get your transcript/i),
    ).toBeInTheDocument();
    // "/export" appears both as the card name and inside its code block.
    expect(screen.getAllByText("/export").length).toBeGreaterThan(0);
    expect(screen.getByText(/Local session files/i)).toBeInTheDocument();
    expect(screen.getByText(/vibeshub plugin/i)).toBeInTheDocument();
    // anonymous nudge links to sign-in
    expect(
      screen.getByText(/show it on your profile/i),
    ).toBeInTheDocument();
  });

  it("pitches the solo show-off angle and points teams back to the main page", () => {
    mockUseAuth.mockReturnValue(anon);
    renderPage();
    // H1 text node before the highlighted span.
    expect(
      screen.getByText(/Show off how you actually/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/A link worth showing off/i)).toBeInTheDocument();
    expect(
      screen.getByText(/auto-posts these on every PR/i),
    ).toBeInTheDocument();
  });

  it("uploads anonymously and shows the live-trace success card with a copy prompt", async () => {
    mockUseAuth.mockReturnValue(anon);
    (uploadTrace as Mock).mockResolvedValue({
      trace_id: "t1",
      short_id: "k3p9wq",
      trace_url: "/t/k3p9wq",
      created: true,
      claim_token: "secret-token",
    });
    (fetchTrace as Mock).mockResolvedValue(summary);

    const { container } = renderPage();
    const file = new File(['{"type":"user"}\n'], "session.jsonl");
    fireEvent.change(fileInput(container), { target: { files: [file] } });

    await waitFor(
      () => expect(screen.getByText(/Your trace is live/i)).toBeInTheDocument(),
      { timeout: 3000 },
    );
    expect(uploadTrace).toHaveBeenCalledWith(
      expect.objectContaining({ isPrivate: false }),
    );
    // sample metadata from the fetched summary
    expect(screen.getByText(/72 msgs/)).toBeInTheDocument();
    // share slug + claim CTA for an anonymous upload
    expect(screen.getByText("k3p9wq")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /sign in to claim it/i }),
    ).toBeInTheDocument();
    // claim token stashed for the OAuth round trip
    expect(window.localStorage.getItem("vibeshub.claim.k3p9wq")).toBe(
      "secret-token",
    );
  });

  it("copies the shareable link to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    mockUseAuth.mockReturnValue(anon);
    (uploadTrace as Mock).mockResolvedValue({
      trace_id: "t1",
      short_id: "k3p9wq",
      trace_url: "/t/k3p9wq",
      created: true,
      claim_token: "secret-token",
    });
    (fetchTrace as Mock).mockResolvedValue(summary);

    const { container } = renderPage();
    fireEvent.change(fileInput(container), {
      target: { files: [new File(["{}\n"], "session.jsonl")] },
    });
    await waitFor(
      () => expect(screen.getByText(/Your trace is live/i)).toBeInTheDocument(),
      { timeout: 3000 },
    );

    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("/t/k3p9wq"),
    );
    expect(screen.getByText(/Copied!/)).toBeInTheDocument();
  });

  it("claims the trace onto a signed-in profile from the success card", async () => {
    mockUseAuth.mockReturnValue(signedIn);
    (uploadTrace as Mock).mockResolvedValue({
      trace_id: "t1",
      short_id: "k3p9wq",
      trace_url: "/t/k3p9wq",
      created: true,
      claim_token: "secret-token",
    });
    (fetchTrace as Mock).mockResolvedValue(summary);
    (claimTrace as Mock).mockResolvedValue({ ...summary, owner_login: "alice" });

    const { container } = renderPage();
    fireEvent.change(fileInput(container), {
      target: { files: [new File(["{}\n"], "session.jsonl")] },
    });
    await waitFor(
      () => expect(screen.getByText(/Your trace is live/i)).toBeInTheDocument(),
      { timeout: 3000 },
    );

    const claimBtn = screen.getByRole("button", {
      name: /claim to your profile/i,
    });
    fireEvent.click(claimBtn);
    await waitFor(() =>
      expect(claimTrace).toHaveBeenCalledWith("k3p9wq", "secret-token"),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /on your profile/i }),
      ).toBeInTheDocument(),
    );
  });

  it("rejects a non-transcript drop with guidance", async () => {
    mockUseAuth.mockReturnValue(anon);
    const { container } = renderPage();
    fireEvent.change(fileInput(container), {
      target: { files: [new File(["x"], "notes.pdf")] },
    });
    await waitFor(() =>
      expect(screen.getByText(/Drop a \.jsonl session file/i)).toBeInTheDocument(),
    );
    expect(uploadTrace).not.toHaveBeenCalled();
  });
});
