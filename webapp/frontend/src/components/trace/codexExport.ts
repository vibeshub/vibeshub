// Convert a raw OpenAI Codex CLI rollout (.jsonl) into the synthetic
// Claude-shaped records `buildSession` consumes. Mirrors terminalExport.ts:
// one content block per `assistant` record, a unique truthy top-level `uuid`
// on every content record.

type AnyRec = Record<string, unknown>;

const APPLY_PATCH_RE = /^\s*apply_patch\b/;

export function looksLikeCodex(text: string): boolean {
  const firstLine = text.slice(0, 16000).split("\n").find((l) => l.trim());
  if (!firstLine) return false;
  try {
    const rec = JSON.parse(firstLine) as AnyRec;
    const payload = rec.payload as AnyRec | undefined;
    return rec.type === "session_meta" && !!payload && typeof payload.id === "string";
  } catch {
    return false;
  }
}

interface PatchHunk {
  oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[];
}
interface ParsedFile { path: string; hunk: PatchHunk; }

function parseExecOutput(output: string): { body: string; exitCode: number | null } {
  const codeM = output.match(/Process exited with code (\d+)/);
  const exitCode = codeM ? Number(codeM[1]) : null;
  const idx = output.indexOf("\nOutput:\n");
  const body = idx >= 0 ? output.slice(idx + "\nOutput:\n".length) : output;
  return { body, exitCode };
}

// Parse an OpenAI `apply_patch` envelope embedded in a shell command into one
// hunk per file. Line numbers are approximate (the envelope omits them), but
// the +/-/context lines are exact, so DiffView renders correctly. Returns null
// when nothing parseable is found.
function parseApplyPatch(cmd: string): ParsedFile[] | null {
  const begin = cmd.indexOf("*** Begin Patch");
  const end = cmd.indexOf("*** End Patch");
  if (begin < 0 || end < 0 || end < begin) return null;
  const bodyLines = cmd.slice(begin, end).split("\n");
  const files: ParsedFile[] = [];
  let current: { path: string; lines: string[] } | null = null;
  const flush = () => {
    if (current && current.lines.length > 0) {
      const added = current.lines.filter((l) => l.startsWith("+")).length;
      const removed = current.lines.filter((l) => l.startsWith("-")).length;
      const ctx = current.lines.length - added - removed;
      files.push({
        path: current.path,
        hunk: { oldStart: 1, oldLines: ctx + removed, newStart: 1, newLines: ctx + added, lines: current.lines },
      });
    }
    current = null;
  };
  for (const line of bodyLines) {
    const fileM = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/);
    if (fileM) { flush(); current = { path: fileM[1].trim(), lines: [] }; continue; }
    if (line.startsWith("***") || line.startsWith("@@")) continue;
    if (current && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))) {
      current.lines.push(line);
    }
  }
  flush();
  return files.length > 0 ? files : null;
}

// Codex counts cached tokens INSIDE input_tokens; Anthropic's shape excludes
// cache_read from input_tokens. Convert so buildSession's summation matches.
function mapUsage(last: AnyRec): AnyRec {
  const input = (last.input_tokens as number) || 0;
  const cached = (last.cached_input_tokens as number) || 0;
  return {
    input_tokens: Math.max(0, input - cached),
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
    output_tokens: (last.output_tokens as number) || 0,
  };
}

function mapToolCall(
  rawName: string, args: AnyRec, callId: string, patchByCall: Map<string, PatchHunk>,
): { name: string; input: AnyRec } {
  if (rawName === "exec_command") {
    const cmd = String(args.cmd ?? "");
    if (APPLY_PATCH_RE.test(cmd)) {
      const files = parseApplyPatch(cmd);
      if (files && files.length === 1) {
        patchByCall.set(callId, files[0].hunk);
        return { name: "apply_patch", input: { file_path: files[0].path } };
      }
      // multi-file or unparseable: fall through to a shell card showing the
      // raw patch (honest fallback, spec §10).
    }
    return { name: "shell", input: { command: cmd, description: String(args.workdir ?? "") } };
  }
  if (rawName === "update_plan") {
    return { name: "update_plan", input: { plan: args.plan ?? [], explanation: args.explanation ?? "" } };
  }
  if (rawName === "spawn_agent") {
    return { name: "spawn_agent", input: {
      subagent_type: String(args.agent_type ?? "default"),
      model: String(args.model ?? "default"),
      prompt: String(args.message ?? ""),
      description: String(args.message ?? ""),
    } };
  }
  return { name: rawName, input: args };
}

