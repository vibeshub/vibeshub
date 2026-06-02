import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { HeroTitle } from "../../components/trace/HeroTitle";
import type { TraceSummary } from "../../types";
import * as api from "../../api";

vi.mock("../../api");

function makeTrace(over: Partial<TraceSummary> = {}): TraceSummary {
  return {
    trace_id: "t1",
    short_id: "abc1234567",
    owner_login: "alice",
    repo_full_name: null,
    pr_number: null,
    pr_url: null,
    pr_title: null,
    title: null,
    platform: "web",
    byte_size: 1024,
    message_count: 5,
    created_at: "2026-05-20T10:00:00Z",
    is_private: false,
    agent_count: 0,
    agents: [],
    ...over,
  };
}

describe("HeroTitle", () => {
  afterEach(() => cleanup());

  it("prefers trace.title over aiTitle and the fallback", () => {
    render(
      <HeroTitle
        trace={makeTrace({ title: "Custom title" })}
        aiTitle="AI title"
        firstPrompt="first prompt"
        canEdit={false}
        onUpdated={() => {}}
      />,
    );
    expect(screen.getByRole("heading").textContent).toContain("Custom title");
  });

  it("falls back to aiTitle, then the first prompt, then Untitled session", () => {
    const { rerender } = render(
      <HeroTitle
        trace={makeTrace()}
        aiTitle="AI title"
        firstPrompt="first prompt"
        canEdit={false}
        onUpdated={() => {}}
      />,
    );
    expect(screen.getByRole("heading").textContent).toContain("AI title");
    rerender(
      <HeroTitle
        trace={makeTrace()}
        aiTitle={null}
        firstPrompt="first prompt"
        canEdit={false}
        onUpdated={() => {}}
      />,
    );
    expect(screen.getByRole("heading").textContent).toContain("first prompt");
    rerender(
      <HeroTitle
        trace={makeTrace()}
        aiTitle={null}
        firstPrompt={null}
        canEdit={false}
        onUpdated={() => {}}
      />,
    );
    expect(screen.getByRole("heading").textContent).toContain(
      "Untitled session",
    );
  });

  it("derives the title from the first prompt for title-less traces", () => {
    render(
      <HeroTitle
        trace={makeTrace()}
        aiTitle={null}
        firstPrompt="can you update the UI with the new plugin version 0.4.0"
        canEdit={false}
        onUpdated={() => {}}
      />,
    );
    expect(screen.getByRole("heading").textContent).toBe(
      "can you update the UI with the new plugin version 0.4.0",
    );
  });

  it("collapses whitespace and truncates a long first prompt", () => {
    const long =
      "Please refactor\nthe entire authentication module so that it supports OAuth, SAML, and passkeys without breaking existing sessions";
    render(
      <HeroTitle
        trace={makeTrace()}
        aiTitle={null}
        firstPrompt={long}
        canEdit={false}
        onUpdated={() => {}}
      />,
    );
    const text = screen.getByRole("heading").textContent ?? "";
    expect(text).not.toContain("\n");
    expect(text).toMatch(/^Please refactor the entire/);
    expect(text.endsWith("…")).toBe(true);
    // Truncated well short of the raw prompt, never cutting mid-word: the
    // kept portion is a whole-word prefix of the collapsed prompt.
    expect(text.length).toBeLessThanOrEqual(82);
    const collapsed = long.replace(/\s+/g, " ");
    const kept = text.slice(0, -1);
    expect(collapsed.startsWith(kept)).toBe(true);
    expect(collapsed[kept.length]).toBe(" ");
  });

  it("hides the edit button for non-owners", () => {
    render(
      <HeroTitle
        trace={makeTrace()}
        aiTitle={null}
        firstPrompt={null}
        canEdit={false}
        onUpdated={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /edit title/i })).toBeNull();
  });

  it("lets an owner edit and save the title", async () => {
    const updated = makeTrace({ title: "New title" });
    vi.mocked(api.patchTrace).mockResolvedValue(updated);
    const onUpdated = vi.fn();
    render(
      <HeroTitle
        trace={makeTrace()}
        aiTitle={null}
        firstPrompt={null}
        canEdit
        onUpdated={onUpdated}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit title/i }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(api.patchTrace).toHaveBeenCalledWith("abc1234567", {
        title: "New title",
      }),
    );
    expect(onUpdated).toHaveBeenCalledWith(updated);
  });

  it("keeps the editor open and shows an error when save fails", async () => {
    vi.mocked(api.patchTrace).mockRejectedValue(new Error("boom"));
    const onUpdated = vi.fn();
    render(
      <HeroTitle
        trace={makeTrace()}
        aiTitle={null}
        firstPrompt={null}
        canEdit
        onUpdated={onUpdated}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit title/i }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "New title" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(onUpdated).not.toHaveBeenCalled();
    // Still in edit mode: the textbox is still present.
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("cancel exits edit mode without calling the API", () => {
    render(
      <HeroTitle
        trace={makeTrace({ title: "Original" })}
        aiTitle={null}
        firstPrompt={null}
        canEdit
        onUpdated={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit title/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(api.patchTrace).not.toHaveBeenCalled();
    expect(screen.getByRole("heading").textContent).toContain("Original");
  });
});
