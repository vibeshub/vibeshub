import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Timeline } from "../../components/trace/Timeline";
import type { Session, StreamEvent } from "../../components/trace/types";

function makeSession(startedAt: string | null, endedAt: string | null): Session {
  const stream: StreamEvent[] = [
    {
      kind: "tool_use", name: "Read", input: {}, id: "t1",
      ts: startedAt ?? "", msgId: "m", uuid: "t1", result: null,
    },
    {
      kind: "tool_use", name: "Bash", input: {}, id: "t2",
      ts: endedAt ?? "", msgId: "m", uuid: "t2", result: null,
    },
  ];
  return {
    stream,
    meta: {
      sessionId: "s", aiTitle: null, firstPrompt: null, cwd: null,
      gitBranch: null, model: null, modelLabel: null, sourceFormat: null,
      version: null, permissionMode: null, startedAt, endedAt,
      prLink: null,
      tokens: { input: 0, cacheCreate: 0, cacheRead: 0, output: 0 },
      assistantThinkMs: 0, toolCounts: {}, toolCallCount: 2,
      userPromptCount: 0, assistantTextCount: 0, agents: [],
    },
  };
}

describe("Timeline", () => {
  it("renders nothing for sessions shorter than ten minutes", () => {
    const { container } = render(
      <Timeline
        session={makeSession("2026-07-09T12:41:00Z", "2026-07-09T12:44:00Z")}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when timestamps are missing", () => {
    const { container } = render(<Timeline session={makeSession(null, null)} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the chart for sessions with enough span to read", () => {
    const { container } = render(
      <Timeline
        session={makeSession("2026-07-09T12:00:00Z", "2026-07-09T12:30:00Z")}
      />,
    );
    expect(container.firstChild).not.toBeNull();
  });
});
