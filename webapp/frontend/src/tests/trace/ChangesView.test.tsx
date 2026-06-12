import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChangesView } from "../../components/trace/ChangesView";
import type { FileChange } from "../../components/trace/changes";
import type { Session } from "../../components/trace/types";

function makeSession(): Session {
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
    },
  };
}

const SURVIVING: FileChange = {
  path: "/r/src/a.ts",
  kind: "mod",
  adds: 2,
  dels: 1,
  groups: [
    {
      promptUuid: "p1",
      promptExcerpt: "fix the race",
      turnLabel: "turn 3",
      agentBadge: null,
      hunks: [
        {
          jumpUuid: "t1",
          ts: "2026-06-11T10:00:01Z",
          rows: [
            { kind: "del", oldNo: 1, newNo: null, text: "old line" },
            { kind: "add", oldNo: null, newNo: 1, text: "new line" },
            { kind: "add", oldNo: null, newNo: 2, text: "second line" },
          ],
          supersededBy: null,
        },
      ],
    },
  ],
};

const WITH_STUB: FileChange = {
  path: "/r/src/b.ts",
  kind: "new",
  adds: 1,
  dels: 0,
  groups: [
    {
      promptUuid: "p1",
      promptExcerpt: "first try",
      turnLabel: "turn 1",
      agentBadge: "Task[refactor]",
      hunks: [
        {
          jumpUuid: "t2",
          ts: "2026-06-11T10:00:02Z",
          rows: [{ kind: "add", oldNo: null, newNo: 1, text: "abandoned" }],
          supersededBy: { turnLabel: "turn 4" },
        },
      ],
    },
    {
      promptUuid: "p2",
      promptExcerpt: "redo it",
      turnLabel: "turn 4",
      agentBadge: null,
      hunks: [
        {
          jumpUuid: "t3",
          ts: "2026-06-11T10:00:03Z",
          rows: [{ kind: "add", oldNo: null, newNo: 1, text: "kept" }],
          supersededBy: null,
        },
      ],
    },
  ],
};

const NO_DATA: FileChange = {
  path: "/r/src/c.ts",
  kind: "mod",
  adds: 0,
  dels: 0,
  groups: [
    {
      promptUuid: null,
      promptExcerpt: "session start",
      turnLabel: "session start",
      agentBadge: null,
      hunks: [
        {
          jumpUuid: null,
          ts: "",
          rows: [],
          supersededBy: null,
        },
      ],
    },
  ],
};

describe("ChangesView", () => {
  afterEach(() => cleanup());

  it("renders the index strip with stats and a net total", () => {
    render(
      <ChangesView
        session={makeSession()}
        changes={[SURVIVING, WITH_STUB]}
        onJump={() => {}}
      />,
    );
    expect(screen.getByText("2 files · +3 −1 net")).toBeTruthy();
    expect(screen.getAllByText("/r/src/a.ts").length).toBeGreaterThan(0);
    expect(screen.getByText("new file")).toBeTruthy();
  });

  it("fires onJump with the hunk and prompt uuids from the caption", () => {
    const onJump = vi.fn();
    render(
      <ChangesView
        session={makeSession()}
        changes={[SURVIVING]}
        onJump={onJump}
      />,
    );
    fireEvent.click(screen.getByText("jump ↗"));
    expect(onJump).toHaveBeenCalledWith("t1", "p1");
  });

  it("shows captions with turn label and agent badge", () => {
    render(
      <ChangesView
        session={makeSession()}
        changes={[WITH_STUB]}
        onJump={() => {}}
      />,
    );
    expect(screen.getByText(/first try/)).toBeTruthy();
    expect(screen.getByText("turn 1")).toBeTruthy();
    expect(screen.getByText("via Task[refactor]")).toBeTruthy();
  });

  it("collapses superseded hunks behind an expandable stub", () => {
    render(
      <ChangesView
        session={makeSession()}
        changes={[WITH_STUB]}
        onJump={() => {}}
      />,
    );
    expect(screen.queryByText("abandoned")).toBeNull();
    const stub = screen.getByText(/superseded by turn 4/);
    fireEvent.click(stub);
    expect(screen.getByText("abandoned")).toBeTruthy();
  });

  it("renders a no-patch-data row for hunks without rows", () => {
    render(
      <ChangesView
        session={makeSession()}
        changes={[NO_DATA]}
        onJump={() => {}}
      />,
    );
    expect(screen.getByText("no patch data")).toBeTruthy();
    expect(screen.getAllByText("session start").length).toBeGreaterThan(0);
    expect(screen.queryByText("jump ↗")).toBeNull();
  });
});
