import type { AgentSummary, DigestChapter } from "../../types";
import type {
  StreamEvent,
  ToolUseEvent,
  UserPromptEvent,
} from "./types";
import type { DiffRow } from "./diff";
import { buildWriteRows, extractPatch } from "./diff";

// A subagent stream paired with its summary, so edits can be attributed to
// the spawning Task tool call (agent.tool_use_id === Task event id).
export interface SubagentEntry {
  agent: AgentSummary;
  stream: StreamEvent[];
}

export interface ChangeHunk {
  // data-uuid scroll target: the tool card for main-stream edits, the
  // spawning Task card for subagent edits, null when unattributable.
  jumpUuid: string | null;
  ts: string;
  rows: DiffRow[];
  supersededBy: { turnLabel: string } | null;
}

export interface CaptionGroup {
  promptUuid: string | null;
  promptExcerpt: string;
  turnLabel: string;
  agentBadge: string | null;
  hunks: ChangeHunk[];
}

export interface FileChange {
  path: string;
  kind: "new" | "mod";
  adds: number; // surviving hunks only
  dels: number;
  groups: CaptionGroup[];
}

// One digest chapter's slice of the session diff: the chapter reads like a
// commit (title + caption as the message) over the files it touched.
export interface ChapterChange {
  anchorUuid: string;
  title: string;
  caption: string;
  ordinal: number; // 1-based, matches the rail's numbering
  adds: number; // surviving hunks in this chapter only
  dels: number;
  files: FileChange[];
}

// DOM id for a file card, used by the index list's scroll links.
export function changeAnchorId(path: string): string {
  return "change-" + path.replace(/[^a-zA-Z0-9_-]/g, "-");
}

// DOM id for a chapter section in the Changes column. Distinct from the
// conversation's `chapter-<uuid>` divider ids so the two modes never collide.
export function changesChapterAnchorId(uuid: string): string {
  return "changes-chapter-" + uuid;
}

// Tool names that modify a file (carry input.file_path). Shared with
// deriveFiles in Outcome.tsx so the two walks can't drift.
export const FILE_EDIT_TOOLS = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "apply_patch",
]);

interface PromptRef {
  uuid: string | null;
  excerpt: string;
  turnLabel: string;
}

const SESSION_START: PromptRef = {
  uuid: null,
  excerpt: "session start",
  turnLabel: "session start",
};

function clipExcerpt(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= 90 ? t : t.slice(0, 90) + "…";
}

function promptRef(e: UserPromptEvent, ordinal: number): PromptRef {
  const raw = e.command
    ? e.command.args
      ? `${e.command.name} ${e.command.args}`
      : e.command.name
    : e.text;
  return {
    uuid: e.uuid || null,
    excerpt: clipExcerpt(raw),
    turnLabel: `turn ${ordinal}`,
  };
}

// One file-edit operation flattened to what grouping and the supersede pass
// need. MultiEdit without a structuredPatch yields one op per sub-edit.
interface EditOp {
  path: string;
  ts: string;
  seq: number; // stream walk order: tiebreaker, and fallback when ts is missing
  streamPos: number; // main-stream index (Task event for subagent ops, -1 unknown)
  jumpUuid: string | null;
  prompt: PromptRef;
  agentBadge: string | null;
  isWrite: boolean;
  rows: DiffRow[];
  newContents: string[]; // emitted content, supersede targets
  oldStrings: string[]; // supersede sources
}

