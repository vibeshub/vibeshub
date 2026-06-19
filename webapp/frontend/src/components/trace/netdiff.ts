import type { EditOp } from "./changes";
import type { DiffRow } from "./diff";
import { fallbackDiff } from "./diff";

// netdiff.ts — reconstructs one consolidated before/after diff per file from the
// transcript's captured pre/post file content, with best-effort per-line
// attribution back to the op that wrote each line.

// A net-diff row plus its provenance link: hunkId points at the BlameHunk
// (`${path}#${seq}`) of the op that last wrote this line, or null when the line
// is context, a deletion, or could not be confidently attributed (file-level).
export type NetRow = DiffRow & { hunkId: string | null };

export interface NetFileData {
  netRows: NetRow[];
  netAdds: number;
  netDels: number;
  hasNetData: boolean;
}

const EMPTY: NetFileData = {
  netRows: [],
  netAdds: 0,
  netDels: 0,
  hasNetData: false,
};

// The distinct, trimmed, non-empty lines each op emitted, in op order.
function introducedLines(
  ops: EditOp[],
): Array<{ seq: number; lines: Set<string> }> {
  return ops.map((op) => {
    const lines = new Set<string>();
    for (const content of op.newContents) {
      for (const raw of content.split("\n")) {
        const t = raw.trim();
        if (t) lines.add(t);
      }
    }
    return { seq: op.seq, lines };
  });
}

// Attribute each added line to the latest op that emitted it. Context and
// deletion rows are file-level (null); the panel resolves null to the file view.
function attribute(rows: DiffRow[], ops: EditOp[], path: string): NetRow[] {
  const intro = introducedLines(ops);
  return rows.map((row) => {
    if (row.kind !== "add") return { ...row, hunkId: null };
    const t = row.text.trim();
    for (let i = intro.length - 1; i >= 0; i--) {
      if (t && intro[i].lines.has(t)) {
        return { ...row, hunkId: `${path}#${intro[i].seq}` };
      }
    }
    return { ...row, hunkId: null };
  });
}

// Reconstruct the net before/after for one file from its successful ops, sorted
// ascending. baseline = the first op's originalFile (or "" for an in-session
// create); final = the last op's finalContent (or "" when the file was deleted).
// Returns hasNetData:false when either endpoint cannot be resolved, so the
// caller can fall back to the per-op view.
export function buildNetFile(
  path: string,
  okOps: EditOp[],
  deleted = false,
): NetFileData {
  if (okOps.length === 0) return EMPTY;
  const first = okOps[0];
  const last = okOps[okOps.length - 1];

  let baseline: string;
  if (typeof first.originalFile === "string") baseline = first.originalFile;
  else if (first.isWrite) baseline = "";
  else return EMPTY; // an Edit with no captured original: cannot reconstruct

  let final: string;
  if (deleted) final = "";
  else if (typeof last.finalContent === "string") final = last.finalContent;
  else return EMPTY; // no captured final content

  const rows = fallbackDiff(baseline, final);
  return {
    netRows: attribute(rows, okOps, path),
    netAdds: rows.filter((r) => r.kind === "add").length,
    netDels: rows.filter((r) => r.kind === "del").length,
    hasNetData: true,
  };
}
