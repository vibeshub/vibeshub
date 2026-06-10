import { buildSession, parseJsonl } from "./parser";
import { looksLikeTerminalExport, terminalExportToJsonl } from "./terminalExport";
import type { Session } from "./types";

// A stored transcript always starts with a JSON record; raw terminal
// exports start with banner text. Gate the terminal net on that so
// transcript content mentioning "Claude Code v..." can't false-positive.
function startsWithJsonRecord(text: string): boolean {
  const nl = text.indexOf("\n");
  const first = (nl === -1 ? text : text.slice(0, nl)).trim();
  if (!first.startsWith("{")) return false;
  try {
    JSON.parse(first);
    return true;
  } catch {
    return false;
  }
}

// The single entry point for turning stored transcript text into a Session.
// The backend serves Claude-shaped jsonl for every format (Codex and Cursor
// are converted server-side at ingest and served from /session). The
// terminal branch survives as a safety net for raw terminal text that
// predates upload-time conversion.
export function buildSessionFromRaw(text: string): Session {
  let jsonl = text;
  if (!startsWithJsonRecord(text) && looksLikeTerminalExport(text)) {
    jsonl = terminalExportToJsonl(text).jsonl;
  }
  return buildSession(parseJsonl(jsonl));
}