function opsFromTool(
  e: ToolUseEvent,
  prompt: PromptRef,
  jumpUuid: string | null,
  agentBadge: string | null,
  streamPos: number,
): EditOp[] {
  const path = typeof e.input.file_path === "string" ? e.input.file_path : null;
  if (!path) return [];
  const patch = extractPatch(e.result?.toolUseResult?.structuredPatch);
  // seq is assigned post-hoc in collectOps once all ops are collected.
  const base = { path, ts: e.ts, seq: 0, streamPos, jumpUuid, prompt, agentBadge };

  if (e.name === "MultiEdit" && Array.isArray(e.input.edits) && !patch) {
    // No whole-call patch: one hunk per sub-edit (line numbers restart per
    // edit, matching the existing tool-card fallback in buildWriteRows).
    const ops: EditOp[] = [];
    for (const raw of e.input.edits) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      if (typeof o.old_string !== "string" || typeof o.new_string !== "string") {
        continue;
      }
      ops.push({
        ...base,
        isWrite: false,
        rows: buildWriteRows(
          { old_string: o.old_string, new_string: o.new_string },
          null,
        ),
        newContents: [o.new_string],
        oldStrings: [o.old_string],
      });
    }
    return ops;
  }

  const rows = buildWriteRows(e.input, patch);
  const newContents: string[] = [];
  const oldStrings: string[] = [];
  if (typeof e.input.content === "string") newContents.push(e.input.content);
  if (typeof e.input.new_string === "string") {
    newContents.push(e.input.new_string);
  }
  if (typeof e.input.old_string === "string") {
    oldStrings.push(e.input.old_string);
  }
  if (Array.isArray(e.input.edits)) {
    for (const raw of e.input.edits) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      if (typeof o.new_string === "string") newContents.push(o.new_string);
      if (typeof o.old_string === "string") oldStrings.push(o.old_string);
    }
  }
  if (newContents.length === 0 && patch) {
    // structuredPatch-only shapes (e.g. codex apply_patch): match on the
    // joined added lines.
    const added = rows.filter((r) => r.kind === "add").map((r) => r.text);
    if (added.length > 0) newContents.push(added.join("\n"));
  }
  return [
    { ...base, isWrite: e.name === "Write", rows, newContents, oldStrings },
  ];
}

// Pass over the main stream and subagent streams: prompt ordinals, the prompt
// active at each tool call, Task dispatch lookups, and Read paths (new/mod).
function collectOps(
  stream: StreamEvent[],
  subagents: SubagentEntry[],
): { ops: EditOp[]; reads: Set<string> } {
  const reads = new Set<string>();
  const ops: EditOp[] = [];
  const taskByToolId = new Map<
    string,
    { uuid: string | null; prompt: PromptRef; pos: number }
  >();
  let current = SESSION_START;
  let ordinal = 0;

  stream.forEach((e, pos) => {
    if (e.kind === "user_prompt") {
      ordinal += 1;
      current = promptRef(e, ordinal);
      return;
    }
    if (e.kind !== "tool_use") return;
    if (e.name === "Read" && typeof e.input.file_path === "string") {
      reads.add(e.input.file_path);
    }
    if (e.name === "Task") {
      taskByToolId.set(e.id, { uuid: e.uuid || null, prompt: current, pos });
    }
    if (FILE_EDIT_TOOLS.has(e.name)) {
      ops.push(...opsFromTool(e, current, e.uuid || null, null, pos));
    }
  });

  // Subagent streams: edits attach to the spawning Task card and the prompt
  // that was active when it was dispatched.
  for (const { agent, stream: sub } of subagents) {
    const dispatch = agent.tool_use_id
      ? taskByToolId.get(agent.tool_use_id)
      : undefined;
    const prompt = dispatch?.prompt ?? SESSION_START;
    const jumpUuid = dispatch?.uuid ?? null;
    const pos = dispatch?.pos ?? -1;
    const badge = `Task[${agent.agent_type || "agent"}]`;
    for (const e of sub) {
      if (e.kind !== "tool_use") continue;
      if (e.name === "Read" && typeof e.input.file_path === "string") {
        reads.add(e.input.file_path);
      }
      if (FILE_EDIT_TOOLS.has(e.name)) {
        ops.push(...opsFromTool(e, prompt, jumpUuid, badge, pos));
      }
    }
  }

  // Assign stream-collection order (main stream first, then subagent streams in
  // push order) as the stable tiebreaker / fallback for timestamp-less ops.
  ops.forEach((op, i) => {
    op.seq = i;
  });
  return { ops, reads };
}

