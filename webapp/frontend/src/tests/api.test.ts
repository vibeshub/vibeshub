import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  fetchPrTraces,
  fetchTrace,
  fetchSessionJsonl,
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

  it("fetchSessionJsonl hits /api/traces/<sid>/session and returns text", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response('{"x":1}\n', { status: 200 }),
    );
    const raw = await fetchSessionJsonl("abc1234567");
    expect(raw).toBe('{"x":1}\n');
    expect(spy).toHaveBeenCalledWith("/api/traces/abc1234567/session", {
      credentials: "same-origin",
    });
  });

  it("fetchSessionJsonl on non-ok throws ApiError", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("not found", { status: 404 }),
    );
    await expect(fetchSessionJsonl("zzz")).rejects.toThrow(/404/);
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

import {
  ApiError,
  uploadTrace,
  patchTrace,
  deleteTrace,
  fetchMyRepos,
  fetchRepoPrs,
} from "../api";

describe("api / uploads + patch + pickers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uploadTrace posts multipart form data", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    vi.spyOn(global, "fetch").mockImplementation((url, init) => {
      captured = { url: String(url), init: init as RequestInit };
      return Promise.resolve(
        new Response(
          JSON.stringify({
            trace_id: "t1", short_id: "abc", trace_url: "/t/abc",
            created: true,
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );
    });
    const transcript = new File(['{"type":"user"}\n'], "chat.jsonl");
    const result = await uploadTrace({ transcript, isPrivate: false });
    expect(captured!.url).toBe("/api/uploads");
    expect(captured!.init.method).toBe("POST");
    expect(captured!.init.body).toBeInstanceOf(FormData);
    expect(result.short_id).toBe("abc");
  });

  it("uploadTrace includes subagents, pr_url, repo_full_name when supplied", async () => {
    let body: FormData | null = null;
    vi.spyOn(global, "fetch").mockImplementation((_url, init) => {
      body = (init as RequestInit).body as FormData;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            trace_id: "t1", short_id: "abc", trace_url: "/t/abc",
            created: true,
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );
    });
    const transcript = new File(['{"type":"user"}\n'], "chat.jsonl");
    const subagents = new File(["zipbytes"], "subagents.zip");
    await uploadTrace({
      transcript,
      subagents,
      isPrivate: true,
      prUrl: "https://github.com/a/b/pull/1",
      repoFullName: "a/b",
    });
    expect(body!.get("transcript")).toBeInstanceOf(File);
    expect(body!.get("subagents")).toBeInstanceOf(File);
    expect(body!.get("is_private")).toBe("true");
    expect(body!.get("pr_url")).toBe("https://github.com/a/b/pull/1");
    expect(body!.get("repo_full_name")).toBe("a/b");
  });

  it("uploadTrace throws ApiError on a non-ok response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("bad transcript", { status: 422 }),
    );
    const transcript = new File(['{"type":"user"}\n'], "chat.jsonl");
    await expect(uploadTrace({ transcript })).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it("patchTrace PATCHes the trace and returns the updated summary", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    vi.spyOn(global, "fetch").mockImplementation((url, init) => {
      captured = { url: String(url), init: init as RequestInit };
      return Promise.resolve(
        new Response(
          JSON.stringify({
            trace_id: "t1", short_id: "abc1234567", owner_login: "alice",
            repo_full_name: null, pr_number: null, pr_url: null,
            pr_title: null, platform: "claude-code", byte_size: 1,
            message_count: 1, created_at: "2026-05-22T00:00:00Z",
            is_private: true, agent_count: 0, agents: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    });
    const updated = await patchTrace("abc1234567", { is_private: true });
    expect(captured!.url).toBe("/api/traces/abc1234567");
    expect(captured!.init.method).toBe("PATCH");
    expect(JSON.parse(captured!.init.body as string)).toEqual({
      is_private: true,
    });
    expect(updated.is_private).toBe(true);
  });

  it("deleteTrace DELETEs and resolves on 204", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    await deleteTrace("abc1234567");
    expect(spy.mock.calls[0][0]).toBe("/api/traces/abc1234567");
    expect((spy.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
  });

  it("deleteTrace throws ApiError on a non-204 response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("forbidden", { status: 403 }),
    );
    await expect(deleteTrace("abc1234567")).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it("fetchMyRepos GETs /api/github/my-repos and returns the repos array", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          repos: [{ full_name: "a/b", name: "b", private: false }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const repos = await fetchMyRepos("b");
    expect(spy.mock.calls[0][0]).toBe("/api/github/my-repos?q=b");
    expect(repos).toHaveLength(1);
    expect(repos[0].full_name).toBe("a/b");
  });

  it("fetchRepoPrs GETs /api/github/repo-prs and returns the prs array", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          prs: [{ number: 7, title: "Add", html_url: "https://x/pull/7" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const prs = await fetchRepoPrs("a/b", "Add");
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("/api/github/repo-prs?");
    expect(url).toContain("repo=a%2Fb");
    expect(url).toContain("q=Add");
    expect(prs[0].number).toBe(7);
  });
});

describe("uploadTrace source_export", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("appends source_export only when provided", async () => {
    const bodies: FormData[] = [];
    vi.spyOn(global, "fetch").mockImplementation(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(init!.body as FormData);
        return new Response(
          JSON.stringify({
            short_id: "abc",
            trace_url: "/t/abc",
            created: true,
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      },
    );
    const jsonl = new File(["{}\n"], "chat.jsonl");
    const raw = new File(["banner"], "chat.txt");

    await uploadTrace({ transcript: jsonl, sourceExport: raw });
    expect(bodies[0].has("source_export")).toBe(true);

    await uploadTrace({ transcript: jsonl });
    expect(bodies[1].has("source_export")).toBe(false);
  });
});
