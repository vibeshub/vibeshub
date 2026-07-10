import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Hero } from "../../components/trace/Hero";
import type { Session } from "../../components/trace/types";
import type { TraceSummary } from "../../types";

export function makeSession(over: Partial<Session["meta"]> = {}): Session {
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

export function makeTrace(over: Partial<TraceSummary> = {}): TraceSummary {
  return {
    trace_id: "t1",
    short_id: "abc1234567",
    owner_login: "alice",
    repo_full_name: null,
    pr_number: null,
    pr_url: null,
    pr_title: null,
    title: null,
    platform: "cursor",
    byte_size: 1024,
    message_count: 5,
    created_at: "2026-07-09T10:00:00Z",
    is_private: false,
    agent_count: 0,
    agents: [],
    ...over,
  };
}

export function renderHero(session: Session, trace: TraceSummary) {
  return render(
    <MemoryRouter>
      <Hero
        session={session}
        trace={trace}
        rawHref="#raw"
        subagents={[]}
        subagentsLoading={false}
      />
    </MemoryRouter>,
  );
}

describe("Hero eyebrow", () => {
  afterEach(() => cleanup());

  it("never renders back-to-back separators when the session id is missing", () => {
    const { container } = renderHero(
      makeSession({ sessionId: null, startedAt: "2026-07-09T12:41:00Z" }),
      makeTrace(),
    );
    const eyebrow = container.querySelector(".hero-eyebrow");
    expect(eyebrow).not.toBeNull();
    expect(eyebrow!.textContent).not.toMatch(/·\s*·/);
  });

  it("keeps the id when present", () => {
    const { container } = renderHero(
      makeSession({ sessionId: "abcd1234efgh" }),
      makeTrace(),
    );
    expect(container.querySelector(".hero-eyebrow")!.textContent).toContain(
      "SESSION · abcd1234",
    );
  });
});
