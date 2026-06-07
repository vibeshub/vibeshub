import type { StreamEvent } from "./types";
import type { DigestChapter } from "../../types";

export interface ChapterMetric {
  anchorUuid: string;
  /** Number of tool_use events in the chapter's span. */
  toolCount: number;
  /** Wall-clock ms in the span, or null when timestamps are unavailable. */
  durationMs: number | null;
}

function parseTs(e: StreamEvent | undefined): number | null {
  const ts = (e as { ts?: string } | undefined)?.ts;
  if (!ts) return null;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : null;
}

/**
 * Per-chapter tool count and duration, computed by walking the stream
 * between consecutive resolved chapter anchors. Chapters whose anchor uuid
 * is absent from the stream are omitted (the rail renders those title-only).
 * Anchors are sorted by stream position so out-of-order anchors never
 * produce a negative span.
 */
export function chapterMetrics(
  stream: StreamEvent[],
  chapters: DigestChapter[],
): Map<string, ChapterMetric> {
  const index = new Map<string, number>();
  stream.forEach((e, i) => {
    const uuid = (e as { uuid?: string }).uuid;
    if (uuid && !index.has(uuid)) index.set(uuid, i);
  });

  const resolved = chapters
    .map((c) => ({ uuid: c.anchor_uuid, pos: index.get(c.anchor_uuid) }))
    .filter((r): r is { uuid: string; pos: number } => r.pos !== undefined)
    .sort((a, b) => a.pos - b.pos);

  const out = new Map<string, ChapterMetric>();
  for (let k = 0; k < resolved.length; k++) {
    const start = resolved[k].pos;
    const end = k + 1 < resolved.length ? resolved[k + 1].pos : stream.length;

    let toolCount = 0;
    let lastTs: number | null = null;
    for (let i = start; i < end; i++) {
      if (stream[i].kind === "tool_use") toolCount++;
      const t = parseTs(stream[i]);
      if (t !== null) lastTs = t;
    }

    let durationMs: number | null = null;
    const startTs = parseTs(stream[start]);
    if (startTs !== null) {
      const endTs = end < stream.length ? parseTs(stream[end]) : lastTs;
      if (endTs !== null) durationMs = Math.max(0, endTs - startTs);
    }

    out.set(resolved[k].uuid, { anchorUuid: resolved[k].uuid, toolCount, durationMs });
  }
  return out;
}
