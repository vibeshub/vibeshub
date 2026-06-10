import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSessionFromRaw } from "../../components/trace/sessionFromRaw";

const FIXTURES = join(__dirname, "..", "fixtures");
const read = (name: string) =>
  readFileSync(join(FIXTURES, name), "utf8");

// The backend serves Claude-shaped jsonl for every format (codex/cursor
// converted server-side at ingest); buildSessionFromRaw must render the
// converted output with no frontend converter in the loop.
describe("buildSessionFromRaw pass-through", () => {
  it("renders server-converted codex jsonl", () => {
    const session = buildSessionFromRaw(read("sample-codex-converted.jsonl"));
    expect(session.meta.sourceFormat).toBe("codex");
    expect(session.stream.length).toBeGreaterThan(0);
  });

  it("renders server-converted cursor jsonl", () => {
    const session = buildSessionFromRaw(read("sample-cursor-converted.jsonl"));
    expect(session.meta.sourceFormat).toBe("cursor");
    expect(session.stream.length).toBeGreaterThan(0);
  });

  it("renders claude jsonl unchanged", () => {
    const session = buildSessionFromRaw(read("sample-session.jsonl"));
    expect(session.meta.sourceFormat).toBeNull();
    expect(session.stream.length).toBeGreaterThan(0);
  });
});
