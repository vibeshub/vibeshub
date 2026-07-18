import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RepoAsk } from "../../components/repo/RepoAsk";
import type { AskEvent } from "../../types";

const askRepoMock = vi.fn();
vi.mock("../../api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../api")>();
  return { ...mod, askRepo: (...args: unknown[]) => askRepoMock(...args) };
});

function renderAsk(props: Partial<Parameters<typeof RepoAsk>[0]> = {}) {
  const onActiveChange = vi.fn();
  const utils = render(
    <MemoryRouter>
      <RepoAsk
        owner="alice"
        repo="x"
        traceCount={3}
        active={false}
        onActiveChange={onActiveChange}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onActiveChange, ...utils };
}

beforeEach(() => {
  askRepoMock.mockReset();
});

describe("RepoAsk", () => {
  it("renders nothing for a repo with zero traces", () => {
    const { container } = renderAsk({ traceCount: 0 });
    expect(container.innerHTML).toBe("");
  });

  it("renders the input for a repo with traces", () => {
    renderAsk();
    expect(
      screen.getByPlaceholderText("Ask about this repo"),
    ).toBeInTheDocument();
  });

  it("submits on Enter, streams status then answer with citations", async () => {
    askRepoMock.mockImplementation(
      async (
        _o: string, _r: string, _q: string,
        onEvent: (e: AskEvent) => void,
      ) => {
        onEvent({ kind: "status", text: "searching sessions" });
        onEvent({ kind: "delta", text: "Because the session decided." });
        onEvent({
          kind: "citations",
          citations: [{
            type: "chapter", title: "Frame the change",
            trace_short_id: "abc12345", anchor_uuid: "u1",
            pr_number: null, url: null,
          }],
        });
        onEvent({ kind: "done", best_effort: false });
      },
    );
    const { onActiveChange } = renderAsk({ active: true });
    const input = screen.getByPlaceholderText("Ask about this repo");
    await userEvent.type(input, "why is auth like this{Enter}");
    expect(onActiveChange).toHaveBeenCalledWith(true);
    await waitFor(() => {
      expect(
        screen.getByText(/Because the session decided/),
      ).toBeInTheDocument();
    });
    const link = screen.getByRole("link", { name: /Frame the change/ });
    expect(link).toHaveAttribute("href", "/t/abc12345#chapter-u1");
  });

  it("shows a sign-in button on github_auth_required", async () => {
    askRepoMock.mockImplementation(
      async (
        _o: string, _r: string, _q: string,
        onEvent: (e: AskEvent) => void,
      ) => {
        onEvent({
          kind: "error", code: "github_auth_required",
          message: "GitHub could not be reached for this ask.",
        });
      },
    );
    renderAsk({ active: true });
    const input = screen.getByPlaceholderText("Ask about this repo");
    await userEvent.type(input, "why{Enter}");
    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /sign in with github/i }),
      ).toBeInTheDocument();
    });
  });

  it("clears with Escape and deactivates", async () => {
    askRepoMock.mockResolvedValue(undefined);
    const { onActiveChange } = renderAsk({ active: true });
    const input = screen.getByPlaceholderText("Ask about this repo");
    await userEvent.type(input, "why{Enter}");
    await userEvent.keyboard("{Escape}");
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });

  it("ignores events after abort", async () => {
    let captured: {
      onEvent: (e: AskEvent) => void;
      signal: AbortSignal;
    } | null = null;
    askRepoMock.mockImplementation(
      (
        _o: string, _r: string, _q: string,
        onEvent: (e: AskEvent) => void,
        signal: AbortSignal,
      ) => {
        captured = { onEvent, signal };
        return new Promise<void>(() => {});
      },
    );
    renderAsk({ active: true });
    const input = screen.getByPlaceholderText("Ask about this repo");
    await userEvent.type(input, "why{Enter}");
    await waitFor(() => expect(captured).not.toBeNull());
    // Escape aborts the in-flight ask via close().
    await userEvent.keyboard("{Escape}");
    expect(captured!.signal.aborted).toBe(true);
    // A trailing event from the aborted stream must be ignored.
    captured!.onEvent({ kind: "delta", text: "stale trailing answer" });
    expect(screen.queryByText(/stale trailing answer/)).not.toBeInTheDocument();
  });
});
