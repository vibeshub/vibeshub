import type { Session, StreamEvent, ToolUseEvent } from "./types";
import type { EditOp, SubagentEntry } from "./changes";
import {
  collectOps,
  groupByPath,
  markSuperseded,
  promptText,
  sortOps,
} from "./changes";
import type { DiffRow } from "./diff";

// provenance.ts — derives the Provenance Blame model from a parsed session:
// per-prompt attribution, per-op rewrite heat, failed attempts, verification
// runs, ephemeral files, and the session outcome. Everything here is computed
// from the transcript; nothing is invented.

export interface PromptInfo {
  idx: number; // 1-based ordinal, matches the gutter column
  uuid: string | null;
  ts: string;
  text: string;
  /** Derived activity note: "3 edit ops · +120 lines" or "wrote no code". */
  note: string;
}

export interface AttemptInfo {
  ok: boolean;
  ts: string;
  label: string;
}

export interface VerificationInfo {
  status: "pass" | "fail" | "none";
  ts: string;
  label: string;
  /** "covers" when the run has path evidence it exercised this file (or it is a
   * whole-suite test); "ran-after" when it merely ran later. Absent on "none". */
  relevance?: "covers" | "ran-after";
}

export interface ResearchInfo {
  agentType: string;
  description: string;
  reads: number;
  editOps: number;
}

export interface BlameHunk {
  id: string;
  jumpUuid: string | null;
  promptIdx: number; // 0 = before the first prompt
  promptUuid: string | null;
  /** First failed attempt's ts when retried, else the op ts. */
  startTs: string;
  ts: string;
  tool: string;
  /** Failed tries + the landing call; 1 for a clean op. */
  attemptCount: number;
  /** Subagent type when a subagent wrote this hunk, null for the main agent. */
  agentType: string | null;
  /** True when this op had at least one failed attempt before landing. */
  retried: boolean;
  rows: DiffRow[];
  /** Parallel to rows: how many ops on this file emitted that exact line. */
  heat: number[];
  adds: number;
  dels: number;
  superseded: { turnLabel: string } | null;
  attempts: AttemptInfo[];
  verifications: VerificationInfo[];
  /** Nearest assistant text or thinking before the op, same turn. */
  reasoning: { ts: string; text: string } | null;
  /** A read-only subagent dispatched earlier under the same prompt. */
  research: ResearchInfo | null;
}

export type BlameFileStatus = "new" | "mod" | "ephemeral";

export interface BlameFile {
  path: string;
  status: BlameFileStatus;
  adds: number; // surviving hunks only
  dels: number;
  hunks: BlameHunk[];
}

export interface AuthorSlice {
  key: "ai" | "agent" | "human";
  label: string;
  lines: number;
  pct: number; // 0-100, of surviving added lines
}

export interface OutcomeEvent {
  ts: string;
  label: string;
  detail: string;
}

export interface ProvenanceStats {
  prompts: number;
  editOps: number;
  files: number;
  reads: number;
  bash: number;
  thinking: number;
  subagents: number;
  /** Summary of the last test run, e.g. "298 passed", or null when none. */
  tests: string | null;
}

export interface ProvenanceModel {
  stats: ProvenanceStats;
  prompts: PromptInfo[];
  attribution: { slices: AuthorSlice[]; notes: string[] };
  files: BlameFile[];
  outcome: OutcomeEvent[];
}

// ---------------------------------------------------------------------------
// Shell-command classification

// The trailing (?![\w./-]) keeps tool names from matching inside larger words
// or paths: "playwright-report", "vitest.config.ts", "jest/".
const TEST_CMD =
  /\b(vitest|jest|pytest|playwright|rspec|phpunit|tox|ctest|busted|(?:go|cargo|bun|deno) test|(?:npm|pnpm|yarn) (?:run )?test\w*|make (?:test|check))(?![\w./-])/;
const BUILD_CMD =
  /\b((?:npm|pnpm|yarn) (?:run )?build|tsc|vite build|next build|cargo build|go build|make build|webpack|esbuild)(?![\w./-])/;
const LINT_CMD =
  /\b(eslint|ruff|flake8|pylint|mypy|clippy|golangci-lint|prettier --check|black --check)(?![\w./-])/;

