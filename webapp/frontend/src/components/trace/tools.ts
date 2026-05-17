import type { ToolCategory } from "./types";

interface ToolMeta {
  cat: ToolCategory;
  label: string;
}

const TOOL_META: Record<string, ToolMeta> = {
  Bash: { cat: "bash", label: "Bash" },
  Read: { cat: "read", label: "Read" },
  Write: { cat: "write", label: "Write" },
  Edit: { cat: "write", label: "Edit" },
  MultiEdit: { cat: "write", label: "MultiEdit" },
  Glob: { cat: "read", label: "Glob" },
  Grep: { cat: "read", label: "Grep" },
  Agent: { cat: "agent", label: "Subagent" },
  Skill: { cat: "skill", label: "Skill" },
  AskUserQuestion: { cat: "ask", label: "Ask user" },
  ToolSearch: { cat: "read", label: "ToolSearch" },
  TaskCreate: { cat: "task", label: "Task" },
  TaskUpdate: { cat: "task", label: "Task update" },
  TaskList: { cat: "task", label: "Task list" },
  TaskGet: { cat: "task", label: "Task get" },
  TaskOutput: { cat: "task", label: "Task output" },
  TaskStop: { cat: "task", label: "Task stop" },
  WebFetch: { cat: "read", label: "WebFetch" },
  WebSearch: { cat: "read", label: "WebSearch" },
};

export function toolCat(name: string): ToolCategory {
  return TOOL_META[name]?.cat ?? "other";
}

export function toolLabel(name: string): string {
  return TOOL_META[name]?.label ?? name;
}

export { TOOL_META };
