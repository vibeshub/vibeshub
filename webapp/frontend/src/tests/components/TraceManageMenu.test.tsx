import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { TraceManageMenu } from "../../components/TraceManageMenu";
import type { TraceSummary } from "../../types";

vi.mock("../../api", () => ({
  patchTrace: vi.fn(),
  deleteTrace: vi.fn(),
  fetchMyRepos: vi.fn(),
  fetchRepoPrs: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public body: string,
    ) {
      super(`API ${status}: ${body}`);
    }
  },
}));

import { patchTrace, deleteTrace, fetchMyRepos } from "../../api";

const standaloneTrace: TraceSummary = {
  trace_id: "t1",
  short_id: "abc1234567",
  owner_login: "alice",
  repo_full_name: null,
  pr_number: null,
  pr_url: null,
  pr_title: null,
  platform: "claude-code",
  byte_size: 100,
  message_count: 5,
  created_at: "2026-05-22T00:00:00Z",
  is_private: false,
  agent_count: 0,
  agents: [],
};

const repoTrace: TraceSummary = {
  ...standaloneTrace,
  repo_full_name: "alice/repo",
  pr_number: 7,
  pr_url: "https://github.com/alice/repo/pull/7",
  pr_title: "Add a thing",
};

describe("TraceManageMenu", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (patchTrace as Mock).mockReset();
    (deleteTrace as Mock).mockReset();
    (fetchMyRepos as Mock).mockReset();
  });

  it("toggles privacy on a standalone trace", async () => {
    (patchTrace as Mock).mockResolvedValue({
      ...standaloneTrace,
      is_private: true,
    });
    const onUpdated = vi.fn();
    render(
      <TraceManageMenu
        trace={standaloneTrace}
        onUpdated={onUpdated}
        onDeleted={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /make private/i }));
    await waitFor(() =>
      expect(patchTrace).toHaveBeenCalledWith(standaloneTrace.short_id, {
        is_private: true,
      }),
    );
    expect(onUpdated).toHaveBeenCalled();
  });

  it("disables the privacy toggle for a repo-associated trace", () => {
    render(
      <TraceManageMenu
        trace={repoTrace}
        onUpdated={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    const toggle = screen.getByRole("button", { name: /private/i });
    expect(toggle).toBeDisabled();
    expect(screen.getByText(/mirrors github/i)).toBeInTheDocument();
  });

  it("requires confirmation before deleting", async () => {
    (deleteTrace as Mock).mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    render(
      <TraceManageMenu
        trace={standaloneTrace}
        onUpdated={vi.fn()}
        onDeleted={onDeleted}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^delete/i }));
    expect(deleteTrace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() =>
      expect(deleteTrace).toHaveBeenCalledWith(standaloneTrace.short_id),
    );
    expect(onDeleted).toHaveBeenCalled();
  });

  it("links a repo via the embedded picker", async () => {
    (fetchMyRepos as Mock).mockResolvedValue([
      { full_name: "alice/repo", name: "repo", private: false },
    ]);
    (patchTrace as Mock).mockResolvedValue({
      ...standaloneTrace,
      repo_full_name: "alice/repo",
    });
    const onUpdated = vi.fn();
    render(
      <TraceManageMenu
        trace={standaloneTrace}
        onUpdated={onUpdated}
        onDeleted={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /edit association/i }),
    );
    fireEvent.change(screen.getByPlaceholderText(/search.*repo/i), {
      target: { value: "rep" },
    });
    await waitFor(() => screen.getByText("alice/repo"));
    fireEvent.click(screen.getByText("alice/repo"));
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    await waitFor(() =>
      expect(patchTrace).toHaveBeenCalledWith(standaloneTrace.short_id, {
        repo_full_name: "alice/repo",
      }),
    );
    expect(onUpdated).toHaveBeenCalled();
  });

  it("clears the association by applying a standalone selection", async () => {
    (patchTrace as Mock).mockResolvedValue(standaloneTrace);
    const onUpdated = vi.fn();
    render(
      <TraceManageMenu
        trace={repoTrace}
        onUpdated={onUpdated}
        onDeleted={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /edit association/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /clear|standalone/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    await waitFor(() =>
      expect(patchTrace).toHaveBeenCalledWith(repoTrace.short_id, {
        repo_full_name: null,
        pr_url: null,
      }),
    );
    expect(onUpdated).toHaveBeenCalled();
  });
});
