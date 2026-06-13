import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ProvenanceView } from "../../components/trace/ProvenanceView";
import { buildProvenance } from "../../components/trace/provenance";
import type { Session, StreamEvent } from "../../components/trace/types";
import type { TraceDigest } from "../../types";

function ev(): StreamEvent[] {
  return [
    { kind: "user_prompt", text: "tweak the css", ts: "2026-06-13T10:00:00Z", uuid: "p1" },
    {
      kind: "tool_use",
      name: "Edit",
      input: { file_path: "/r/faq.module.css", old_string: "a", new_string: "b" },
      id: "id-t1",
      ts: "2026-06-13T10:00:01Z",
      msgId: "m1",
      uuid: "t1",
      result: null,
    },
  ];
}

function retriedStream(): StreamEvent[] {
  return [
    { kind: "user_prompt", text: "write it", ts: "2026-06-13T10:00:00Z", uuid: "p1" },
    {
      kind: "tool_use",
      name: "Write",
      input: { file_path: "/r/a.ts", content: "v1" },
      id: "id-t1",
      ts: "2026-06-13T10:00:01Z",
      msgId: "m1",
      uuid: "t1",
      result: { content: "File has not been read yet.", isError: true },
    },
    {
      kind: "tool_use",
      name: "Read",
      input: { file_path: "/r/a.ts" },
      id: "id-t2",
      ts: "2026-06-13T10:00:02Z",
      msgId: "m1",
      uuid: "t2",
      result: null,
    },
    {
      kind: "tool_use",
      name: "Write",
      input: { file_path: "/r/a.ts", content: "v1" },
      id: "id-t3",
      ts: "2026-06-13T10:00:03Z",
      msgId: "m1",
      uuid: "t3",
      result: null,
    },
  ];
}

function session(stream: StreamEvent[] = ev()): Session {
  return {
    stream,
    meta: {
      sessionId: "s1", aiTitle: null, firstPrompt: null, cwd: "/r",
      gitBranch: null, model: null, modelLabel: null, sourceFormat: null,
      version: null, permissionMode: null, startedAt: null, endedAt: null,
      prLink: null, tokens: { input: 0, cacheCreate: 0, cacheRead: 0, output: 0 },
      assistantThinkMs: 0, toolCounts: {}, toolCallCount: 0, userPromptCount: 1,
      assistantTextCount: 0, agents: [],
    },
  };
}

const digest: TraceDigest = {
  ask: "a", decisions: "b", files: "c", tests: "d", dead_ends: "e",
  chapters: [],
  file_notes: [{ path: "/r/faq.module.css", caption: "Tint hover states" }],
};

describe("ProvenanceView merged blocks", () => {
  it("shows the digest caption and renders no hunk boxes", () => {
    const model = buildProvenance(session(), [], "claude-code");
    render(
      <ProvenanceView
        model={model}
        session={session()}
        subagentsLoading={false}
        digest={digest}
        onJump={() => {}}
      />,
    );
    expect(screen.getByText("Tint hover states")).toBeInTheDocument();
    expect(document.querySelector(".prov-hunk")).toBeNull();
    expect(document.querySelector(".prov-htitle")).toBeNull();
  });

  it("makes blame rows keyboard-focusable buttons", () => {
    const model = buildProvenance(session(), [], "claude-code");
    render(
      <ProvenanceView
        model={model}
        session={session()}
        subagentsLoading={false}
        digest={digest}
        onJump={() => {}}
      />,
    );
    const rows = document.querySelectorAll('.prov-ln[role="button"]');
    expect(rows.length).toBeGreaterThan(0);
    expect((rows[0] as HTMLElement).tabIndex).toBe(0);
  });

  it("marks rows of a retried region with the retry class + title", () => {
    const model = buildProvenance(session(retriedStream()), [], "claude-code");
    render(
      <ProvenanceView
        model={model}
        session={session(retriedStream())}
        subagentsLoading={false}
        digest={digest}
        onJump={() => {}}
      />,
    );
    const retriedRow = document.querySelector(".prov-ln.retried") as HTMLElement | null;
    expect(retriedRow).not.toBeNull();
    expect(retriedRow?.getAttribute("title")).toBe("This edit was retried");
  });

  it("renders no caption when the digest has none for the file", () => {
    const model = buildProvenance(session(), [], "claude-code");
    render(
      <ProvenanceView
        model={model}
        session={session()}
        subagentsLoading={false}
        digest={null}
        onJump={() => {}}
      />,
    );
    expect(document.querySelector(".prov-fcaption")).toBeNull();
  });
});
