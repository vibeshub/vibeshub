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

export interface AgentSummary {
  agent_id: string;
  tool_use_id: string | null;
  agent_type: string;
  description: string;
  message_count: number;
}

export interface SessionMeta {
  sessionId: string | null;
  aiTitle: string | null;
  firstPrompt: string | null;
  cwd: string | null;
  gitBranch: string | null;
  model: string | null;
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

export interface UserPromptEvent {
  kind: "user_prompt";
  text: string;
  ts: string;
  uuid: string;
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
  | PrLinkEvent;

export interface Session {
  meta: SessionMeta;
  stream: StreamEvent[];
}
