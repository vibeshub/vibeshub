export function fmtDuration(ms: number): string {
  if (!ms || ms <= 0) return "0s";
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function fmtDurationCompact(ms: number): string {
  if (!ms || ms <= 0) return "0s";
  const totalSec = ms / 1000;
  if (totalSec < 60) return `${totalSec.toFixed(1)}s`;
  const m = totalSec / 60;
  if (m < 60) return `${m.toFixed(1)}m`;
  return `${(m / 60).toFixed(1)}h`;
}

export function fmtTokens(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  return (n / 1_000_000).toFixed(1) + "M";
}

export function fmtTimestamp(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
  });
}

export function fmtTimeOfDay(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function shortenPath(
  path: string | null | undefined,
  root: string | null | undefined,
): string {
  if (!path) return "";
  if (root && path.startsWith(root)) {
    const sub = path.slice(root.length).replace(/^\/+/, "");
    return sub || path.split("/").pop() || path;
  }
  return path;
}

export function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

export function clip(text: string | null | undefined, n: number): string {
  if (!text) return "";
  if (text.length <= n) return text;
  return text.slice(0, n) + "…";
}

export type MdBlock =
  | { type: "h2" | "h3" | "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "code"; text: string; lang?: string };

// Classify a run of non-code text by splitting it on blank lines.
function classifyProse(chunk: string): MdBlock[] {
  const out: MdBlock[] = [];
  for (const block of chunk.split(/\n{2,}/)) {
    if (!block.trim()) continue;
    if (/^###\s/.test(block)) {
      out.push({ type: "h3", text: block.replace(/^###\s+/, "") });
      continue;
    }
    if (/^##\s/.test(block)) {
      out.push({ type: "h2", text: block.replace(/^##\s+/, "") });
      continue;
    }
    if (/^#\s/.test(block)) {
      out.push({ type: "h2", text: block.replace(/^#\s+/, "") });
      continue;
    }
    const lines = block.split("\n");
    if (
      lines.length > 0 &&
      lines.every((l) => /^[-*]\s+/.test(l.trim()) || l.trim() === "")
    ) {
      const items = lines
        .filter((l) => l.trim())
        .map((l) => l.trim().replace(/^[-*]\s+/, ""));
      out.push({ type: "ul", items });
      continue;
    }
    out.push({ type: "p", text: block });
  }
  return out;
}

export function renderMarkdownish(text: string | null | undefined): MdBlock[] {
  if (!text) return [];
  // Fenced code blocks must be carved out line-by-line *before* splitting on
  // blank lines — a code block can legitimately contain blank lines, and the
  // fence markers themselves never participate in prose parsing.
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let prose: string[] = [];
  const flushProse = () => {
    if (prose.length) {
      blocks.push(...classifyProse(prose.join("\n").trim()));
      prose = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(/^\s*```+\s*([^`]*?)\s*$/);
    if (open) {
      flushProse();
      const lang = open[1].trim();
      i++;
      const body: string[] = [];
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // skip the closing fence (no-op past end for an unterminated fence)
      const block: MdBlock = { type: "code", text: body.join("\n") };
      if (lang) block.lang = lang;
      blocks.push(block);
    } else {
      prose.push(lines[i]);
      i++;
    }
  }
  flushProse();
  return blocks;
}

export type InlineSpan = { t: "text" | "strong" | "em" | "code"; text: string };

export function inlineFormat(text: string): InlineSpan[] {
  const parts: InlineSpan[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push({ t: "text", text: text.slice(last, m.index) });
    }
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push({ t: "strong", text: tok.slice(2, -2) });
    } else if (tok.startsWith("*")) {
      parts.push({ t: "em", text: tok.slice(1, -1) });
    } else {
      parts.push({ t: "code", text: tok.slice(1, -1) });
    }
    last = m.index + tok.length;
  }
  if (last < text.length) {
    parts.push({ t: "text", text: text.slice(last) });
  }
  return parts;
}

export function stringifyToolInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

export function toolSummary(
  name: string,
  input: Record<string, unknown> | null | undefined,
  root: string | null | undefined,
): string {
  if (!input) return "";
  const s = (k: string): string | undefined => {
    const v = input[k];
    return typeof v === "string" ? v : undefined;
  };
  switch (name) {
    case "Bash":
      return s("command") || s("description") || "";
    case "Read":
    case "Glob":
    case "Grep": {
      const fp = s("file_path");
      if (fp) return shortenPath(fp, root);
      return s("pattern") || s("path") || "";
    }
    case "Write":
    case "Edit":
    case "MultiEdit":
      return shortenPath(s("file_path") || s("path") || "", root);
    case "AskUserQuestion": {
      const qs = (input.questions as Array<{ question?: string }>) || [];
      if (qs.length === 0) return "";
      const first = qs[0]?.question || "";
      return first + (qs.length > 1 ? ` (+${qs.length - 1} more)` : "");
    }
    case "TaskCreate":
      return s("subject") || s("activeForm") || "";
    case "TaskUpdate":
      return `Task ${s("taskId") || "?"} → ${s("status") || "?"}`;
    case "Skill":
      return s("skill") || "";
    case "Agent":
      return (
        s("description") ||
        (s("subagent_type") ? `dispatch ${s("subagent_type")}` : "")
      );
    case "ToolSearch":
      return s("query") || s("pattern") || "";
    default:
      return truncate(stringifyToolInput(input).replace(/\s+/g, " "), 80);
  }
}
