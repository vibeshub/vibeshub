import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { ToolCard } from "../../components/trace/tool/ToolCard";
import type {
  ProgressEvent,
  ToolUseEvent,
} from "../../components/trace/types";

function toolEvent(): ToolUseEvent {
  return {
    kind: "tool_use",
    name: "Bash",
    input: { command: "ls" },
    id: "toolu_1",
    ts: "2026-05-19T10:00:00Z",
    msgId: "m1",
    uuid: "u1",
    result: null,
  };
}

function hook(hookName: string): ProgressEvent {
  return {
    kind: "progress",
    hookEvent: "PostToolUse",
    hookName,
    command: "callback",
    parentToolUseID: "toolu_1",
    ts: "2026-05-19T10:00:01Z",
    uuid: `p-${hookName}`,
  };
}

function editEvent(): ToolUseEvent {
  return {
    kind: "tool_use",
    name: "Edit",
    input: { file_path: "/repo/src/a.ts", old_string: "old line", new_string: "new line one\nnew line two" },
    id: "toolu_2",
    ts: "2026-05-19T10:00:00Z",
    msgId: "m1",
    uuid: "u2",
    result: null,
  };
}

describe("ToolCard edit diffstat", () => {
  it("shows +N and -N counts in the header for edit tools", () => {
    const { container } = render(
      <ToolCard
        event={editEvent()}
        root={null}
        followingPrompt={null}
        shortId="abc"
        agents={[]}
        progress={[]}
      />,
    );
    const stat = container.querySelector(".tool-diffstat");
    expect(stat).not.toBeNull();
    expect(stat!.textContent).toContain("+2");
    expect(stat!.textContent).toContain("−1");
  });

  it("shows no diffstat for non-edit tools", () => {
    const { container } = render(
      <ToolCard
        event={toolEvent()}
        root={null}
        followingPrompt={null}
        shortId="abc"
        agents={[]}
        progress={[]}
      />,
    );
    expect(container.querySelector(".tool-diffstat")).toBeNull();
  });
});

describe("ToolCard hooks", () => {
  it("shows a hook-count badge when progress events are attached", () => {
    const { getByText } = render(
      <ToolCard
        event={toolEvent()}
        root={null}
        followingPrompt={null}
        shortId="abc"
        agents={[]}
        progress={[hook("PostToolUse:Bash"), hook("PostToolUse:Format")]}
      />,
    );
    expect(getByText("2 hooks")).toBeInTheDocument();
  });

  it("renders no badge and no Hooks section when there are no hooks", () => {
    const { container, queryByText } = render(
      <ToolCard
        event={toolEvent()}
        root={null}
        followingPrompt={null}
        shortId="abc"
        agents={[]}
        progress={[]}
      />,
    );
    expect(container.querySelector(".tool-hook-badge")).toBeNull();
    fireEvent.click(container.querySelector(".tool-head")!);
    expect(queryByText("Hooks")).toBeNull();
  });

  it("lists hook names inside the tool body when expanded", () => {
    const { container, getByText } = render(
      <ToolCard
        event={toolEvent()}
        root={null}
        followingPrompt={null}
        shortId="abc"
        agents={[]}
        progress={[hook("PostToolUse:Bash")]}
      />,
    );
    expect(getByText("1 hook")).toBeInTheDocument();
    fireEvent.click(container.querySelector(".tool-head")!);
    expect(getByText("Hooks")).toBeInTheDocument();
    expect(getByText("PostToolUse:Bash")).toBeInTheDocument();
  });
});
