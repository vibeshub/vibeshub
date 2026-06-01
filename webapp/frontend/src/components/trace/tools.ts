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
  shell: { cat: "bash", label: "Shell" },
  apply_patch: { cat: "write", label: "Apply patch" },
  update_plan: { cat: "task", label: "Plan" },
  spawn_agent: { cat: "agent", label: "Subagent" },
  wait_agent: { cat: "agent", label: "Wait for agent" },
  web_search: { cat: "read", label: "Web search" },
};

export function toolCat(name: string): ToolCategory {
  return TOOL_META[name]?.cat ?? "other";
}

export function toolLabel(name: string): string {
  return TOOL_META[name]?.label ?? name;
}

/**
 * "3 Bash · 2 Read · 1 Edit" — counts tool calls by friendly label,
 * ordered by first appearance. Empty string for an empty list.
 */
export function formatBreakdown(names: string[]): string {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const name of names) {
    const label = toolLabel(name);
    if (!counts.has(label)) order.push(label);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return order.map((label) => `${counts.get(label)} ${label}`).join(" · ");
}

export { TOOL_META };