export function codexToJsonl(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const records: AnyRec[] = [];
  let recN = 0;
  const uuid = () => `codex-rec-${recN++}`;
  let model: string | null = null;
  let lastAssistant: AnyRec | null = null;
  const patchByCall = new Map<string, PatchHunk>();

  const pushAssistant = (block: AnyRec, ts: string): void => {
    const rec: AnyRec = {
      type: "assistant", uuid: uuid(), timestamp: ts,
      message: { id: `codex-msg-${recN}`, model, content: [block] },
    };
    records.push(rec);
    lastAssistant = rec;
  };

  for (const raw of lines) {
    let rec: AnyRec;
    try { rec = JSON.parse(raw) as AnyRec; } catch { continue; }
    const ts = String(rec.timestamp ?? "");
    const payload = (rec.payload ?? {}) as AnyRec;

    if (rec.type === "session_meta") {
      const git = (payload.git ?? {}) as AnyRec;
      records.push({
        type: "codex-meta", source: "codex", uuid: uuid(), timestamp: ts,
        sessionId: payload.id ?? null, cwd: payload.cwd ?? null,
        gitBranch: git.branch ?? null, version: payload.cli_version ?? null,
      });
      continue;
    }
    if (rec.type === "turn_context") {
      if (typeof payload.model === "string") model = payload.model;
      continue;
    }
    if (rec.type === "event_msg") {
      const pt = payload.type;
      if (pt === "user_message" && typeof payload.message === "string" && payload.message) {
        records.push({ type: "user", uuid: uuid(), timestamp: ts, message: { content: payload.message } });
      } else if (pt === "token_count" && lastAssistant) {
        const info = (payload.info ?? {}) as AnyRec;
        const lastUse = info.last_token_usage as AnyRec | undefined;
        if (lastUse) ((lastAssistant as AnyRec).message as AnyRec).usage = mapUsage(lastUse);
      } else if (pt === "task_complete" && typeof payload.duration_ms === "number") {
        records.push({ type: "system", subtype: "turn_duration", durationMs: payload.duration_ms, uuid: uuid(), timestamp: ts });
      }
      continue;
    }
    if (rec.type === "response_item") {
      const pt = payload.type;
      if (pt === "message" && payload.role === "assistant") {
        for (const part of (payload.content as AnyRec[]) ?? []) {
          if (part && part.type === "output_text") {
            pushAssistant({ type: "text", text: String(part.text ?? "") }, ts);
          }
        }
      } else if (pt === "reasoning") {
        const parts = [...((payload.summary as AnyRec[]) ?? []), ...((payload.content as AnyRec[]) ?? [])];
        for (const s of parts) {
          if (s && typeof s.text === "string" && s.text) pushAssistant({ type: "thinking", thinking: s.text }, ts);
        }
      } else if (pt === "function_call") {
        const callId = String(payload.call_id ?? "");
        let args: AnyRec = {};
        try { args = JSON.parse(String(payload.arguments ?? "{}")) as AnyRec; } catch { args = {}; }
        const { name, input } = mapToolCall(String(payload.name ?? ""), args, callId, patchByCall);
        pushAssistant({ type: "tool_use", id: callId, name, input }, ts);
      } else if (pt === "function_call_output") {
        const callId = String(payload.call_id ?? "");
        const { body, exitCode } = parseExecOutput(String(payload.output ?? ""));
        const toolUseResult: AnyRec = { stdout: body };
        if (exitCode !== null) toolUseResult.exitCode = exitCode;
        const hunk = patchByCall.get(callId);
        if (hunk) toolUseResult.structuredPatch = [hunk];
        records.push({
          type: "user", uuid: uuid(), timestamp: ts,
          message: { content: [{ type: "tool_result", tool_use_id: callId, content: body, is_error: exitCode !== null && exitCode !== 0 }] },
          toolUseResult,
        });
      }
      continue;
    }
  }
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}
