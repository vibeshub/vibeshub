import type { AgentSummary } from "../../types";

export type { AgentSummary };

export type ToolCategory =
  | "bash"
  | "read"
  | "write"
  | "agent"
  | "skill"
  | "ask"
  | "task"
  | "other";

export interface TokenTotals {
  input: number;
  cacheCreate: number;
  cacheRead: number;
  output: number;
}

export interface PrLinkMeta {
  number: number;
  url: string;
  repo: string;
  at: string;
}

export interface SessionMeta {
  sessionId: string | null;
  aiTitle: string | null;
  firstPrompt: string | null;
  cwd: string | null;
  gitBranch: string | null;
  model: string | null;
  // Banner model label (e.g. "Opus 4.8") when reconstructed from a terminal
  // export; never the canonical model id. null for jsonl traces.
  modelLabel: string | null;
  // "terminal" when reconstructed from a .txt export, "codex" when converted
  // from a raw Codex rollout, "cursor" when converted from a Cursor agent
  // transcript, else null.
  sourceFormat: "terminal" | "codex" | "cursor" | null;
  version: string | null;
  permissionMode: string | null;
  startedAt: string | null;
  endedAt: string | null;
  prLink: PrLinkMeta | null;
  tokens: TokenTotals;
  assistantThinkMs: number;
  toolCounts: Record<string, number>;
  toolCallCount: number;
  userPromptCount: number;
  assistantTextCount: number;
  agents: AgentSummary[];
}

export interface ToolResult {
  content: unknown;
  isError?: boolean;
  toolUseResult?: { stdout?: string; stderr?: string } & Record<string, unknown>;
  // For Skill (and similar) tools, Claude Code replays the loaded skill body
  // back to the model as a synthetic `isMeta:true` user message keyed to the
  // tool_use. Captured here so the UI can show what the model actually saw.
  injectedText?: string;
}

// A slash-command invocation (e.g. `/share-pr`). Claude Code injects these as
// a user message assembled from <command-name>/<command-message>/<command-args>
// tags; the parser extracts the structured pieces so the viewer can render a
// command chip instead of raw XML.
export interface SlashCommand {
  name: string; // includes the leading slash, e.g. "/vibeshub:share-pr"
  args: string; // arguments passed to the command, "" when none
  // Text the command printed (<local-command-stdout>). Set when the command
  // produced output; "" / undefined when it printed nothing.
  output?: string;
}

export interface UserPromptEvent {
  kind: "user_prompt";
  text: string;
  ts: string;
  uuid: string;
  // Set when this prompt is a slash-command invocation rather than free text.
  command?: SlashCommand;
}

export interface AssistantTextEvent {
  kind: "assistant_text";
  text: string;
  ts: string;
  msgId: string;
  uuid: string;
}

export interface ThinkingEvent {
  kind: "thinking";
  text: string;
  ts: string;
  msgId: string;
  uuid: string;
}

export interface ToolUseEvent {
  kind: "tool_use";
  name: string;
  input: Record<string, unknown>;
  id: string;
  ts: string;
  msgId: string;
  uuid: string;
  result: ToolResult | null;
}

export interface SystemTextEvent {
  kind: "system_text";
  text: string;
  ts: string;
  uuid: string;
  source: "user_text";
}

export interface AttachmentEvent {
  kind: "attachment";
  subtype: string;
  payload: Record<string, unknown>;
  ts: string;
  uuid: string;
}

export interface SystemEvent {
  kind: "system_event";
  subtype: string;
  durationMs?: number;
  messageCount?: number;
  ts: string;
  uuid: string;
}

export interface FileSnapshotEvent {
  kind: "file_snapshot";
  payload: unknown;
  ts: string;
  uuid: string;
}

export interface PrLinkEvent {
  kind: "pr_link";
  payload: PrLinkRecord;
  ts: string;
}

export interface ProgressEvent {
  kind: "progress";
  hookEvent: string;
  hookName: string;
  command: string;
  parentToolUseID: string | null;
  ts: string;
  uuid: string;
}

export interface PrLinkRecord {
  prNumber: number;
  prUrl: string;
  prRepository: string;
  timestamp: string;
}

export type StreamEvent =
  | UserPromptEvent
  | AssistantTextEvent
  | ThinkingEvent
  | ToolUseEvent
  | SystemTextEvent
  | AttachmentEvent
  | SystemEvent
  | FileSnapshotEvent
  | PrLinkEvent
  | ProgressEvent;

export interface Session {
  meta: SessionMeta;
  stream: StreamEvent[];
}
