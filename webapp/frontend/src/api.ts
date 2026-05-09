import type { TraceListResponse, TraceSummary } from "./types";

export class ApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`API ${status}: ${body}`);
  }
}

export class RenderFailedError extends Error {
  constructor(public message: string = "render_failed") {
    super(message);
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
  number: number
): Promise<TraceListResponse> {
  const r = await fetch(`/api/traces/${owner}/${repo}/pull/${number}`);
  return jsonOrThrow<TraceListResponse>(r);
}

export async function fetchTrace(shortId: string): Promise<TraceSummary> {
  const r = await fetch(`/api/traces/${shortId}`);
  return jsonOrThrow<TraceSummary>(r);
}

export async function fetchRenderedHtml(shortId: string): Promise<string> {
  const r = await fetch(`/api/traces/${shortId}/rendered`);
  if (r.status === 502) {
    let body: { detail?: { error?: string } } = {};
    try {
      body = await r.json();
    } catch {
      // ignore
    }
    if (body.detail?.error === "render_failed") {
      throw new RenderFailedError("render_failed");
    }
  }
  if (!r.ok) {
    throw new ApiError(r.status, await r.text());
  }
  return r.text();
}

export async function fetchRawJsonl(shortId: string): Promise<string> {
  const r = await fetch(`/api/traces/${shortId}/raw`);
  if (!r.ok) {
    throw new ApiError(r.status, await r.text());
  }
  return r.text();
}