interface VerifyRun {
  pos: number;
  ts: string;
  kind: "test" | "build" | "lint";
  ok: boolean;
  label: string;
  /** Pass count when the output reported one, e.g. "298". */
  passCount: string | null;
  /** File + directory tokens parsed from the command args and runner output;
   * used to decide which edited files a run actually exercised. */
  refs: string[];
}

// Extensions worth treating as a code/test file reference. Bare directory args
// (`src/tests`, `backend/`) are handled separately in parseRefs.
const FILE_EXT =
  "ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|scala|clj|cljs|ex|exs|css|scss|less|html|vue|svelte|json|yaml|yml|toml|sql|sh|md";
const FILE_TOKEN_G = new RegExp(`[\\w./-]+\\.(?:${FILE_EXT})\\b`, "g");
const FILE_TOKEN_END = new RegExp(`\\.(?:${FILE_EXT})$`);

// File-ish and bare-directory path tokens carried by a run, parsed from the
// heredoc-cut but un-quote-stripped command (a quoted `pytest "tests/x.py"`
// must keep its arg) plus the runner output (vitest/pytest print file paths).
function parseRefs(cmdHead: string, out: string): string[] {
  const refs = new Set<string>();
  const norm = (p: string): string => p.replace(/^\.\//, "");
  for (const src of [cmdHead, out]) {
    for (const m of src.matchAll(FILE_TOKEN_G)) refs.add(norm(m[0]));
  }
  // Bare directory args from the command (`pytest backend/`, `vitest src/tests`).
  for (const raw of cmdHead.split(/\s+/)) {
    const tok = raw.replace(/^["']+|["']+$/g, "");
    if (!tok || tok.startsWith("-")) continue; // flags
    if (!tok.includes("/")) continue; // needs a path separator
    if (FILE_TOKEN_END.test(tok)) continue; // already captured as a file token
    if (/^[\w.][\w./-]*\/?$/.test(tok)) refs.add(norm(tok));
  }
  return [...refs];
}

function resultText(e: ToolUseEvent): string {
  const r = e.result;
  if (!r) return "";
  const parts: string[] = [];
  const tu = r.toolUseResult;
  if (tu?.stdout) parts.push(tu.stdout);
  if (tu?.stderr) parts.push(tu.stderr);
  if (typeof r.content === "string") parts.push(r.content);
  else if (Array.isArray(r.content)) {
    for (const p of r.content as Array<Record<string, unknown>>) {
      if (p && p.type === "text" && typeof p.text === "string") {
        parts.push(p.text);
      }
    }
  }
  return parts.join("\n");
}

function commandOf(e: ToolUseEvent): string | null {
  const c = e.input.command;
  return typeof c === "string" ? c : null;
}

// Classification must look at the command itself, not its string payloads: a
// `gh pr create --body "$(cat <<EOF …npm test…)"` is not a test run. Cut at
// the first heredoc and blank out quoted segments.
function cutHeredoc(cmd: string): string {
  const cut = cmd.indexOf("<<");
  return cut >= 0 ? cmd.slice(0, cut) : cmd;
}

function sanitizeCmd(cmd: string): string {
  return cutHeredoc(cmd).replace(/"[^"]*"|'[^']*'/g, '""');
}

// "vitest run src/tests" -> the matched binary plus a pass/fail summary
// extracted from the output: "vitest · 26 passed".
function classifyRun(e: ToolUseEvent, pos: number): VerifyRun | null {
  const raw = commandOf(e);
  if (!raw) return null;
  const head = cutHeredoc(raw);
  const cmd = sanitizeCmd(raw);
  const m = TEST_CMD.exec(cmd) ?? BUILD_CMD.exec(cmd) ?? LINT_CMD.exec(cmd);
  if (!m) return null;
  const kind: VerifyRun["kind"] = TEST_CMD.test(cmd)
    ? "test"
    : BUILD_CMD.test(cmd)
      ? "build"
      : "lint";
  const ok = !e.result?.isError;
  const out = resultText(e);
  const passed = /(\d+)\s+pass(?:ed|ing)?\b/.exec(out);
  const failed = /(\d+)\s+fail(?:ed|ing)?\b/.exec(out);
  let summary: string;
  if (!ok) summary = failed ? `${failed[1]} failed` : "failed";
  else if (failed && failed[1] !== "0") summary = `${failed[1]} failed`;
  else if (passed) summary = `${passed[1]} passed`;
  else summary = "ok";
  const okFinal = ok && !(failed && failed[1] !== "0");
  return {
    pos,
    ts: e.ts,
    kind,
    ok: okFinal,
    label: `${m[1]} · ${summary}`,
    passCount: okFinal && passed ? passed[1] : null,
    refs: parseRefs(head, out),
  };
}

// ---------------------------------------------------------------------------
// Run ⇄ file relevance

function segs(p: string): string[] {
  return p.split("/").filter(Boolean);
}

// Op paths are usually absolute (`/Users/…/provenance.ts`) while runner output
// is repo-relative (`src/…/provenance.ts`) and meta.cwd may be redacted, so we
// compare on the shared trailing segments (basename at minimum), never equality.
function suffixMatch(a: string, b: string): boolean {
  const as = segs(a);
  const bs = segs(b);
  const [long, short] = as.length >= bs.length ? [as, bs] : [bs, as];
  if (short.length === 0) return false;
  for (let i = 1; i <= short.length; i++) {
    if (long[long.length - i] !== short[short.length - i]) return false;
  }
  return true;
}

// Basename stem with test/spec markers stripped, so a source file and its test
// sibling collapse to one key: a.test.ts -> a, foo.spec.tsx -> foo,
// test_foo.py -> foo, foo_test.py -> foo.
function stemKey(p: string): string {
  let b = segs(p).pop() ?? p;
  b = b.replace(/\.(test|spec)(?=\.[a-z0-9]+$)/i, ""); // a.test.ts -> a.ts
  b = b.replace(/\.[a-z0-9]+$/i, ""); // drop the extension
  b = b.replace(/^test_/, "").replace(/_test$/, ""); // python markers
  return b;
}

// True when `ref` names a directory that contains `opPath`: its segments occur
// as a contiguous run inside opPath with at least one segment after them.
function dirPrefixOf(ref: string, opPath: string): boolean {
  const rs = segs(ref);
  const os = segs(opPath);
  if (rs.length === 0 || rs.length >= os.length) return false;
  for (let start = 0; start + rs.length < os.length; start++) {
    let ok = true;
    for (let j = 0; j < rs.length; j++) {
      if (os[start + j] !== rs[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

// How strongly a run is tied to the edited file (higher wins; ties break on
// temporal order). 3: exercises the file or its test sibling. 2: runs a
// directory containing it. 1: whole-suite test with no path refs (legitimately
// covers everything). 0: ran after but shows no coverage.
function runTier(run: VerifyRun, opPath: string): 0 | 1 | 2 | 3 {
  const opStem = stemKey(opPath);
  for (const ref of run.refs) {
    if (suffixMatch(ref, opPath)) return 3;
    if (FILE_TOKEN_END.test(ref) && stemKey(ref) === opStem) return 3;
  }
  for (const ref of run.refs) {
    if (dirPrefixOf(ref, opPath)) return 2;
  }
  if (run.kind === "test" && run.refs.length === 0) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Per-hunk derivation helpers

// Lines this short are structural noise ("}", "});") whose recurrence across
// ops says nothing about rewrites.
const HEAT_MIN_LINE = 6;
const HEAT_CAP = 4;

function buildHeatIndex(ops: EditOp[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const op of ops) {
    // Count each distinct line once per op: a line repeated inside one Write
    // is not a rewrite.
    const seen = new Set<string>();
    for (const r of op.rows) {
      if (r.kind !== "add") continue;
      const key = r.text.trim();
      if (key.length < HEAT_MIN_LINE || seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function heatOf(rows: DiffRow[], index: Map<string, number>): number[] {
  return rows.map((r) => {
    if (r.kind !== "add") return 1;
    const key = r.text.trim();
    if (key.length < HEAT_MIN_LINE) return 1;
    return Math.min(HEAT_CAP, index.get(key) ?? 1);
  });
}

// A surviving region's file-absolute line span, parsed from its
// structuredPatch @@ header. Patch-less regions (whole-file Writes,
// MultiEdit-without-patch, LCS fallback) have no @@ row, so they return null
// and keep edit order.
export function regionPos(
  rows: DiffRow[],
): { start: number; end: number } | null {
  const head = rows.find((r) => r.kind === "hunk");
  if (!head) return null;
  const m = /\+(\d+)(?:,(\d+))?/.exec(head.text);
  if (!m) return null;
  const start = Number(m[1]);
  const len = m[2] !== undefined ? Number(m[2]) : 1;
  return { start, end: start + Math.max(len, 1) };
}

// Order a file's surviving regions for the merged block: by file position
// when every region is positioned and none overlap, else keep the given
// (chronological) order.
export function orderRegions(regions: BlameHunk[]): BlameHunk[] {
  if (regions.length < 2) return regions;
  const pos = regions.map((r) => regionPos(r.rows));
  if (pos.some((p) => p === null)) return regions;
  const ranges = pos as Array<{ start: number; end: number }>;
  const order = regions
    .map((_, i) => i)
    .sort((a, b) => ranges[a].start - ranges[b].start);
  for (let k = 1; k < order.length; k++) {
    if (ranges[order[k]].start < ranges[order[k - 1]].end) return regions;
  }
  return order.map((i) => regions[i]);
}

function clipText(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length <= n ? t : t.slice(0, n) + "…";
}

function agentTypeOf(badge: string | null): string | null {
  if (!badge) return null;
  const m = /^Task\[(.+)\]$/.exec(badge);
  return m ? m[1] : badge;
}

// Nearest assistant text (preferred) or thinking block before `pos`, without
// crossing back over a user prompt: what the model said right before editing.
function reasoningBefore(
  stream: StreamEvent[],
  pos: number,
): { ts: string; text: string } | null {
  let thinking: { ts: string; text: string } | null = null;
  for (let i = pos - 1; i >= 0; i--) {
    const e = stream[i];
    if (e.kind === "user_prompt") break;
    if (e.kind === "assistant_text" && e.text.trim()) {
      return { ts: e.ts, text: clipText(e.text, 280) };
    }
    if (!thinking && e.kind === "thinking" && e.text.trim()) {
      thinking = { ts: e.ts, text: clipText(e.text, 280) };
    }
  }
  return thinking;
}

// ---------------------------------------------------------------------------

interface AgentFacts {
  pos: number; // Task dispatch position in the main stream
  promptOrdinal: number;
  agentType: string;
  description: string;
  reads: number;
  editOps: number;
}

function collectAgentFacts(
  stream: StreamEvent[],
  subagents: SubagentEntry[],
): AgentFacts[] {
  const taskPos = new Map<string, { pos: number; ordinal: number }>();
  let ordinal = 0;
  stream.forEach((e, pos) => {
    if (e.kind === "user_prompt") ordinal += 1;
    else if (e.kind === "tool_use" && e.name === "Task") {
      taskPos.set(e.id, { pos, ordinal });
    }
  });
  const out: AgentFacts[] = [];
  for (const { agent, stream: sub } of subagents) {
    const at = agent.tool_use_id ? taskPos.get(agent.tool_use_id) : undefined;
    let reads = 0;
    let editOps = 0;
    for (const e of sub) {
      if (e.kind !== "tool_use") continue;
      if (e.name === "Read") reads += 1;
      if (e.name === "Write" || e.name === "Edit" || e.name === "MultiEdit") {
        editOps += 1;
      }
    }
    out.push({
      pos: at?.pos ?? -1,
      promptOrdinal: at?.ordinal ?? 0,
      agentType: agent.agent_type || "agent",
      description: agent.description,
      reads,
      editOps,
    });
  }
  return out;
}

// Did any later shell command remove this path? Shell commands usually name
// the file relative to wherever they ran (which the trace doesn't pin down),
// so match on the path's basename inside an `rm …` command.
function deletedAfter(
  runs: Array<{ pos: number; cmd: string }>,
  path: string,
  afterPos: number,
): boolean {
  const base = path.split("/").pop() ?? path;
  for (const { pos, cmd } of runs) {
    if (pos <= afterPos) continue;
    const head = sanitizeCmd(cmd);
    if (!/\brm\b/.test(head)) continue;
    if (head.includes(base)) return true;
  }
  return false;
}

function countEvents(
  streams: StreamEvent[][],
  pred: (e: StreamEvent) => boolean,
): number {
  let n = 0;
  for (const s of streams) for (const e of s) if (pred(e)) n += 1;
  return n;
}

const AI_LABELS: Record<string, string> = {
  "claude-code": "Claude",
  codex: "Codex",
  cursor: "Cursor",
};

export function buildProvenance(
  session: Session,
  subagents: SubagentEntry[],
  platform?: string,
): ProvenanceModel {
  const { stream, meta } = session;
  const subStreams = subagents.map((s) => s.stream);
  const allStreams = [stream, ...subStreams];

  // -- prompts ---------------------------------------------------------------
  const prompts: PromptInfo[] = [];
  stream.forEach((e) => {
    if (e.kind !== "user_prompt") return;
    prompts.push({
      idx: prompts.length + 1,
      uuid: e.uuid || null,
      ts: e.ts,
      text: promptText(e),
      note: "", // filled in below once ops are known
    });
  });

  // -- edit ops --------------------------------------------------------------
  const { ops, reads } = collectOps(stream, subagents);
  const byPath = groupByPath(ops);
  const agentFacts = collectAgentFacts(stream, subagents);

  // -- shell runs (verification + rm detection + outcome) --------------------
  const verifyRuns: VerifyRun[] = [];
  const shellCmds: Array<{ pos: number; ts: string; cmd: string }> = [];
  stream.forEach((e, pos) => {
    if (e.kind !== "tool_use" || (e.name !== "Bash" && e.name !== "shell")) {
      return;
    }
    const cmd = commandOf(e);
    if (cmd) shellCmds.push({ pos, ts: e.ts, cmd });
    const run = classifyRun(e, pos);
    if (run) verifyRuns.push(run);
  });

  const noneChip: VerificationInfo = {
    status: "none",
    ts: "",
    label: "no test or build run after this change",
  };
  const verificationsAfter = (
    pos: number,
    opPath: string,
  ): VerificationInfo[] => {
    // pos -1 = an unattributable subagent op; "after" is meaningless there.
    const after = pos < 0 ? [] : verifyRuns.filter((r) => r.pos > pos);
    if (after.length === 0) return [noneChip];
    // Rank by how strongly each run covers this file, keeping temporal order
    // (nearest run after the edit first) only as the tiebreaker, then take ≤2.
    const ranked = after
      .map((r) => ({ r, tier: runTier(r, opPath) }))
      .sort((a, b) => b.tier - a.tier || a.r.pos - b.r.pos)
      .slice(0, 2);
    return ranked.map(({ r, tier }) => ({
      status: r.ok ? "pass" : "fail",
      ts: r.ts,
      label: r.label,
      relevance: tier >= 1 ? "covers" : "ran-after",
    }));
  };

  // -- files + hunks ---------------------------------------------------------
  const files: Array<{ file: BlameFile; firstTs: string; firstSeq: number }> =
    [];
  for (const [path, list] of byPath) {
    sortOps(list);
    const okOps = list.filter((o) => !o.failed);
    if (okOps.length === 0) continue; // only failed attempts: nothing landed
    const heatIndex = buildHeatIndex(list);
    const marked = markSuperseded(okOps);

    const hunks: BlameHunk[] = [];
    let fileAdds = 0;
    let fileDels = 0;
    // Walk failed ops once, attaching each to the next ok op in the file's
    // sorted order (NOT seq: seq is collection order, which subagent ops break).
    const orderOf = new Map(list.map((o, i) => [o, i]));
    let cursor = 0;
    const failedOps = list.filter((o) => o.failed);
    for (const { op, supersededBy } of marked) {
      const attempts: AttemptInfo[] = [];
      while (
        cursor < failedOps.length &&
        orderOf.get(failedOps[cursor])! < orderOf.get(op)!
      ) {
        const f = failedOps[cursor];
        attempts.push({
          ok: false,
          ts: f.ts,
          label: `${f.tool} failed: ${clipText(f.errorText ?? "tool error", 120)}`,
        });
        cursor += 1;
      }
      if (attempts.length > 0) {
        attempts.push({ ok: true, ts: op.ts, label: `${op.tool} succeeded` });
      }

      let adds = 0;
      let dels = 0;
      for (const r of op.rows) {
        if (r.kind === "add") adds += 1;
        else if (r.kind === "del") dels += 1;
      }
      if (!supersededBy) {
        fileAdds += adds;
        fileDels += dels;
      }

      const research =
        agentFacts.find(
          (a) =>
            a.editOps === 0 &&
            a.pos >= 0 &&
            a.pos < op.streamPos &&
            a.promptOrdinal === op.prompt.ordinal,
        ) ?? null;

      hunks.push({
        id: `${path}#${op.seq}`,
        jumpUuid: op.jumpUuid,
        promptIdx: op.prompt.ordinal,
        promptUuid: op.prompt.uuid,
        startTs: attempts.length > 0 ? attempts[0].ts : op.ts,
        ts: op.ts,
        tool: op.tool,
        attemptCount: attempts.length > 0 ? attempts.length : 1,
        agentType: agentTypeOf(op.agentBadge),
        retried: attempts.length > 0,
        rows: op.rows,
        heat: heatOf(op.rows, heatIndex),
        adds,
        dels,
        superseded: supersededBy,
        attempts,
        verifications: verificationsAfter(op.streamPos, path),
        reasoning:
          op.streamPos >= 0 ? reasoningBefore(stream, op.streamPos) : null,
        research: research
          ? {
              agentType: research.agentType,
              description: research.description,
              reads: research.reads,
              editOps: research.editOps,
            }
          : null,
      });
    }

    const first = okOps[0];
    const lastPos = Math.max(...list.map((o) => o.streamPos));
    const status: BlameFileStatus = deletedAfter(shellCmds, path, lastPos)
      ? "ephemeral"
      : first.isWrite && !reads.has(path)
        ? "new"
        : "mod";

    files.push({
      file: { path, status, adds: fileAdds, dels: fileDels, hunks },
      firstTs: first.ts,
      firstSeq: first.seq,
    });
  }
  files.sort(
    (a, b) =>
      (a.firstTs && b.firstTs ? a.firstTs.localeCompare(b.firstTs) : 0) ||
      a.firstSeq - b.firstSeq,
  );
  const blameFiles = files.map((f) => f.file);

  // -- prompt notes ----------------------------------------------------------
  const opsByOrdinal = new Map<number, { ops: number; adds: number }>();
  for (const op of ops) {
    if (op.failed) continue;
    const slot = opsByOrdinal.get(op.prompt.ordinal) ?? { ops: 0, adds: 0 };
    slot.ops += 1;
    slot.adds += op.rows.filter((r) => r.kind === "add").length;
    opsByOrdinal.set(op.prompt.ordinal, slot);
  }
  for (const p of prompts) {
    const slot = opsByOrdinal.get(p.idx);
    p.note = slot
      ? `${slot.ops} edit ${slot.ops === 1 ? "op" : "ops"} · +${slot.adds} lines`
      : "wrote no code";
  }

  // -- attribution -----------------------------------------------------------
  const aiLabel = AI_LABELS[platform ?? ""] ?? "AI";
  const survivingAdds = new Map<string | null, number>(); // agentBadge -> lines
  for (const [, list] of byPath) {
    // recompute marks per path on ok ops only (cheap; lists are small)
    const okOps = list.filter((o) => !o.failed);
    for (const { op, supersededBy } of markSuperseded(okOps)) {
      if (supersededBy) continue;
      const n = op.rows.filter((r) => r.kind === "add").length;
      survivingAdds.set(
        op.agentBadge,
        (survivingAdds.get(op.agentBadge) ?? 0) + n,
      );
    }
  }
  const totalAdds = [...survivingAdds.values()].reduce((a, b) => a + b, 0);
  const pct = (n: number): number =>
    totalAdds === 0 ? 0 : Math.round((n / totalAdds) * 100);
  const slices: AuthorSlice[] = [
    {
      key: "ai",
      label: aiLabel,
      lines: survivingAdds.get(null) ?? 0,
      pct: pct(survivingAdds.get(null) ?? 0),
    },
  ];
  for (const [badge, lines] of survivingAdds) {
    if (badge === null) continue;
    const type = agentTypeOf(badge) ?? "agent";
    slices.push({ key: "agent", label: `${type} subagent`, lines, pct: pct(lines) });
  }
  // Read-only subagents still earn a legend entry: research is part of the story.
  for (const a of agentFacts) {
    if (a.editOps > 0) continue;
    if (slices.some((s) => s.label === `${a.agentType} subagent`)) continue;
    slices.push({ key: "agent", label: `${a.agentType} subagent`, lines: 0, pct: 0 });
  }
  slices.push({ key: "human", label: "human", lines: 0, pct: 0 });

  const notes: string[] = [];
  for (const a of agentFacts) {
    if (a.editOps === 0 && a.reads > 0) {
      notes.push(
        `The ${a.agentType} subagent made ${a.reads} reads but wrote 0 lines.`,
      );
    }
  }
  if (prompts.length > 0) {
    notes.push(
      `The human wrote 0 lines and ${prompts.length} ${
        prompts.length === 1 ? "prompt" : "prompts"
      }.`,
    );
  }

  // -- outcome ---------------------------------------------------------------
  const outcome: OutcomeEvent[] = [];
  const lastTest = [...verifyRuns].reverse().find((r) => r.kind === "test");
  if (lastTest) {
    outcome.push({
      ts: lastTest.ts,
      label: lastTest.ok ? "Final test run" : "Last test run failed",
      detail: lastTest.label,
    });
  }
  const lastBuild = [...verifyRuns].reverse().find((r) => r.kind === "build");
  if (lastBuild) {
    outcome.push({
      ts: lastBuild.ts,
      label: lastBuild.ok ? "Build passed" : "Build failed",
      detail: lastBuild.label,
    });
  }
  const commit = [...shellCmds]
    .reverse()
    .find((c) => /\bgit commit\b/.test(sanitizeCmd(c.cmd)));
  if (commit) {
    // Heredoc-style messages (-m "$(cat <<EOF …)") aren't worth quoting.
    const m = /-m\s+["']([^"'\n]+)/.exec(commit.cmd);
    const msg = m && !m[1].startsWith("$(") ? m[1] : null;
    outcome.push({
      ts: commit.ts,
      label: "Commit",
      detail:
        (msg ? `"${clipText(msg, 60)}"` : "") +
        (meta.gitBranch ? `${msg ? " on " : "on "}${meta.gitBranch}` : ""),
    });
  }
  if (meta.prLink) {
    outcome.push({
      ts: meta.prLink.at,
      label: `PR #${meta.prLink.number} opened`,
      detail: meta.prLink.repo,
    });
  }
  const merge = [...shellCmds]
    .reverse()
    .find((c) => /\bgh pr merge\b|\bgit merge\b/.test(sanitizeCmd(c.cmd)));
  if (merge) {
    outcome.push({ ts: merge.ts, label: "Merged", detail: "" });
  }
  outcome.sort((a, b) => a.ts.localeCompare(b.ts));

  // -- stats -----------------------------------------------------------------
  const stats: ProvenanceStats = {
    prompts: prompts.length,
    editOps: ops.length,
    files: blameFiles.length,
    reads: countEvents(
      allStreams,
      (e) => e.kind === "tool_use" && e.name === "Read",
    ),
    bash: countEvents(
      allStreams,
      (e) => e.kind === "tool_use" && (e.name === "Bash" || e.name === "shell"),
    ),
    thinking: countEvents(allStreams, (e) => e.kind === "thinking"),
    subagents: subagents.length,
    tests: lastTest
      ? lastTest.passCount
        ? `${lastTest.passCount} ✓`
        : lastTest.ok
          ? "✓"
          : "✗"
      : null,
  };

  return {
    stats,
    prompts,
    attribution: { slices, notes },
    files: blameFiles,
    outcome,
  };
}
