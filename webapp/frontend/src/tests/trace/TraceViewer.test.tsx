import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TraceViewer } from "../../components/trace/TraceViewer";
import type { Session, StreamEvent } from "../../components/trace/types";
import type { TraceSummary } from "../../types";

function makeSession(stream: StreamEvent[]): Session {
  return {
    stream,
    meta: {
      sessionId: "s1",
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
      userPromptCount: 1,
      assistantTextCount: 0,
      agents: [],
    },
  };
}

function makeTrace(): TraceSummary {
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
    created_at: "2026-06-11T10:00:00Z",
    is_private: false,
    agent_count: 0,
    agents: [],
  };
}

const EDIT_STREAM: StreamEvent[] = [
  {
    kind: "user_prompt",
    text: "tighten the parser",
    ts: "2026-06-11T10:00:01Z",
    uuid: "p1",
  },
  {
    kind: "tool_use",
    name: "Edit",
    input: { file_path: "/r/src/x.ts", old_string: "a", new_string: "b" },
    id: "id-t1",
    ts: "2026-06-11T10:00:02Z",
    msgId: "m1",
    uuid: "t1",
    result: null,
  },
];

function renderViewer(stream: StreamEvent[]) {
  return render(
    <MemoryRouter>
      <TraceViewer
        trace={makeTrace()}
        session={makeSession(stream)}
        shortId="abc1234567"
        rawHref="/raw"
      />
    </MemoryRouter>,
  );
}

describe("TraceViewer changes mode", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    // vitest's jsdom usually provides rAF; the jump effect needs it either way.
    if (typeof window.requestAnimationFrame !== "function") {
      window.requestAnimationFrame = (cb) => {
        cb(0);
        return 0;
      };
    }
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => cleanup());

  it("hides the pills when the session has no file edits", () => {
    renderViewer([EDIT_STREAM[0]]);
    expect(screen.queryByRole("tab", { name: "Changes" })).toBeNull();
  });

  it("switches to the changes view and back", () => {
    renderViewer(EDIT_STREAM);
    expect(screen.getByText("Show system events")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    expect(window.location.hash).toBe("#changes");
    // The path renders twice (index strip + card header), so getAllByText.
    expect(screen.getAllByText("/r/src/x.ts").length).toBeGreaterThan(0);
    expect(screen.queryByText("Show system events")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Conversation" }));
    expect(window.location.hash).toBe("");
    expect(screen.getByText("Show system events")).toBeTruthy();
  });

  it("starts in changes mode when the URL hash is #changes", () => {
    window.history.replaceState(null, "", "/#changes");
    renderViewer(EDIT_STREAM);
    expect(screen.getAllByText("/r/src/x.ts").length).toBeGreaterThan(0);
  });

  it("jump returns to conversation mode and clears the hash", () => {
    renderViewer(EDIT_STREAM);
    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    fireEvent.click(screen.getByText("jump ↗"));
    expect(window.location.hash).toBe("");
    expect(screen.getByText("Show system events")).toBeTruthy();
  });
});
