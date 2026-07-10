import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetaLine } from "../../components/trace/Hero";
import type { Session } from "../../components/trace/types";

function makeSession(over: Partial<Session["meta"]>): Session {
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

describe("MetaLine", () => {
  it("shows the import chip and modelLabel for terminal traces", () => {
    render(
      <MetaLine
        session={makeSession({
          sourceFormat: "terminal",
          modelLabel: "Opus 4.8",
        })}
      />,
    );
    expect(screen.getByText(/Imported from text export/i)).toBeTruthy();
    expect(screen.getByText("Opus 4.8")).toBeTruthy();
  });

  it("renders no chip for an ordinary trace", () => {
    render(<MetaLine session={makeSession({ model: "claude-opus-4-8" })} />);
    expect(screen.queryByText(/Imported from text export/i)).toBeNull();
  });

  it("renders no platform chip for cursor or codex traces (platform lives in the eyebrow)", () => {
    const { container } = render(
      <MetaLine session={makeSession({ sourceFormat: "cursor" })} />,
    );
    expect(screen.queryByText("Cursor")).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});