// ISO timestamps compare lexicographically, with seq as the tiebreaker.
// When either ts is missing (e.g. cursor-imported traces emit ts: ""),
// fall back to stream-collection order so empty ts can't reorder edits.
function sortOps(list: EditOp[]): void {
  list.sort(
    (a, b) => (a.ts && b.ts ? a.ts.localeCompare(b.ts) : 0) || a.seq - b.seq,
  );
}

interface MarkedOp {
  op: EditOp;
  supersededBy: { turnLabel: string } | null;
}

// Supersede pass over one file's sorted ops: a Write replaces everything
// before it; an edit whose old_string textually contains ALL of an earlier
// hunk's emitted content replaces that hunk. Exact substring only; empty
// fragments never match (false negatives are fine, false positives are not).
function markSuperseded(list: EditOp[]): MarkedOp[] {
  const superseded = new Array<{ turnLabel: string } | null>(
    list.length,
  ).fill(null);
  for (let j = 0; j < list.length; j++) {
    const later = list[j];
    for (let i = 0; i < j; i++) {
      if (superseded[i]) continue;
      if (later.isWrite) {
        superseded[i] = { turnLabel: later.prompt.turnLabel };
        continue;
      }
      const targets = list[i].newContents.filter((c) => c !== "");
      if (targets.length === 0) continue;
      const consumed = later.oldStrings.some(
        (s) => s !== "" && targets.every((c) => s.includes(c)),
      );
      if (consumed) {
        superseded[i] = { turnLabel: later.prompt.turnLabel };
      }
    }
  }
  return list.map((op, i) => ({ op, supersededBy: superseded[i] }));
}

// Group consecutive marked ops by (prompt, agent) into caption groups and
// total the surviving rows.
function buildGroups(marked: MarkedOp[]): {
  groups: CaptionGroup[];
  adds: number;
  dels: number;
} {
  const groups: CaptionGroup[] = [];
  let adds = 0;
  let dels = 0;
  for (const { op, supersededBy } of marked) {
    const hunk: ChangeHunk = {
      jumpUuid: op.jumpUuid,
      ts: op.ts,
      rows: op.rows,
      supersededBy,
    };
    if (!hunk.supersededBy) {
      for (const r of op.rows) {
        if (r.kind === "add") adds += 1;
        else if (r.kind === "del") dels += 1;
      }
    }
    const last = groups[groups.length - 1];
    if (
      last &&
      last.promptUuid === op.prompt.uuid &&
      last.agentBadge === op.agentBadge
    ) {
      last.hunks.push(hunk);
    } else {
      groups.push({
        promptUuid: op.prompt.uuid,
        promptExcerpt: op.prompt.excerpt,
        turnLabel: op.prompt.turnLabel,
        agentBadge: op.agentBadge,
        hunks: [hunk],
      });
    }
  }
  return { groups, adds, dels };
}

function groupByPath(ops: EditOp[]): Map<string, EditOp[]> {
  const byPath = new Map<string, EditOp[]>();
  for (const op of ops) {
    const list = byPath.get(op.path) ?? [];
    list.push(op);
    byPath.set(op.path, list);
  }
  return byPath;
}

// Same comparator shape as sortOps: chronological with a seq tiebreak when
// both first timestamps are present, stream order otherwise.
function sortByFirstTouch(
  files: Array<{ change: FileChange; firstTs: string; firstSeq: number }>,
): FileChange[] {
  files.sort(
    (a, b) =>
      (a.firstTs && b.firstTs ? a.firstTs.localeCompare(b.firstTs) : 0) ||
      a.firstSeq - b.firstSeq,
  );
  return files.map((f) => f.change);
}

