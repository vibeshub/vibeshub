import type {
  PrLinkRecord,
  Session,
  SessionMeta,
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

    if (r.type === "user" && msg && typeof msg.content === "string" && !meta.firstPrompt) {
      meta.firstPrompt = msg.content;
    }
    if (r.type === "user" && msg && Array.isArray(msg.content)) {
      for (const c of msg.content as AnyRec[]) {
        if (c.type === "tool_result") {
          toolResultsById.set(String(c.tool_use_id), {
            content: c.content,
            isError: c.is_error as boolean | undefined,
            toolUseResult: (r.toolUseResult ?? undefined) as
              | ToolResult["toolUseResult"]
              | undefined,
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
      const msg = r.message as AnyRec;
      if (typeof msg.content === "string") {
        stream.push({
          kind: "user_prompt",
          text: msg.content,
          ts: String(r.timestamp ?? ""),
          uuid: String(r.uuid ?? ""),
        });
      } else if (Array.isArray(msg.content)) {
        for (const c of msg.content as AnyRec[]) {
          if (c.type === "text" && typeof c.text === "string" && c.text.length > 0) {
            stream.push({
              kind: "system_text",
              text: c.text,
              ts: String(r.timestamp ?? ""),
              uuid: String(r.uuid ?? ""),
              source: "user_text",
            });
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

  return { meta, stream };
}
