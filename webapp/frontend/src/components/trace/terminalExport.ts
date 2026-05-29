// Convert Claude Code's rendered terminal *export* (.txt) into the same
// record shapes the JSONL parser (`buildSession`) consumes. The .txt is a
// lossy presentation-layer rendering: no timestamps, tokens, model id,
// thinking, real ids, or untruncated tool I/O. This is a best-effort
// convenience path; .jsonl remains the full-fidelity input.

// Exported (not a bare local) so `noUnusedLocals` doesn't flag it before
// Task 2's parser consumes it; it's the record shape `buildSession` reads.
export type AnyRec = Record<string, unknown>;

// Glyphs the renderer puts at the start of a logical line.
const GLYPHS = ["❯", "⏺", "⎿", "✻", "※"] as const;
const VERSION_RE = /Claude Code v([0-9][\w.\-]*)/;

interface ScannedLine {
  glyph: string | null;
  body: string;
  indent: number;
}

// Classify a raw line by its leading glyph (after any indentation).
export function scan(line: string): ScannedLine {
  const indent = line.length - line.trimStart().length;
  const t = line.trimStart();
  for (const g of GLYPHS) {
    if (t === g || t.startsWith(g)) {
      return { glyph: g, body: t.slice(g.length).trimStart(), indent };
    }
  }
  return { glyph: null, body: t, indent };
}

// Heuristic: does this text look like a rendered terminal export (vs jsonl)?
export function looksLikeTerminalExport(text: string): boolean {
  const head = text.slice(0, 4000);
  if (VERSION_RE.test(head)) return true;
  return /(^|\n)\s*❯ /.test(text) && /(^|\n)\s*⏺ /.test(text);
}

// Collapse terminal hard-wraps: join wrapped lines with a single space,
// preserving blank lines as paragraph breaks. Lossy (a wrapped path may gain
// a space) and accepted for this path.
export function rejoin(lines: string[]): string {
  const paras: string[] = [];
  let buf = "";
  for (const raw of lines) {
    const s = raw.trim();
    if (!s) {
      if (buf) {
        paras.push(buf);
        buf = "";
      }
      continue;
    }
    buf = buf ? `${buf} ${s}` : s;
  }
  if (buf) paras.push(buf);
  return paras.join("\n\n").trim();
}