export function buildFileChanges(
  stream: StreamEvent[],
  subagents: SubagentEntry[],
): FileChange[] {
  const { ops, reads } = collectOps(stream, subagents);
  const byPath = groupByPath(ops);

  const files: Array<{ change: FileChange; firstTs: string; firstSeq: number }> =
    [];
  for (const [path, list] of byPath) {
    sortOps(list);
    const marked = markSuperseded(list);
    const { groups, adds, dels } = buildGroups(marked);
    const first = list[0];
    const kind: "new" | "mod" =
      first.isWrite && !reads.has(path) ? "new" : "mod";
    files.push({
      change: { path, kind, adds, dels, groups },
      firstTs: first.ts,
      firstSeq: first.seq,
    });
  }
  return sortByFirstTouch(files);
}

// The session diff re-cut along digest chapters: every chapter appears (so
// rail rows and ordinals stay aligned), with `files` empty for chapters that
// changed nothing. The supersede pass stays global per file, so a hunk
// rewritten in a later chapter shows as a stub inside the chapter that
// produced it.
export function buildChapterChanges(
  stream: StreamEvent[],
  subagents: SubagentEntry[],
  chapters: DigestChapter[],
): ChapterChange[] {
  const out: ChapterChange[] = chapters.map((c, ci) => ({
    anchorUuid: c.anchor_uuid,
    title: c.title,
    caption: c.caption,
    ordinal: ci + 1,
    adds: 0,
    dels: 0,
    files: [],
  }));
  if (chapters.length === 0) return out;

  // Resolve chapter anchors to stream positions (mirrors chapterMetrics);
  // unresolved chapters keep their row but can never receive ops.
  const index = new Map<string, number>();
  stream.forEach((e, i) => {
    const uuid = (e as { uuid?: string }).uuid;
    if (uuid && !index.has(uuid)) index.set(uuid, i);
  });
  const resolved = chapters
    .map((c, ci) => ({ ci, pos: index.get(c.anchor_uuid) }))
    .filter((r): r is { ci: number; pos: number } => r.pos !== undefined)
    .sort((a, b) => a.pos - b.pos);
  if (resolved.length === 0) return out;

  // An op belongs to the last chapter anchored at or before it; everything
  // earlier (including unattributable subagent ops at pos -1) joins the first.
  const chapterOf = (pos: number): number => {
    let ci = resolved[0].ci;
    for (const r of resolved) {
      if (r.pos <= pos) ci = r.ci;
      else break;
    }
    return ci;
  };

  const { ops, reads } = collectOps(stream, subagents);
  const byPath = groupByPath(ops);

  // chapter -> path -> globally sorted+marked ops falling in that chapter.
  const buckets = new Map<number, Map<string, MarkedOp[]>>();
  const newInChapter = new Map<string, number>(); // path -> chapter of a globally-new first touch
  for (const [path, list] of byPath) {
    sortOps(list);
    const marked = markSuperseded(list);
    if (list[0].isWrite && !reads.has(path)) {
      newInChapter.set(path, chapterOf(list[0].streamPos));
    }
    for (const m of marked) {
      const ci = chapterOf(m.op.streamPos);
      const paths = buckets.get(ci) ?? new Map<string, MarkedOp[]>();
      const bucket = paths.get(path) ?? [];
      bucket.push(m);
      paths.set(path, bucket);
      buckets.set(ci, paths);
    }
  }

  for (const [ci, paths] of buckets) {
    const files: Array<{
      change: FileChange;
      firstTs: string;
      firstSeq: number;
    }> = [];
    for (const [path, marked] of paths) {
      const { groups, adds, dels } = buildGroups(marked);
      const kind: "new" | "mod" =
        newInChapter.get(path) === ci ? "new" : "mod";
      files.push({
        change: { path, kind, adds, dels, groups },
        firstTs: marked[0].op.ts,
        firstSeq: marked[0].op.seq,
      });
      out[ci].adds += adds;
      out[ci].dels += dels;
    }
    out[ci].files = sortByFirstTouch(files);
  }
  return out;
}
