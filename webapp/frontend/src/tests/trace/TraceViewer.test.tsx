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
    // Deterministic rAF: run the jump effect's callback synchronously so the
    // scroll assertion below doesn't race a real animation frame.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("hides the pills and shows the conversation when there are no edits", () => {
    renderViewer([EDIT_STREAM[0]]);
    expect(screen.queryByRole("tab", { name: "Changes" })).toBeNull();
    expect(screen.getByText("Show system events")).toBeTruthy();
  });

  it("defaults to the changes view when the session has edits", () => {
    renderViewer(EDIT_STREAM);
    expect(screen.getAllByText("/r/src/x.ts").length).toBeGreaterThan(0);
    expect(screen.queryByText("Show system events")).toBeNull();
  });

  it("switches to the conversation and back, tracking the #chat hash", () => {
    renderViewer(EDIT_STREAM);
    // Tab labels now carry a count chip ("Conversation 1 prompts"), so match
    // by the leading label rather than the exact accessible name.
    fireEvent.click(screen.getByRole("tab", { name: /Conversation/ }));
    expect(window.location.hash).toBe("#chat");
    expect(screen.getByText("Show system events")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /Changes/ }));
    expect(window.location.hash).toBe("");
    expect(screen.getAllByText("/r/src/x.ts").length).toBeGreaterThan(0);
  });

  it("starts in conversation mode when the URL hash is #chat", () => {
    window.history.replaceState(null, "", "/#chat");
    renderViewer(EDIT_STREAM);
    expect(screen.getByText("Show system events")).toBeTruthy();
  });

  it("still lands on changes for legacy #changes links", () => {
    window.history.replaceState(null, "", "/#changes");
    renderViewer(EDIT_STREAM);
    expect(screen.getAllByText("/r/src/x.ts").length).toBeGreaterThan(0);
  });

  it("jump returns to conversation mode and scrolls to the edit", () => {
    renderViewer(EDIT_STREAM);
    // The per-hunk ↗ header was removed when files merged into one block.
    // Select a blame row to open its provenance panel, then use the panel's
    // "open this edit in the conversation" button (same jump handler).
    const row = document.querySelector('.prov-ln[role="button"]');
    expect(row).not.toBeNull();
    fireEvent.click(row as Element);
    fireEvent.click(screen.getByText(/open this edit in the conversation/));
    expect(window.location.hash).toBe("#chat");
    expect(screen.getByText("Show system events")).toBeTruthy();
    // Collapsed tool groups render no [data-uuid] for tools, so the jump
    // falls back to the prompt card and must still scroll.
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
