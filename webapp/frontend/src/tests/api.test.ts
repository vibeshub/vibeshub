import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  fetchPrTraces,
  fetchTrace,
  fetchRawJsonl,
  fetchAgentJsonl,
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
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await fetchPrTraces("alice", "repo", 3);
    expect(result.traces).toHaveLength(1);
    expect(result.traces[0].short_id).toBe("abc1234567");
  });

  it("fetchTrace 404 throws a NotFound error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("not found", { status: 404 }),
    );
    await expect(fetchTrace("zzz")).rejects.toThrow(/404/);
  });

  it("fetchRawJsonl returns text", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response('{"x":1}\n', { status: 200 }),
    );
    const raw = await fetchRawJsonl("abc1234567");
    expect(raw).toBe('{"x":1}\n');
  });

  it("fetchRawJsonl on non-ok throws ApiError", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("not found", { status: 404 }),
    );
    await expect(fetchRawJsonl("zzz")).rejects.toThrow(/404/);
  });

  it("fetchAgentJsonl hits /api/traces/<sid>/agents/<id> and returns body text", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response('{"type":"user"}\n', { status: 200 }),
    );
    const text = await fetchAgentJsonl("abcdefghij", "a0123456789abcdef");
    expect(text).toBe('{"type":"user"}\n');
    expect(spy).toHaveBeenCalledWith(
      "/api/traces/abcdefghij/agents/a0123456789abcdef",
      { credentials: "same-origin" },
    );
  });

  it("fetchAgentJsonl on non-ok throws ApiError", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("not found", { status: 404 }),
    );
    await expect(
      fetchAgentJsonl("abcdefghij", "a0123456789abcdef"),
    ).rejects.toThrow(/404/);
  });
});

import {
  fetchMe,
  logout,
  fetchGithubUser,
  fetchGithubUserRepos,
  fetchGithubRepo,
} from "../api";

describe("api / auth + github", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchMe returns null on 204", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    const me = await fetchMe();
    expect(me).toBeNull();
  });

  it("fetchMe returns the user on 200", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "u-1",
          login: "alice",
          name: "Alice",
          avatar_url: "https://avatars/alice.png",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const me = await fetchMe();
    expect(me).not.toBeNull();
    expect(me!.login).toBe("alice");
  });

  it("logout POSTs and resolves on 204", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    await logout();
    const call = spy.mock.calls[0];
    expect(call[0]).toBe("/api/auth/logout");
    expect((call[1] as RequestInit).method).toBe("POST");
  });

  it("fetchGithubUser returns the parsed profile", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          login: "octo", name: "Octo", bio: null, avatar_url: "",
          html_url: "", followers: 1, following: 0, public_repos: 1,
          total_public_stars: 5, top_languages: ["Go"],
          created_at: "2008-01-14T04:33:35Z", stars_truncated: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const u = await fetchGithubUser("octo");
    expect(u.login).toBe("octo");
    expect(u.top_languages).toEqual(["Go"]);
  });

  it("fetchGithubUserRepos paginates", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ repos: [], has_next: false }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await fetchGithubUserRepos("octo", 2);
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("page=2");
  });

  it("fetchGithubRepo returns the parsed repo", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          full_name: "octo/hello", name: "hello", description: "", html_url: "",
          default_branch: "main", stargazers_count: 1, forks_count: 0,
          watchers_count: 1, open_issues_count: 0, primary_language: "Ruby",
          license_spdx: "MIT", topics: [], created_at: "", updated_at: "",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const r = await fetchGithubRepo("octo", "hello");
    expect(r.primary_language).toBe("Ruby");
  });
});
