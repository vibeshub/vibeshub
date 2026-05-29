import { describe, expect, it } from "vitest";
import {
  looksLikeTerminalExport,
  rejoin,
} from "../../components/trace/terminalExport";

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
