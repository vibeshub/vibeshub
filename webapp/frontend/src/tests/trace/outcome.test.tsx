import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Outcome } from "../../components/trace/Outcome";
import type { Session } from "../../components/trace/types";
import type { TraceSummary } from "../../types";

function makeSession(over: Partial<Session["meta"]> = {}): Session {
  return {
    stream: [],
    meta: {
      sessionId: null,
      aiTitle: null,
      firstPrompt: null,
      cwd: null,
      gitBranch: null,
      model: null,
      modelLabel: null,
      sourceFormat: null,
      version: null,
      permissionMode: null,
      startedAt: null,
      endedAt: null,
      prLink: null,
      tokens: { input: 0, cacheCreate: 0, cacheRead: 0, output: 0 },
      assistantThinkMs: 0,
      toolCounts: {},
      toolCallCount: 0,
      userPromptCount: 0,
      assistantTextCount: 0,
      agents: [],
      ...over,
    },
  };
}

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

function renderOutcome(session: Session, trace: TraceSummary) {
  return render(
    <MemoryRouter>
      <Outcome
        session={session}
        trace={trace}
        subagents={[]}
        subagentsLoading={false}
      />
    </MemoryRouter>,
  );
}

describe("Outcome result", () => {
  afterEach(() => cleanup());

  it("renders no stat grid (session metadata lives in the hero strip)", () => {
    const { container } = renderOutcome(
      makeSession({ assistantThinkMs: 5000 }),
      makeTrace(),
    );
    expect(container.querySelector(".outcome-stats")).toBeNull();
    expect(screen.queryByText(/Active Time/i)).toBeNull();
    expect(screen.queryByText(/distinct tools/i)).toBeNull();
  });

  it("links the result status straight to the PR", () => {
    renderOutcome(
      makeSession(),
      makeTrace({
        pr_number: 154,
        pr_url: "https://github.com/acme/site/pull/154",
        pr_title: "Default trace viewer to Conversation tab",
      }),
    );
    const link = screen.getByRole("link", { name: /linked pr #154/i });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/acme/site/pull/154",
    );
    // The PR title lives in the hero chip; the card does not repeat it.
    expect(screen.queryByText("Default trace viewer to Conversation tab")).toBeNull();
  });

  it("keeps the standalone-session status for PR-less traces", () => {
    renderOutcome(makeSession(), makeTrace());
    expect(screen.getByText(/standalone session/i)).toBeTruthy();
  });
});

describe("Outcome files touched", () => {
  afterEach(() => cleanup());

  it("counts apply_patch as a touched file", () => {
    const session = makeSession({
      sourceFormat: "codex",
      toolCounts: { apply_patch: 1 },
      toolCallCount: 1,
    });
    session.stream = [
      {
        kind: "tool_use",
        name: "apply_patch",
        id: "c2",
        input: { file_path: "src/a.ts" },
        ts: "",
        result: null,
      } as unknown as Session["stream"][number],
    ];
    renderOutcome(session, makeTrace({ agents: [] }));
    expect(screen.getByText(/a\.ts/)).toBeTruthy();
  });

  it("opens the diff when a touched file is clicked", () => {
    const onOpenFile = vi.fn();
    const session = makeSession({ toolCounts: { Edit: 1 }, toolCallCount: 1 });
    session.stream = [
      {
        kind: "tool_use",
        name: "Edit",
        id: "e1",
        input: { file_path: "/repo/src/a.ts" },
        ts: "",
        result: null,
      } as unknown as Session["stream"][number],
    ];
    render(
      <MemoryRouter>
        <Outcome
          session={session}
          trace={makeTrace()}
          subagents={[]}
          subagentsLoading={false}
          onOpenFile={onOpenFile}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /a\.ts/ }));
    expect(onOpenFile).toHaveBeenCalledWith("/repo/src/a.ts");
  });
});
