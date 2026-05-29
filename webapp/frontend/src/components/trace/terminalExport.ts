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

// A tool name followed by "(" — the explicit tool-call form, e.g. `Bash(...)`.
const TOOL_CALL_RE = /^([A-Z][A-Za-z0-9_]*)\(([\s\S]*)$/;
// A glyph-less batch summary, e.g. "Read 5 files (ctrl+o to expand)".
const TOOL_SUMMARY_RE =
  /^(Read|Listed|Searched|Wrote|Updated|Fetched)\b.*\b(file|files|pattern|patterns|director\w*|line|lines)\b/;

export function parseTerminalExport(text: string): AnyRec[] {
  const lines = text.split("\n");
  const records: AnyRec[] = [];

  // ---- banner: everything before the first ❯ prompt ----
  let firstPrompt = lines.findIndex((l) => scan(l).glyph === "❯");
  if (firstPrompt < 0) firstPrompt = lines.length;
  const banner = lines.slice(0, firstPrompt);
  const marker: AnyRec = { type: "terminal-meta", source: "terminal" };
  const vm = banner.join("\n").match(VERSION_RE);
  if (vm) marker.version = `v${vm[1]}`;
  for (const l of banner) {
    const s = l.trim();
    if (!s || VERSION_RE.test(s)) continue;
    if (!("modelLabel" in marker) && s.includes("·")) {
      // Strip leading ASCII-art glyphs before the label text.
      const label = s.split("·")[0].replace(/^[^A-Za-z0-9]+/, "").trim();
      if (label) marker.modelLabel = label;
    }
    // Skip lines with "·" (the model-label and announcement lines) so a slash
    // in them (e.g. "/effort", "API/v1") isn't mistaken for the cwd path.
    if (!("cwd" in marker) && !s.includes("·")) {
      const cm = s.match(/(~\/\S+|\/\S+)/);
      if (cm) marker.cwd = cm[1];
    }
  }
  records.push(marker);

  // ---- body ----
  let msgN = 0;
  let toolN = 0;
  let lastToolId: string | null = null;

  type Open =
    | { kind: "prompt"; lines: string[] }
    | { kind: "assistant"; lines: string[] }
    | { kind: "result"; toolId: string; lines: string[] }
    | null;
  let open: Open = null;

  const flush = () => {
    if (!open) return;
    if (open.kind === "prompt") {
      const content = rejoin(open.lines);
      if (content) records.push({ type: "user", message: { content } });
    } else if (open.kind === "assistant") {
      const t = rejoin(open.lines);
      if (t) {
        records.push({
          type: "assistant",
          message: {
            id: `term-msg-${msgN++}`,
            content: [{ type: "text", text: t }],
          },
        });
      }
    } else if (open.kind === "result") {
      const content = open.lines.map((l) => l.trim()).join("\n").trim();
      if (content) {
        records.push({
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: open.toolId, content },
            ],
          },
        });
      }
    }
    open = null;
  };

  const emitToolUse = (name: string, input: AnyRec) => {
    const id = `term-tool-${toolN++}`;
    lastToolId = id;
    records.push({
      type: "assistant",
      message: {
        id: `term-msg-${msgN++}`,
        content: [{ type: "tool_use", id, name, input }],
      },
    });
  };

  for (let i = firstPrompt; i < lines.length; i++) {
    const sc = scan(lines[i]);

    if (sc.glyph === "❯") {
      flush();
      open = { kind: "prompt", lines: [sc.body] };
      continue;
    }
    if (sc.glyph === "✻" || sc.glyph === "※") {
      flush(); // think-time / recap summaries carry no content — drop
      continue;
    }
    if (sc.glyph === "⏺") {
      flush();
      const m = sc.body.match(TOOL_CALL_RE);
      if (m) {
        // Tool input is only the first rendered line (rest is truncated by
        // the renderer anyway); store it raw.
        emitToolUse(m[1], { raw: m[2].replace(/\)\s*$/, "").trim() });
        open = null; // wrapped arg lines are dropped (accepted truncation)
      } else {
        open = { kind: "assistant", lines: [sc.body] };
      }
      continue;
    }
    if (sc.glyph === "⎿") {
      if (open && open.kind === "result") {
        open.lines.push(sc.body);
      } else {
        flush();
        open = lastToolId
          ? { kind: "result", toolId: lastToolId, lines: [sc.body] }
          : null; // orphan output (e.g. /resume → cancelled): drop
      }
      continue;
    }

    // glyph === null
    if (!sc.body) {
      if (open && open.kind === "result") {
        flush(); // a blank line ends a tool's contiguous output block
      } else if (open) {
        open.lines.push(""); // paragraph break within prompt/assistant text
      }
      continue;
    }
    if (TOOL_SUMMARY_RE.test(sc.body) && (!open || open.kind !== "result")) {
      flush();
      emitToolUse(sc.body.split(/\s+/)[0], {});
      open = null;
      continue;
    }
    if (open) open.lines.push(sc.body); // wrapped continuation
  }
  flush();
  return records;
}

// Convenience wrapper for the uploader: serialize to JSONL text and report
// whether any user/assistant content (not just the banner) was recovered.
export function terminalExportToJsonl(text: string): {
  jsonl: string;
  recovered: boolean;
} {
  const records = parseTerminalExport(text);
  const recovered = records.some(
    (r) => r.type === "user" || r.type === "assistant",
  );
  const jsonl = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  return { jsonl, recovered };
}
