import type { AgentSummary } from "../../types";
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

// DOM id for a file card, used by the index list's scroll links.
export function changeAnchorId(path: string): string {
  return "change-" + path.replace(/[^a-zA-Z0-9_-]/g, "-");
}

// Tool names that modify a file (carry input.file_path). Shared with
// deriveFiles in Outcome.tsx so the two walks can't drift.
export const FILE_EDIT_TOOLS = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "apply_patch",
]);

export interface PromptRef {
  uuid: string | null;
  ordinal: number; // 1-based; 0 for edits before the first prompt
  excerpt: string;
  turnLabel: string;
}

const SESSION_START: PromptRef = {
  uuid: null,
  ordinal: 0,
  excerpt: "session start",
  turnLabel: "session start",
};

function clipExcerpt(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= 90 ? t : t.slice(0, 90) + "…";
}

// The raw prompt text: slash commands format as "name args", free text as is.
export function promptText(e: UserPromptEvent): string {
  return e.command
    ? e.command.args
      ? `${e.command.name} ${e.command.args}`
      : e.command.name
    : e.text;
}

function promptRef(e: UserPromptEvent, ordinal: number): PromptRef {
  return {
    uuid: e.uuid || null,
    ordinal,
    excerpt: clipExcerpt(promptText(e)),
    turnLabel: `turn ${ordinal}`,
  };
}

// Failed tool calls report their reason as plain text in result.content
// (string, or a list of text blocks), sometimes wrapped in <tool_use_error>.
function cleanError(t: string): string | null {
  const s = t.replace(/<\/?tool_use_error>/g, "").trim();
  return s || null;
}

function resultErrorText(e: ToolUseEvent): string | null {
  if (!e.result?.isError) return null;
  const c = e.result.content;
  if (typeof c === "string") return cleanError(c);
  if (Array.isArray(c)) {
    for (const part of c as Array<Record<string, unknown>>) {
      if (part && part.type === "text" && typeof part.text === "string") {
        const t = cleanError(part.text);
        if (t) return t;
      }
    }
  }
  return null;
}

// One file-edit operation flattened to what grouping and the supersede pass
// need. MultiEdit without a structuredPatch yields one op per sub-edit.
export interface EditOp {
  path: string;
  tool: string; // tool name as recorded: Write / Edit / MultiEdit / apply_patch
  ts: string;
  seq: number; // stream walk order: tiebreaker, and fallback when ts is missing
  streamPos: number; // main-stream index (Task event for subagent ops, -1 unknown)
  jumpUuid: string | null;
  prompt: PromptRef;
  agentBadge: string | null;
  isWrite: boolean;
  failed: boolean; // the tool call errored; the file was not actually changed
  errorText: string | null;
  rows: DiffRow[];
  newContents: string[]; // emitted content, supersede targets
  oldStrings: string[]; // supersede sources
  originalFile: string | null; // full pre-edit file content, when captured
  finalContent: string | null; // full post-edit file content, when captured
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
  const tur = e.result?.toolUseResult;
  const originalFile =
    tur && typeof tur.originalFile === "string" ? tur.originalFile : null;
  const finalContent =
    tur && typeof tur.content === "string" ? tur.content : null;
  // seq is assigned post-hoc in collectOps once all ops are collected.
  const base = {
    path,
    tool: e.name,
    ts: e.ts,
    seq: 0,
    streamPos,
    jumpUuid,
    prompt,
    agentBadge,
    failed: !!e.result?.isError,
    errorText: resultErrorText(e),
    originalFile,
    finalContent,
  };

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
export function collectOps(
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
export function sortOps(list: EditOp[]): void {
  list.sort(
    (a, b) => (a.ts && b.ts ? a.ts.localeCompare(b.ts) : 0) || a.seq - b.seq,
  );
}

export interface MarkedOp {
  op: EditOp;
  supersededBy: { turnLabel: string } | null;
}

// Supersede pass over one file's sorted ops: a Write replaces everything
// before it; an edit whose old_string textually contains ALL of an earlier
// hunk's emitted content replaces that hunk. Exact substring only; empty
// fragments never match (false negatives are fine, false positives are not).
export function markSuperseded(list: EditOp[]): MarkedOp[] {
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

export function groupByPath(ops: EditOp[]): Map<string, EditOp[]> {
  const byPath = new Map<string, EditOp[]>();
  for (const op of ops) {
    const list = byPath.get(op.path) ?? [];
    list.push(op);
    byPath.set(op.path, list);
  }
  return byPath;
}
