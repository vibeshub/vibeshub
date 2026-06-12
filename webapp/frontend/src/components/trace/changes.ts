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

// DOM id for a file card, used by the index strip's scroll links.
export function changeAnchorId(path: string): string {
  return "change-" + path.replace(/[^a-zA-Z0-9_-]/g, "-");
}

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "apply_patch"]);

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
): EditOp[] {
  const path = typeof e.input.file_path === "string" ? e.input.file_path : null;
  if (!path) return [];
  const patch = extractPatch(e.result?.toolUseResult?.structuredPatch);
  const base = { path, ts: e.ts, jumpUuid, prompt, agentBadge };

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

export function buildFileChanges(
  stream: StreamEvent[],
  subagents: SubagentEntry[],
): FileChange[] {
  // Pass over the main stream: prompt ordinals, the prompt active at each
  // tool call, Task dispatch lookups, and Read paths (for new/mod).
  const reads = new Set<string>();
  const ops: EditOp[] = [];
  const taskByToolId = new Map<
    string,
    { uuid: string | null; prompt: PromptRef }
  >();
  let current = SESSION_START;
  let ordinal = 0;

  for (const e of stream) {
    if (e.kind === "user_prompt") {
      ordinal += 1;
      current = promptRef(e, ordinal);
      continue;
    }
    if (e.kind !== "tool_use") continue;
    if (e.name === "Read" && typeof e.input.file_path === "string") {
      reads.add(e.input.file_path);
    }
    if (e.name === "Task") {
      taskByToolId.set(e.id, { uuid: e.uuid || null, prompt: current });
    }
    if (WRITE_TOOLS.has(e.name)) {
      ops.push(...opsFromTool(e, current, e.uuid || null, null));
    }
  }

  // Subagent streams: edits attach to the spawning Task card and the prompt
  // that was active when it was dispatched.
  for (const { agent, stream: sub } of subagents) {
    const dispatch = agent.tool_use_id
      ? taskByToolId.get(agent.tool_use_id)
      : undefined;
    const prompt = dispatch?.prompt ?? SESSION_START;
    const jumpUuid = dispatch?.uuid ?? null;
    const badge = `Task[${agent.agent_type}]`;
    for (const e of sub) {
      if (e.kind !== "tool_use") continue;
      if (e.name === "Read" && typeof e.input.file_path === "string") {
        reads.add(e.input.file_path);
      }
      if (WRITE_TOOLS.has(e.name)) {
        ops.push(...opsFromTool(e, prompt, jumpUuid, badge));
      }
    }
  }

  const byPath = new Map<string, EditOp[]>();
  for (const op of ops) {
    const list = byPath.get(op.path) ?? [];
    list.push(op);
    byPath.set(op.path, list);
  }

  const files: Array<{ change: FileChange; firstTs: string }> = [];
  for (const [path, list] of byPath) {
    // ISO timestamps compare lexicographically; sort is stable so ts ties
    // keep stream order.
    list.sort((a, b) => a.ts.localeCompare(b.ts));

    // Supersede pass: a Write replaces everything before it; an edit whose
    // old_string textually contains ALL of an earlier hunk's emitted content
    // replaces that hunk. Exact substring only; empty fragments never match
    // (false negatives are fine, false positives are not).
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

    const groups: CaptionGroup[] = [];
    let adds = 0;
    let dels = 0;
    list.forEach((op, idx) => {
      const hunk: ChangeHunk = {
        jumpUuid: op.jumpUuid,
        ts: op.ts,
        rows: op.rows,
        supersededBy: superseded[idx],
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
    });

    const first = list[0];
    const kind: "new" | "mod" =
      first.isWrite && !reads.has(path) ? "new" : "mod";
    files.push({ change: { path, kind, adds, dels, groups }, firstTs: first.ts });
  }

  files.sort((a, b) => a.firstTs.localeCompare(b.firstTs));
  return files.map((f) => f.change);
}
