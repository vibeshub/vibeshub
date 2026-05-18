import type {
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
  const r = await fetch(`/api/traces/${owner}/${repo}/pull/${number}`);
  return jsonOrThrow<TraceListResponse>(r);
}

export async function fetchTrace(shortId: string): Promise<TraceSummary> {
  const r = await fetch(`/api/traces/${shortId}`);
  return jsonOrThrow<TraceSummary>(r);
}

export async function fetchRawJsonl(shortId: string): Promise<string> {
  const r = await fetch(`/api/traces/${shortId}/raw`);
  if (!r.ok) {
    throw new ApiError(r.status, await r.text());
  }
  return r.text();
}

export async function fetchUserOverview(login: string): Promise<UserOverview> {
  const r = await fetch(`/api/users/${encodeURIComponent(login)}`);
  return jsonOrThrow<UserOverview>(r);
}

export async function fetchRepoOverview(
  owner: string,
  repo: string,
): Promise<RepoOverview> {
  const r = await fetch(
    `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
  );
  return jsonOrThrow<RepoOverview>(r);
}
