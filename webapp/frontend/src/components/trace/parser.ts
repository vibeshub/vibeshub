import type {
  PrLinkRecord,
  ProgressEvent,
  Session,
  SessionMeta,
  SlashCommand,
  StreamEvent,
  ToolResult,
} from "./types";

type AnyRec = Record<string, unknown>;

export function parseJsonl(text: string): AnyRec[] {
  const out: AnyRec[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // swallow unparseable lines
    }
  }
  return out;
}

function getStr(obj: unknown, key: string): string | null {
  if (obj && typeof obj === "object" && key in obj) {
    const v = (obj as AnyRec)[key];
    return typeof v === "string" ? v : null;
  }
  return null;
}

// Text injected into a user message as a wrapper (e.g. <ide_opened_file>...,
// <system-reminder>..., <command-message>...) is the whole string wrapped in
// a single matching tag. Free-form user prompts virtually never match this.
function isSystemWrapperText(text: string): boolean {
  const trimmed = text.trim();
  const m = trimmed.match(
    /^<([a-zA-Z][a-zA-Z0-9_-]*)>[\s\S]*<\/([a-zA-Z][a-zA-Z0-9_-]*)>$/,
  );
  return m !== null && m[1] === m[2];
}

// A slash-command invocation is injected by Claude Code as a user message
// assembled from <command-name>, <command-message> and <command-args> tags
// (any order, sometimes indented). Returns the structured command when the
// message is *nothing but* those tags, or null for ordinary user prose.
function parseSlashCommand(text: string): SlashCommand | null {
  const nameM = text.match(/<command-name>([\s\S]*?)<\/command-name>/);
  if (!nameM) return null;
  const name = nameM[1].trim();
  if (!name) return null;
  // Reject text that merely mentions the tags amid real user prose.
  const stripped = text
    .replace(/<command-(name|message|args)>[\s\S]*?<\/command-\1>/g, "")
    .trim();
  if (stripped) return null;
  const argsM = text.match(/<command-args>([\s\S]*?)<\/command-args>/);
  return {
    name: name.startsWith("/") ? name : `/${name}`,
    args: argsM ? argsM[1].trim() : "",
  };
}

// One-line preview of a slash command, used for `meta.firstPrompt`.
function formatSlashCommand(cmd: SlashCommand): string {
  return cmd.args ? `${cmd.name} ${cmd.args}` : cmd.name;
}

// Synthetic user records injected by Claude Code itself (e.g. the Skill tool
// body, replayed verbatim back to the model with `isMeta: true` and a
// `sourceToolUseID`). They share `role: "user"` but are not user-authored.
function isMetaUserRecord(r: AnyRec): boolean {
  return r.isMeta === true;
}

