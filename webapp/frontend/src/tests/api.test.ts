import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  fetchPrTraces,
  fetchTrace,
  fetchRenderedHtml,
  fetchRawJsonl,
} from "../api";

describe("api", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchPrTraces returns the list", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          traces: [
            {
              trace_id: "id-1",
              short_id: "abc1234567",
              owner_login: "alice",
              repo_full_name: "alice/repo",
              pr_number: 3,
              pr_url: "https://github.com/alice/repo/pull/3",
              pr_title: "Add a thing",
              platform: "claude-code",
              byte_size: 100,
              message_count: 5,
              created_at: "2026-05-08T00:00:00Z",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const result = await fetchPrTraces("alice", "repo", 3);
    expect(result.traces).toHaveLength(1);
    expect(result.traces[0].short_id).toBe("abc1234567");
  });

  it("fetchTrace 404 throws a NotFound error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("not found", { status: 404 })
    );
    await expect(fetchTrace("zzz")).rejects.toThrow(/404/);
  });

  it("fetchRenderedHtml returns text on 200", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("<html>hi</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );
    const html = await fetchRenderedHtml("abc1234567");
    expect(html).toContain("<html>");
  });

  it("fetchRenderedHtml on 502 returns null + render error info via second result", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: { error: "render_failed", fallback: "raw" },
        }),
        { status: 502, headers: { "content-type": "application/json" } }
      )
    );
    await expect(fetchRenderedHtml("abc1234567")).rejects.toThrow(
      /render_failed/
    );
  });

  it("fetchRawJsonl returns text", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response('{"x":1}\n', { status: 200 })
    );
    const raw = await fetchRawJsonl("abc1234567");
    expect(raw).toBe('{"x":1}\n');
  });
});
