import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChapterRail } from "../../components/trace/ChapterRail";
import type { Session, StreamEvent } from "../../components/trace/types";
import type { TraceDigest } from "../../types";

function sessionWith(stream: StreamEvent[]): Session {
  return {
    meta: {
      sessionId: "s", aiTitle: null, firstPrompt: null, cwd: null,
      gitBranch: null, model: null, modelLabel: null, sourceFormat: null,
      version: null, permissionMode: null, startedAt: null, endedAt: null,
      prLink: null,
      tokens: { input: 0, cacheCreate: 0, cacheRead: 0, output: 0 },
      assistantThinkMs: 0, toolCounts: {}, toolCallCount: 0,
      userPromptCount: 0, assistantTextCount: 0, agents: [],
    },
    stream,
  };
}

const up = (uuid: string, ts: string): StreamEvent =>
  ({ kind: "user_prompt", text: "x", ts, uuid }) as StreamEvent;
const tool = (uuid: string, ts: string): StreamEvent =>
  ({
    kind: "tool_use", name: "Bash", input: {}, id: uuid, ts, msgId: "m",
    uuid, result: null,
  }) as StreamEvent;

const digest = (chapters: TraceDigest["chapters"]): TraceDigest =>
  ({ ask: "a", decisions: "d", files: "f", tests: "t", dead_ends: "e", chapters });

const STREAM: StreamEvent[] = [
  up("a", "2026-01-01T00:00:00Z"),
  tool("t1", "2026-01-01T00:00:10Z"),
  up("b", "2026-01-01T00:01:00Z"),
  tool("t2", "2026-01-01T00:01:10Z"),
  tool("t3", "2026-01-01T00:01:20Z"),
];
const TWO = digest([
  { anchor_uuid: "a", title: "First", caption: "" },
  { anchor_uuid: "b", title: "Second", caption: "" },
]);

describe("ChapterRail", () => {
  it("renders a row per chapter with tool-count and duration meta", () => {
    render(<ChapterRail session={sessionWith(STREAM)} digest={TWO} />);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.getByText("1t · 1m")).toBeInTheDocument();
    expect(screen.getByText("2t · 20s")).toBeInTheDocument();
  });

  it("sizes bars relative to the longest chapter (longest = 100%)", () => {
    const { container } = render(
      <ChapterRail session={sessionWith(STREAM)} digest={TWO} />,
    );
    const fills = container.querySelectorAll<HTMLElement>(".chapterrail-fill");
    expect(fills[0].style.width).toBe("100%");
    const w2 = parseFloat(fills[1].style.width);
    expect(w2).toBeGreaterThan(0);
    expect(w2).toBeLessThan(100);
  });

  it("scrolls to the chapter divider on click", async () => {
    const user = userEvent.setup();
    const scrollSpy = vi.fn();
    vi.spyOn(document, "getElementById").mockImplementation((id) =>
      id === "chapter-a" ? ({ scrollIntoView: scrollSpy } as unknown as HTMLElement) : null,
    );
    render(<ChapterRail session={sessionWith(STREAM)} digest={TWO} />);
    await user.click(screen.getByText("First"));
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("shows tool count only when timestamps are missing", () => {
    render(
      <ChapterRail
        session={sessionWith([up("a", ""), tool("t1", ""), tool("t2", "")])}
        digest={digest([{ anchor_uuid: "a", title: "Only", caption: "" }])}
      />,
    );
    expect(screen.getByText("2t")).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  it("renders an unresolved-anchor chapter title-only (never dropped)", () => {
    const { container } = render(
      <ChapterRail
        session={sessionWith([up("a", "2026-01-01T00:00:00Z")])}
        digest={digest([{ anchor_uuid: "ghost", title: "Ghost", caption: "" }])}
      />,
    );
    expect(screen.getByText("Ghost")).toBeInTheDocument();
    expect(container.querySelector(".chapterrail-arc")).toBeNull();
  });
});
