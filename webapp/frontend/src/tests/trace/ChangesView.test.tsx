import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChangesView } from "../../components/trace/ChangesView";
import type {
  ChapterChange,
  FileChange,
} from "../../components/trace/changes";
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

const BIG: FileChange = {
  path: "/r/src/big.ts",
  kind: "new",
  adds: 60,
  dels: 0,
  groups: [
    {
      promptUuid: "p1",
      promptExcerpt: "write it all",
      turnLabel: "turn 1",
      agentBadge: null,
      hunks: [
        {
          jumpUuid: "t9",
          ts: "2026-06-11T10:00:04Z",
          rows: Array.from({ length: 60 }, (_, i) => ({
            kind: "add" as const,
            oldNo: null,
            newNo: i + 1,
            text: `line ${i + 1}`,
          })),
          supersededBy: null,
        },
      ],
    },
  ],
};

const CHAPTERS: ChapterChange[] = [
  {
    anchorUuid: "ch1",
    title: "Initial brainstorm",
    caption: "Settled the layout and the data shape.",
    ordinal: 1,
    adds: 2,
    dels: 1,
    files: [SURVIVING],
  },
  {
    anchorUuid: "ch2",
    title: "Quiet chapter",
    caption: "",
    ordinal: 2,
    adds: 0,
    dels: 0,
    files: [],
  },
  {
    anchorUuid: "ch3",
    title: "Implementation",
    caption: "",
    ordinal: 3,
    adds: 1,
    dels: 0,
    files: [WITH_STUB],
  },
];

describe("ChangesView", () => {
  afterEach(() => cleanup());

  it("renders the net summary and folds the file index behind a toggle", () => {
    const { container } = render(
      <ChangesView
        session={makeSession()}
        changes={[SURVIVING, WITH_STUB]}
        chapters={null}
        onJump={() => {}}
      />,
    );
    const summary = container.querySelector(".changes-summary-line")!;
    expect(summary.textContent).toContain("2 files changed");
    expect(summary.textContent).toContain("+3");
    expect(summary.textContent).toContain("−1");
    // Index hidden until toggled.
    expect(screen.queryByRole("navigation")).toBeNull();
    fireEvent.click(screen.getByText("show files"));
    expect(screen.getAllByText("/r/src/a.ts").length).toBeGreaterThan(0);
    expect(screen.getByText("new file")).toBeTruthy();
  });

  it("fires onJump with the hunk and prompt uuids from the caption", () => {
    const onJump = vi.fn();
    render(
      <ChangesView
        session={makeSession()}
        changes={[SURVIVING]}
        chapters={null}
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
        chapters={null}
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
        chapters={null}
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
        chapters={null}
        onJump={() => {}}
      />,
    );
    expect(screen.getByText("no patch data")).toBeTruthy();
    expect(screen.getAllByText("session start").length).toBeGreaterThan(0);
    expect(screen.queryByText("jump ↗")).toBeNull();
  });

  it("folds large hunks behind a show-more expander", () => {
    // Prism splits row text across token spans, so assert on textContent.
    const { container } = render(
      <ChangesView
        session={makeSession()}
        changes={[BIG]}
        chapters={null}
        onJump={() => {}}
      />,
    );
    const text = () => container.textContent ?? "";
    expect(text()).toContain("line 1");
    expect(text()).not.toContain("line 60");
    fireEvent.click(screen.getByText(/show 36 more lines/));
    expect(text()).toContain("line 60");
    fireEvent.click(screen.getByText(/collapse/));
    expect(text()).not.toContain("line 60");
  });
});

describe("ChangesView chapter mode", () => {
  afterEach(() => cleanup());

  it("renders a section per non-empty chapter with stats and caption", () => {
    const { container } = render(
      <ChangesView
        session={makeSession()}
        changes={[SURVIVING, WITH_STUB]}
        chapters={CHAPTERS}
        onJump={() => {}}
      />,
    );
    expect(screen.getByText("Initial brainstorm")).toBeTruthy();
    expect(screen.getByText("Implementation")).toBeTruthy();
    expect(
      screen.getByText("Settled the layout and the data shape."),
    ).toBeTruthy();
    // Empty chapters are skipped in the body.
    expect(screen.queryByText("Quiet chapter")).toBeNull();
    expect(container.querySelector("#changes-chapter-ch1")).toBeTruthy();
    expect(container.querySelector("#changes-chapter-ch3")).toBeTruthy();
  });

  it("jumps to the conversation from a chapter head", () => {
    const onJump = vi.fn();
    render(
      <ChangesView
        session={makeSession()}
        changes={[SURVIVING, WITH_STUB]}
        chapters={CHAPTERS}
        onJump={onJump}
      />,
    );
    fireEvent.click(screen.getAllByText("read ↗")[0]);
    expect(onJump).toHaveBeenCalledWith("ch1", "ch1");
  });

  it("gives the file anchor id only to a path's first card", () => {
    const twice: ChapterChange[] = [
      { ...CHAPTERS[0], files: [SURVIVING] },
      { ...CHAPTERS[2], files: [{ ...SURVIVING, kind: "mod" }] },
    ];
    const { container } = render(
      <ChangesView
        session={makeSession()}
        changes={[SURVIVING]}
        chapters={twice}
        onJump={() => {}}
      />,
    );
    const anchored = container.querySelectorAll("#change--r-src-a-ts");
    expect(anchored).toHaveLength(1);
  });
});
