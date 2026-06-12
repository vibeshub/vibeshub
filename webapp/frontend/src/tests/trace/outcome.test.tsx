import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

describe("Outcome Active Time", () => {
  afterEach(() => cleanup());

  it("shows 'not available' for text-import traces", () => {
    renderOutcome(makeSession({ sourceFormat: "terminal" }), makeTrace());
    expect(screen.getByText(/not available for text imports/i)).toBeTruthy();
    expect(screen.queryByText(/^wall:/)).toBeNull();
  });

  it("shows a duration and wall time for ordinary traces", () => {
    const session = makeSession({
      assistantThinkMs: 5000,
      startedAt: "2026-05-20T10:00:00Z",
      endedAt: "2026-05-20T10:01:00Z",
    });
    renderOutcome(session, makeTrace());
    expect(screen.queryByText(/not available for text imports/i)).toBeNull();
    expect(screen.getByText(/^wall:/)).toBeTruthy();
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
});
