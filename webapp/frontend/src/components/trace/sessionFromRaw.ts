import { buildSession, parseJsonl } from "./parser";
import { looksLikeCodex, codexToJsonl } from "./codexExport";
import { looksLikeTerminalExport, terminalExportToJsonl } from "./terminalExport";
import type { Session } from "./types";

// The single entry point for turning a raw stored transcript into a Session.
// Stored Codex rollouts are raw (converted here at render time); stored Claude
// and already-converted terminal traces pass through unchanged.
export function buildSessionFromRaw(text: string): Session {
  let jsonl = text;
  if (looksLikeCodex(text)) {
    jsonl = codexToJsonl(text);
  } else if (looksLikeTerminalExport(text)) {
    jsonl = terminalExportToJsonl(text).jsonl;
  }
  return buildSession(parseJsonl(jsonl));
}
