import { buildSession, parseJsonl } from "./parser";
import { looksLikeTerminalExport, terminalExportToJsonl } from "./terminalExport";
import type { Session } from "./types";

// The single entry point for turning stored transcript text into a Session.
// The backend serves Claude-shaped jsonl for every format (Codex and Cursor
// are converted server-side at ingest and served from /session). The
// terminal branch survives as a safety net for raw terminal text that
// predates upload-time conversion.
export function buildSessionFromRaw(text: string): Session {
  let jsonl = text;
  if (looksLikeTerminalExport(text)) {
    jsonl = terminalExportToJsonl(text).jsonl;
  }
  return buildSession(parseJsonl(jsonl));
}
