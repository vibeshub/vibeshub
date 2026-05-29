import { describe, expect, it } from "vitest";
import {
  looksLikeTerminalExport,
  rejoin,
} from "../../components/trace/terminalExport";
import {
  parseTerminalExport,
  terminalExportToJsonl,
} from "../../components/trace/terminalExport";

const SAMPLE = ` ▐▛███▜▌   Claude Code v2.1.156
▝▜█████▛▘  Opus 4.8 · Claude Max
  ▘▘ ▝▝    ~/git/vibeshub

❯ /resume
  ⎿  Resume cancelled

❯ fix the mobile layout, the header
  is too crowded

⏺ I'll look at the screenshots and pull up
  the frontend-design skill.

⏺ Skill(frontend-design:frontend-design)
  ⎿  Successfully loaded skill

  Read 5 files (ctrl+o to expand)

⏺ Bash(git diff --stat && echo "=== DIFF ===")
  ⎿  === DIFF ===
     … +8 lines (ctrl+o to expand)

✻ Baked for 39m 50s
`;

describe("parseTerminalExport", () => {
  const records = parseTerminalExport(SAMPLE);

  it("emits a terminal-meta marker with banner fields", () => {
    const marker = records[0];
    expect(marker.type).toBe("terminal-meta");
    expect(marker.source).toBe("terminal");
    expect(marker.version).toBe("v2.1.156");
    expect(marker.modelLabel).toBe("Opus 4.8");
    expect(marker.cwd).toBe("~/git/vibeshub");
  });

  it("emits a user prompt with wrapped lines rejoined", () => {
    const prompt = records.find(
      (r) =>
        r.type === "user" &&
        typeof (r.message as AnyRecT).content === "string" &&
        String((r.message as AnyRecT).content).includes("mobile"),
    );
    expect((prompt!.message as AnyRecT).content).toBe(
      "fix the mobile layout, the header is too crowded",
    );
  });

  it("emits assistant text blocks", () => {
    const asst = records.find(
      (r) =>
        r.type === "assistant" &&
        ((r.message as AnyRecT).content as AnyRecT[])[0].type === "text",
    );
    expect(
      (((asst!.message as AnyRecT).content as AnyRecT[])[0] as AnyRecT).text,
    ).toContain("frontend-design skill");
  });

  it("emits tool_use for Name(...) calls with a unique id and name", () => {
    const tools = records
      .filter((r) => r.type === "assistant")
      .map((r) => ((r.message as AnyRecT).content as AnyRecT[])[0])
      .filter((b) => (b as AnyRecT).type === "tool_use") as AnyRecT[];
    const names = tools.map((b) => b.name);
    expect(names).toContain("Skill");
    expect(names).toContain("Bash");
    expect(names).toContain("Read"); // glyph-less "Read 5 files" summary form
    const ids = tools.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
  });

  it("attaches ⎿ output to the preceding tool as a tool_result", () => {
    const results = records
      .filter((r) => r.type === "user" && Array.isArray((r.message as AnyRecT).content))
      .flatMap((r) => (r.message as AnyRecT).content as AnyRecT[])
      .filter((b) => b.type === "tool_result");
    const bash = results.find((b) =>
      String(b.content).includes("=== DIFF ==="),
    );
    expect(bash).toBeTruthy();
    expect(String(bash!.content)).toContain("+8 lines"); // truncation preserved
  });

  it("assigns unique synthetic message ids", () => {
    const ids = records
      .filter((r) => r.type === "assistant")
      .map((r) => (r.message as AnyRecT).id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("assigns a unique non-empty uuid to every content record", () => {
    // buildSession reads top-level `uuid` for prompt/assistant anchors; the
    // PromptRail and timeline nav only surface prompts whose uuid is truthy,
    // so a missing uuid silently drops the rail and collapses the layout.
    const uuids = records
      .filter((r) => r.type === "user" || r.type === "assistant")
      .map((r) => r.uuid);
    expect(uuids.every((u) => typeof u === "string" && u.length > 0)).toBe(true);
    expect(new Set(uuids).size).toBe(uuids.length); // all unique
  });

  it("drops orphan ⎿ output that has no preceding tool", () => {
    // The `/resume` prompt is immediately followed by `⎿ Resume cancelled`
    // with no tool_use before it; that output has nowhere to attach and is
    // dropped rather than mis-attached to a later tool.
    const orphan = records
      .filter((r) => r.type === "user" && Array.isArray((r.message as AnyRecT).content))
      .flatMap((r) => (r.message as AnyRecT).content as AnyRecT[])
      .filter((b) => b.type === "tool_result")
      .find((b) => String(b.content).includes("Resume cancelled"));
    expect(orphan).toBeUndefined();
  });
});

describe("terminalExportToJsonl", () => {
  it("returns newline-delimited json and recovered=true for real content", () => {
    const { jsonl, recovered } = terminalExportToJsonl(SAMPLE);
    expect(recovered).toBe(true);
    const lines = jsonl.split("\n").filter(Boolean);
    expect(() => lines.forEach((l) => JSON.parse(l))).not.toThrow();
    expect(JSON.parse(lines[0]).type).toBe("terminal-meta");
  });

  it("returns recovered=false when only a banner is present", () => {
    const { recovered } = terminalExportToJsonl(
      " ▐▛███▜▌   Claude Code v2.1.156\n  ~/git/vibeshub\n",
    );
    expect(recovered).toBe(false);
  });
});

type AnyRecT = Record<string, unknown>;

describe("looksLikeTerminalExport", () => {
  it("is true for a rendered export banner", () => {
    const txt = " ▐▛███▜▌   Claude Code v2.1.156\n  ~/git/vibeshub\n\n❯ hi\n";
    expect(looksLikeTerminalExport(txt)).toBe(true);
  });

  it("is true for ❯/⏺ glyph lines without a version", () => {
    expect(looksLikeTerminalExport("❯ do a thing\n⏺ ok\n")).toBe(true);
  });

  it("is false for a real jsonl transcript", () => {
    expect(
      looksLikeTerminalExport('{"type":"user","message":{"content":"hi"}}\n'),
    ).toBe(false);
  });
});

describe("rejoin", () => {
  it("collapses wrapped lines into one space-joined run", () => {
    expect(rejoin(["fix the", "mobile layout"])).toBe("fix the mobile layout");
  });

  it("keeps a blank line as a paragraph break", () => {
    expect(rejoin(["intro line", "", "second para"])).toBe(
      "intro line\n\nsecond para",
    );
  });
});

import { buildSession, parseJsonl } from "../../components/trace/parser";

describe("buildSession reads terminal-meta", () => {
  it("sets sourceFormat and modelLabel from the marker", () => {
    const { jsonl } = terminalExportToJsonl(SAMPLE);
    const session = buildSession(parseJsonl(jsonl));
    expect(session.meta.sourceFormat).toBe("terminal");
    expect(session.meta.modelLabel).toBe("Opus 4.8");
    expect(session.meta.version).toBe("v2.1.156");
    expect(session.meta.cwd).toBe("~/git/vibeshub");
    expect(session.meta.model).toBeNull(); // real model id stays unknown
  });

  it("leaves sourceFormat null for an ordinary jsonl transcript", () => {
    const session = buildSession(
      parseJsonl('{"type":"user","message":{"content":"hi"}}\n'),
    );
    expect(session.meta.sourceFormat).toBeNull();
    expect(session.meta.modelLabel).toBeNull();
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const fixturesDir = dirname(fileURLToPath(import.meta.url));
const REAL = readFileSync(
  join(fixturesDir, "../fixtures/sample-terminal-export.txt"),
  "utf-8",
);

describe("real export round-trips through buildSession", () => {
  const { jsonl, recovered } = terminalExportToJsonl(REAL);
  const session = buildSession(parseJsonl(jsonl));

  it("recovers content", () => {
    expect(recovered).toBe(true);
    expect(session.meta.userPromptCount).toBeGreaterThan(0);
    expect(session.meta.toolCallCount).toBeGreaterThan(0);
    expect(session.meta.assistantTextCount).toBeGreaterThan(0);
  });

  it("marks provenance and leaves unrecoverable metadata empty", () => {
    expect(session.meta.sourceFormat).toBe("terminal");
    expect(session.meta.modelLabel).toBe("Opus 4.8");
    const t = session.meta.tokens;
    expect(t.input + t.output + t.cacheRead + t.cacheCreate).toBe(0);
    expect(session.meta.assistantThinkMs).toBe(0); // no timestamps to derive from
  });

  it("counts the real tools (Skill, Bash, Update, Write)", () => {
    expect(Object.keys(session.meta.toolCounts)).toEqual(
      expect.arrayContaining(["Skill", "Bash", "Update", "Write"]),
    );
  });

  it("gives every user prompt a uuid so the PromptRail renders", () => {
    // The rail (and the prompt jump-anchors) require a truthy uuid; without
    // one, the rail collapses to empty and the transcript column shrinks.
    const prompts = session.stream.filter((e) => e.kind === "user_prompt");
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.every((p) => p.uuid.length > 0)).toBe(true);
  });
});
