import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { RepoPrPicker } from "../../components/RepoPrPicker";

vi.mock("../../api", () => ({
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

import { fetchMyRepos, fetchRepoPrs, ApiError } from "../../api";

describe("RepoPrPicker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (fetchMyRepos as Mock).mockReset();
    (fetchRepoPrs as Mock).mockReset();
  });

  it("lists repos and reports a repo selection", async () => {
    (fetchMyRepos as Mock).mockResolvedValue([
      { full_name: "alice/repo", name: "repo", private: false },
    ]);
    const onChange = vi.fn();
    render(<RepoPrPicker value={{ kind: "none" }} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/search.*repo/i), {
      target: { value: "rep" },
    });
    await waitFor(() => screen.getByText("alice/repo"));
    fireEvent.click(screen.getByText("alice/repo"));
    expect(onChange).toHaveBeenCalledWith({
      kind: "repo",
      repoFullName: "alice/repo",
    });
  });

  it("reveals PR search after a repo is chosen and reports a PR selection", async () => {
    (fetchMyRepos as Mock).mockResolvedValue([
      { full_name: "alice/repo", name: "repo", private: false },
    ]);
    (fetchRepoPrs as Mock).mockResolvedValue([
      { number: 7, title: "Add a thing", html_url: "https://x/pull/7" },
    ]);
    const onChange = vi.fn();
    render(<RepoPrPicker value={{ kind: "none" }} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/search.*repo/i), {
      target: { value: "rep" },
    });
    await waitFor(() => screen.getByText("alice/repo"));
    fireEvent.click(screen.getByText("alice/repo"));

    const prInput = await screen.findByPlaceholderText(/search.*pull/i);
    fireEvent.change(prInput, { target: { value: "thing" } });
    await waitFor(() => screen.getByText(/Add a thing/));
    fireEvent.click(screen.getByText(/Add a thing/));
    expect(onChange).toHaveBeenCalledWith({
      kind: "pr",
      prUrl: "https://x/pull/7",
      repoFullName: "alice/repo",
    });
  });

  it("clears back to a standalone selection", async () => {
    (fetchMyRepos as Mock).mockResolvedValue([
      { full_name: "alice/repo", name: "repo", private: false },
    ]);
    const onChange = vi.fn();
    render(<RepoPrPicker value={{ kind: "none" }} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/search.*repo/i), {
      target: { value: "rep" },
    });
    await waitFor(() => screen.getByText("alice/repo"));
    fireEvent.click(screen.getByText("alice/repo"));

    const clear = await screen.findByRole("button", {
      name: /clear|standalone/i,
    });
    fireEvent.click(clear);
    expect(onChange).toHaveBeenLastCalledWith({ kind: "none" });
  });

  it("disables the inputs when disabled", () => {
    render(
      <RepoPrPicker value={{ kind: "none" }} onChange={vi.fn()} disabled />,
    );
    expect(screen.getByPlaceholderText(/search.*repo/i)).toBeDisabled();
  });

  it("shows an inline error when the repo search fails", async () => {
    (fetchMyRepos as Mock).mockRejectedValue(new ApiError(500, "boom"));
    render(<RepoPrPicker value={{ kind: "none" }} onChange={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/search.*repo/i), {
      target: { value: "rep" },
    });
    await waitFor(() => expect(screen.getByText(/boom/i)).toBeInTheDocument());
  });
});
