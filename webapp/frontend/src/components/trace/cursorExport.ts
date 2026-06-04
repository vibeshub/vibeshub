// Convert a raw Cursor agent transcript (.jsonl) into the canonical
// Claude-shaped records buildSession consumes. Cursor records are already
// close to canonical: { role, message: { content: [blocks] } }. We add a
// synthetic top-level uuid per record, emit a cursor-meta marker, strip the
// <user_query>/<timestamp> envelope from user text, parse coarse timestamps,
// and assign deterministic ids to Task/Subagent calls so subagents nest under
// their spawning card (see link_cursor_subagents in the plugin — same scheme).

type AnyRec = Record<string, unknown>;

const TS_RE = /<timestamp>([\s\S]*?)<\/timestamp>/;
const QUERY_RE = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/;

export function looksLikeCursor(text: string): boolean {
  const nl = text.indexOf("\n");
  const firstLine = (nl === -1 ? text : text.slice(0, nl)).trim();
  if (!firstLine) return false;
  try {
    const rec = JSON.parse(firstLine) as AnyRec;
    if ("type" in rec) return false; // Claude/Codex/terminal records carry a top-level type
    const msg = rec.message as AnyRec | undefined;
    return (
      (rec.role === "user" || rec.role === "assistant") &&
      !!msg && Array.isArray(msg.content)
    );
  } catch {
    return false;
  }
}

// "Wednesday, Jun 3, 2026, 7:30 PM (UTC-7)" -> ISO instant. Coarse (minute
// precision, user turns only). Returns null when unparseable.
function parseCursorTimestamp(raw: string): string | null {
  const m = raw.match(
    /([A-Za-z]+ \d{1,2}, \d{4}),?\s+(\d{1,2}:\d{2})\s*([AaPp][Mm])\s*\(UTC([+-]\d{1,2})(?::?(\d{2}))?\)/,
  );
  if (!m) return null;
  const [, date, hm, ap, offH, offM] = m;
  const wallMs = Date.parse(`${date} ${hm} ${ap.toUpperCase()} UTC`);
  if (Number.isNaN(wallMs)) return null;
  const sign = offH.startsWith("-") ? -1 : 1;
  const offsetMin = parseInt(offH, 10) * 60 + sign * parseInt(offM || "0", 10);
  // wall clock is in (UTC + offset); true UTC = wall - offset.
  return new Date(wallMs - offsetMin * 60_000).toISOString();
}

function userText(content: AnyRec[]): string {
  return content
    .filter((b) => b && b.type === "text")
    .map((b) => String(b.text ?? ""))
    .join("\n");
}

export function cursorToJsonl(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const records: AnyRec[] = [];
  let recN = 0;
  const uuid = () => `cursor-rec-${recN++}`;
  let lastTs = "";
  let agentN = 0; // ordinal of Task/Subagent dispatches, in document order

  // One synthetic assistant record per content block. The canonical parser
  // (parser.ts Pass 2) renders only the LAST block of each assistant record, so
  // every block MUST be its own record (mirrors codexExport.ts pushAssistant).
  const pushAssistant = (block: AnyRec, ts: string): void => {
    records.push({
      type: "assistant", uuid: uuid(), timestamp: ts,
      message: { id: `cursor-msg-${recN}`, model: null, content: [block] },
    });
  };

  records.push({ type: "cursor-meta", source: "cursor", uuid: uuid(), timestamp: "", sessionId: null, cwd: null });

  for (const raw of lines) {
    let rec: AnyRec;
    try { rec = JSON.parse(raw) as AnyRec; } catch { continue; }
    const role = rec.role;
    const msg = (rec.message ?? {}) as AnyRec;
    const content = (msg.content ?? []) as AnyRec[];
    if (!Array.isArray(content)) continue;

    if (role === "user") {
      const rawText = userText(content);
      const tsM = rawText.match(TS_RE);
      if (tsM) {
        const iso = parseCursorTimestamp(tsM[1]);
        if (iso) lastTs = iso;
      }
      const q = rawText.match(QUERY_RE);
      const clean = (q ? q[1] : rawText.replace(TS_RE, "")).trim();
      records.push({ type: "user", uuid: uuid(), timestamp: lastTs, message: { content: clean } });
      continue;
    }

    if (role === "assistant") {
      for (const b of content) {
        if (!b || typeof b !== "object") continue;
        const block = b as AnyRec;
        if (block.type === "text") {
          pushAssistant({ type: "text", text: String(block.text ?? "") }, lastTs);
        } else if (block.type === "thinking") {
          pushAssistant({ type: "thinking", thinking: String(block.thinking ?? "") }, lastTs);
        } else if (block.type === "tool_use") {
          const isAgent = block.name === "Task" || block.name === "Subagent";
          const id = isAgent ? `cursor-agent-${agentN++}` : `cursor-tool-${recN}`;
          pushAssistant({ type: "tool_use", id, name: String(block.name ?? ""), input: block.input ?? {} }, lastTs);
        }
      }
      continue;
    }
  }
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}
