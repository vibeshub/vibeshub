import type {
  GithubRepo,
  GithubRepoListPage,
  GithubUser,
  MeResponse,
  RepoOverview,
  TraceListResponse,
  TraceSummary,
  UserOverview,
} from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`API ${status}: ${body}`);
  }
}

async function jsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }
  return (await response.json()) as T;
}

export async function fetchPrTraces(
  owner: string,
  repo: string,
  number: number,
): Promise<TraceListResponse> {
  const r = await fetch(`/api/traces/${owner}/${repo}/pull/${number}`, {
    credentials: "same-origin",
  });
  return jsonOrThrow<TraceListResponse>(r);
}

export async function fetchTrace(shortId: string): Promise<TraceSummary> {
  const r = await fetch(`/api/traces/${shortId}`, {
    credentials: "same-origin",
  });
  return jsonOrThrow<TraceSummary>(r);
}

export async function fetchRawJsonl(shortId: string): Promise<string> {
  const r = await fetch(`/api/traces/${shortId}/raw`, {
    credentials: "same-origin",
  });
  if (!r.ok) {
    throw new ApiError(r.status, await r.text());
  }
  return r.text();
}

export async function fetchUserOverview(login: string): Promise<UserOverview> {
  const r = await fetch(`/api/users/${encodeURIComponent(login)}`, {
    credentials: "same-origin",
  });
  return jsonOrThrow<UserOverview>(r);
}

export async function fetchRepoOverview(
  owner: string,
  repo: string,
): Promise<RepoOverview> {
  const r = await fetch(
    `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    { credentials: "same-origin" },
  );
  return jsonOrThrow<RepoOverview>(r);
}

export async function fetchMe(): Promise<MeResponse | null> {
  const r = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (r.status === 204) return null;
  if (!r.ok) throw new ApiError(r.status, await r.text());
  return (await r.json()) as MeResponse;
}

export async function logout(): Promise<void> {
  const r = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  });
  if (r.status !== 204) {
    throw new ApiError(r.status, await r.text());
  }
}

export async function fetchGithubUser(login: string): Promise<GithubUser> {
  const r = await fetch(`/api/github/users/${encodeURIComponent(login)}`, {
    credentials: "same-origin",
  });
  return jsonOrThrow<GithubUser>(r);
}

export async function fetchGithubUserRepos(
  login: string,
  page = 1,
): Promise<GithubRepoListPage> {
  const r = await fetch(
    `/api/github/users/${encodeURIComponent(login)}/repos?page=${page}`,
    { credentials: "same-origin" },
  );
  return jsonOrThrow<GithubRepoListPage>(r);
}

export async function fetchGithubRepo(
  owner: string,
  name: string,
): Promise<GithubRepo> {
  const r = await fetch(
    `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    { credentials: "same-origin" },
  );
  return jsonOrThrow<GithubRepo>(r);
}