export function buildSession(records: AnyRec[]): Session {
  const meta: SessionMeta = {
    sessionId: null,
    aiTitle: null,
    firstPrompt: null,
    cwd: null,
    gitBranch: null,
    model: null,
    version: null,
    permissionMode: null,
    startedAt: null,
    endedAt: null,
    prLink: null,
    tokens: { input: 0, cacheCreate: 0, cacheRead: 0, output: 0 },
    assistantThinkMs: 0,
    toolCounts: {},
    toolCallCount: 0,
    userPromptCount: 0,
    assistantTextCount: 0,
    agents: [],
  };

  const toolResultsById = new Map<string, ToolResult>();

  // Pass 1 — collect meta + index tool_results.
  for (const r of records) {
    const sessionId = getStr(r, "sessionId");
    if (sessionId && !meta.sessionId) meta.sessionId = sessionId;

    if (r.type === "ai-title") {
      const t = getStr(r, "aiTitle");
      if (t) meta.aiTitle = t;
    }
    if (r.type === "permission-mode") {
      const m = getStr(r, "permissionMode");
      if (m) meta.permissionMode = m;
    }
    if (r.type === "pr-link") {
      meta.prLink = {
        number: Number(r.prNumber) || 0,
        url: getStr(r, "prUrl") ?? "",
        repo: getStr(r, "prRepository") ?? "",
        at: getStr(r, "timestamp") ?? "",
      };
    }

    const cwd = getStr(r, "cwd");
    if (cwd && !meta.cwd) meta.cwd = cwd;
    const branch = getStr(r, "gitBranch");
    if (branch && !meta.gitBranch) meta.gitBranch = branch;
    const version = getStr(r, "version");
    if (version && !meta.version) meta.version = version;

    const msg = (r.message ?? null) as AnyRec | null;
    if (msg && !meta.model) {
      const m = getStr(msg, "model");
      if (m) meta.model = m;
    }

    const ts = getStr(r, "timestamp");
    if (ts) {
      if (!meta.startedAt || ts < meta.startedAt) meta.startedAt = ts;
      if (!meta.endedAt || ts > meta.endedAt) meta.endedAt = ts;
    }

    if (r.type === "assistant" && msg) {
      const usage = (msg.usage ?? null) as AnyRec | null;
      if (usage) {
        meta.tokens.input += (usage.input_tokens as number) || 0;
        meta.tokens.cacheCreate +=
          (usage.cache_creation_input_tokens as number) || 0;
        meta.tokens.cacheRead +=
          (usage.cache_read_input_tokens as number) || 0;
        meta.tokens.output += (usage.output_tokens as number) || 0;
      }
    }

    if (r.type === "system" && r.subtype === "turn_duration") {
      meta.assistantThinkMs += (r.durationMs as number) || 0;
    }

    if (r.type === "user" && msg && !meta.firstPrompt && !isMetaUserRecord(r)) {
      if (typeof msg.content === "string") {
        const cmd = parseSlashCommand(msg.content);
        meta.firstPrompt = cmd ? formatSlashCommand(cmd) : msg.content;
      } else if (Array.isArray(msg.content)) {
        for (const c of msg.content as AnyRec[]) {
          if (c.type !== "text" || typeof c.text !== "string" || !c.text) {
            continue;
          }
          const cmd = parseSlashCommand(c.text);
          if (cmd) {
            meta.firstPrompt = formatSlashCommand(cmd);
            break;
          }
          if (!isSystemWrapperText(c.text)) {
            meta.firstPrompt = c.text;
            break;
          }
        }
      }
    }
    if (r.type === "user" && msg && Array.isArray(msg.content)) {
      const sourceId = getStr(r, "sourceToolUseID");
      for (const c of msg.content as AnyRec[]) {
        if (c.type === "tool_result") {
          const id = String(c.tool_use_id);
          const prev = toolResultsById.get(id);
          toolResultsById.set(id, {
            content: c.content,
            isError: c.is_error as boolean | undefined,
            toolUseResult: (r.toolUseResult ?? undefined) as
              | ToolResult["toolUseResult"]
              | undefined,
            injectedText: prev?.injectedText,
          });
        } else if (
          isMetaUserRecord(r) &&
          sourceId &&
          c.type === "text" &&
          typeof c.text === "string"
        ) {
          const prev = toolResultsById.get(sourceId);
          toolResultsById.set(sourceId, {
            content: prev?.content,
            isError: prev?.isError,
            toolUseResult: prev?.toolUseResult,
            injectedText: c.text,
          });
        }
      }
    }
  }

  // Pass 2 — emit the stream in file order. Dedupe assistant content blocks:
  // each line of an assistant message carries the full content[] but adds one
  // new block at the end — emit only that last block per line, keyed by
  // ${msgId}|${blockIdx}|${blockType}.
  const stream: StreamEvent[] = [];
  const emitted = new Set<string>();

  for (const r of records) {
    if (r.type === "assistant" && r.message) {
      const msg = r.message as AnyRec;
      const msgId = String(msg.id ?? "");
      const content = (msg.content as AnyRec[]) ?? [];
      const blockIdx = content.length - 1;
      if (blockIdx < 0) continue;
      const block = content[blockIdx];
      const key = `${msgId}|${blockIdx}|${block.type}`;
      if (emitted.has(key)) continue;
      emitted.add(key);

      const ts = String(r.timestamp ?? "");
      const uuid = String(r.uuid ?? "");

      if (block.type === "thinking") {
        const text = String(block.thinking ?? "");
        if (text.length > 0) {
          stream.push({ kind: "thinking", text, ts, msgId, uuid });
        }
      } else if (block.type === "text") {
        stream.push({
          kind: "assistant_text",
          text: String(block.text ?? ""),
          ts,
          msgId,
          uuid,
        });
      } else if (block.type === "tool_use") {
        const id = String(block.id ?? "");
        stream.push({
          kind: "tool_use",
          name: String(block.name ?? ""),
          input: (block.input as Record<string, unknown>) ?? {},
          id,
          ts,
          msgId,
          uuid,
          result: toolResultsById.get(id) ?? null,
        });
      }
      continue;
    }

    if (r.type === "user" && r.message) {
      if (isMetaUserRecord(r)) continue;
      const msg = r.message as AnyRec;
      const ts = String(r.timestamp ?? "");
      const uuid = String(r.uuid ?? "");
      if (typeof msg.content === "string") {
        const cmd = parseSlashCommand(msg.content);
        stream.push(
          cmd
            ? { kind: "user_prompt", text: "", command: cmd, ts, uuid }
            : { kind: "user_prompt", text: msg.content, ts, uuid },
        );
      } else if (Array.isArray(msg.content)) {
        for (const c of msg.content as AnyRec[]) {
          if (
            c.type === "text" &&
            typeof c.text === "string" &&
            c.text.length > 0
          ) {
            const cmd = parseSlashCommand(c.text);
            if (cmd) {
              stream.push({
                kind: "user_prompt",
                text: "",
                command: cmd,
                ts,
                uuid,
              });
            } else if (isSystemWrapperText(c.text)) {
              stream.push({
                kind: "system_text",
                text: c.text,
                ts,
                uuid,
                source: "user_text",
              });
            } else {
              stream.push({ kind: "user_prompt", text: c.text, ts, uuid });
            }
          }
        }
      }
      continue;
    }

    if (r.type === "attachment" && r.attachment) {
      const a = r.attachment as AnyRec;
      stream.push({
        kind: "attachment",
        subtype: String(a.type ?? ""),
        payload: a,
        ts: String(r.timestamp ?? ""),
        uuid: String(r.uuid ?? ""),
      });
      continue;
    }

    if (r.type === "system") {
      stream.push({
        kind: "system_event",
        subtype: String(r.subtype ?? ""),
        durationMs: r.durationMs as number | undefined,
        messageCount: r.messageCount as number | undefined,
        ts: String(r.timestamp ?? ""),
        uuid: String(r.uuid ?? ""),
      });
      continue;
    }

    if (r.type === "file-history-snapshot") {
      const snap = (r.snapshot ?? {}) as AnyRec;
      stream.push({
        kind: "file_snapshot",
        payload: snap,
        ts: String(snap.timestamp ?? r.timestamp ?? ""),
        uuid: String(r.messageId ?? r.uuid ?? ""),
      });
      continue;
    }

    if (r.type === "pr-link") {
      stream.push({
        kind: "pr_link",
        payload: r as unknown as PrLinkRecord,
        ts: String(r.timestamp ?? ""),
      });
      continue;
    }

    if (r.type === "progress") {
      const data = (r.data ?? {}) as Record<string, unknown>;
      stream.push({
        kind: "progress",
        hookEvent: String(data.hookEvent ?? ""),
        hookName: String(data.hookName ?? ""),
        command: String(data.command ?? ""),
        parentToolUseID: r.parentToolUseID
          ? String(r.parentToolUseID)
          : null,
        ts: String(r.timestamp ?? ""),
        uuid: String(r.uuid ?? ""),
      });
      continue;
    }
  }

  // Aggregates from the stream.
  for (const e of stream) {
    if (e.kind === "tool_use") {
      meta.toolCounts[e.name] = (meta.toolCounts[e.name] ?? 0) + 1;
    } else if (e.kind === "user_prompt") {
      meta.userPromptCount++;
    } else if (e.kind === "assistant_text") {
      meta.assistantTextCount++;
    }
  }
  meta.toolCallCount = Object.values(meta.toolCounts).reduce(
    (a, b) => a + b,
    0,
  );

  // Newer Claude Code logs (e.g. claude-vscode) don't emit
  // `system`/`turn_duration` records; approximate per-turn duration as the
  // time from each user prompt to the last assistant action before the next.
  if (meta.assistantThinkMs === 0) {
    let turnStart: number | null = null;
    let turnEnd: number | null = null;
    const flush = () => {
      if (turnStart !== null && turnEnd !== null && turnEnd > turnStart) {
        meta.assistantThinkMs += turnEnd - turnStart;
      }
    };
    for (const e of stream) {
      if (e.kind === "user_prompt") {
        flush();
        const t = Date.parse(e.ts);
        turnStart = Number.isNaN(t) ? null : t;
        turnEnd = null;
      } else if (
        turnStart !== null &&
        (e.kind === "assistant_text" ||
          e.kind === "thinking" ||
          e.kind === "tool_use")
      ) {
        const t = Date.parse(e.ts);
        if (!Number.isNaN(t)) turnEnd = t;
      }
    }
    flush();
  }

  return { meta, stream };
}

// Group progress (hook) events under the `tool_use` they ran for, keyed by
// `parentToolUseID`. The viewer shows each tool's hooks inside that tool's
// card; progress events with no parent (or whose parent isn't in this stream)
// are left out of the map and handled as standalone rows by the caller.
export function progressByTool(
  stream: StreamEvent[],
): Map<string, ProgressEvent[]> {
  const m = new Map<string, ProgressEvent[]>();
  for (const e of stream) {
    if (e.kind === "progress" && e.parentToolUseID) {
      const arr = m.get(e.parentToolUseID);
      if (arr) arr.push(e);
      else m.set(e.parentToolUseID, [e]);
    }
  }
  return m;
}
