export type DiffRowKind = "add" | "del" | "ctx" | "hunk";

export interface DiffRow {
  kind: DiffRowKind;
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

// Flatten Claude Code's structuredPatch hunks into numbered rows. Each hunk
// line is prefixed with " " (context), "+" (added) or "-" (removed).
export function rowsFromStructuredPatch(patch: PatchHunk[]): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const h of patch) {
    rows.push({
      kind: "hunk",
      oldNo: null,
      newNo: null,
      text: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
    });
    let oldNo = h.oldStart;
    let newNo = h.newStart;
    for (const line of h.lines) {
      const marker = line[0];
      if (marker === "+") {
        rows.push({ kind: "add", oldNo: null, newNo, text: line.slice(1) });
        newNo++;
      } else if (marker === "-") {
        rows.push({ kind: "del", oldNo, newNo: null, text: line.slice(1) });
        oldNo++;
      } else {
        // " " prefix is a context line; an empty or unprefixed line (no real
        // marker) is also treated as context, kept verbatim.
        rows.push({
          kind: "ctx",
          oldNo,
          newNo,
          text: marker === " " ? line.slice(1) : line,
        });
        oldNo++;
        newNo++;
      }
    }
  }
  return rows;
}

// Render brand-new file content as an all-additions diff.
export function rowsFromNewFile(content: string): DiffRow[] {
  if (content === "") return [];
  return content.split("\n").map((text, i) => ({
    kind: "add" as const,
    oldNo: null,
    newNo: i + 1,
    text,
  }));
}

// LCS line diff for traces with no structuredPatch (older Claude Code logs).
export function fallbackDiff(oldStr: string, newStr: string): DiffRow[] {
  const a = oldStr === "" ? [] : oldStr.split("\n");
  const b = newStr === "" ? [] : newStr.split("\n");
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ kind: "ctx", oldNo: i + 1, newNo: j + 1, text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: "del", oldNo: i + 1, newNo: null, text: a[i] });
      i++;
    } else {
      rows.push({ kind: "add", oldNo: null, newNo: j + 1, text: b[j] });
      j++;
    }
  }
  while (i < n) {
    rows.push({ kind: "del", oldNo: i + 1, newNo: null, text: a[i] });
    i++;
  }
  while (j < m) {
    rows.push({ kind: "add", oldNo: null, newNo: j + 1, text: b[j] });
    j++;
  }
  return rows;
}

// Narrow an untyped toolUseResult.structuredPatch into PatchHunk[], or null.
export function extractPatch(patch: unknown): PatchHunk[] | null {
  if (!Array.isArray(patch)) return null;
  const out: PatchHunk[] = [];
  for (const h of patch) {
    if (h && typeof h === "object") {
      const o = h as Record<string, unknown>;
      if (
        typeof o.oldStart === "number" &&
        typeof o.newStart === "number" &&
        Array.isArray(o.lines)
      ) {
        out.push({
          oldStart: o.oldStart,
          oldLines: typeof o.oldLines === "number" ? o.oldLines : 0,
          newStart: o.newStart,
          newLines: typeof o.newLines === "number" ? o.newLines : 0,
          lines: (o.lines as unknown[]).map((l) => String(l)),
        });
      }
    }
  }
  return out.length > 0 ? out : null;
}

// Build diff rows for a Write/Edit/MultiEdit tool call. Prefers the
// structuredPatch; falls back to Write content or Edit old/new strings.
export function buildWriteRows(
  input: Record<string, unknown>,
  patch: PatchHunk[] | null,
): DiffRow[] {
  if (patch && patch.length > 0) return rowsFromStructuredPatch(patch);
  if (typeof input.content === "string") return rowsFromNewFile(input.content);
  if (
    typeof input.old_string === "string" &&
    typeof input.new_string === "string"
  ) {
    return fallbackDiff(input.old_string, input.new_string);
  }
  // MultiEdit fallback (no structuredPatch): each edit is diffed independently,
  // so line numbers restart at 1 per edit rather than being file-absolute.
  if (Array.isArray(input.edits)) {
    const rows: DiffRow[] = [];
    for (const e of input.edits) {
      if (e && typeof e === "object") {
        const o = e as Record<string, unknown>;
        if (
          typeof o.old_string === "string" &&
          typeof o.new_string === "string"
        ) {
          rows.push(...fallbackDiff(o.old_string, o.new_string));
        }
      }
    }
    return rows;
  }
  return [];
}
