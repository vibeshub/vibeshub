import { useState, type CSSProperties } from "react";
import type { AgentSummary, ProgressEvent, ToolUseEvent } from "../types";
import { fmtTimeOfDay, toolSummary } from "../format";
import { toolCat, toolLabel } from "../tools";
import { Chev } from "../icons";
import { BashBody } from "./BashBody";
import { FileBody } from "./FileBody";
import { AskUserBody } from "./AskUserBody";
import { TaskBody } from "./TaskBody";
import { AgentBody } from "./AgentBody";
import { PlanBody } from "./PlanBody";
import { SkillBody } from "./SkillBody";
import { GenericBody } from "./GenericBody";
import { FILE_EDIT_TOOLS } from "../changes";
import { buildWriteRows, extractPatch } from "../diff";

interface Props {
  event: ToolUseEvent;
  root: string | null;
  followingPrompt: string | null;
  shortId: string;
  agents: AgentSummary[];
  progress: ProgressEvent[];
}

function dotStyle(cat: string): CSSProperties {
  return { ["--dot" as string]: `var(--tool-${cat})` } as CSSProperties;
}

// Hooks that fired during this tool call (PreToolUse / PostToolUse / ...).
function HookList({ progress }: { progress: ProgressEvent[] }) {
  return (
    <>
      <h4>Hooks</h4>
      <div className="hook-list">
        {progress.map((p, i) => (
          <div className="hook-row" key={i}>
            <span className="hook-dot" />
            <span className="hook-name">
              {p.hookName || p.hookEvent || "hook"}
            </span>
            {p.command && <span className="hook-cmd">{p.command}</span>}
          </div>
        ))}
      </div>
    </>
  );
}

function renderBody(
  event: ToolUseEvent,
  root: string | null,
  followingPrompt: string | null,
  shortId: string,
  agents: AgentSummary[],
) {
  switch (event.name) {
    case "Bash":
    case "shell":
      return <BashBody input={event.input} result={event.result} />;
    case "Read":
    case "Glob":
    case "Grep":
      return (
        <FileBody
          mode="read"
          input={event.input}
          result={event.result}
          root={root}
        />
      );
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "apply_patch":
      return (
        <FileBody
          mode="write"
          input={event.input}
          result={event.result}
          root={root}
        />
      );
    case "update_plan":
      return <PlanBody input={event.input} />;
    case "AskUserQuestion":
      return (
        <AskUserBody
          input={event.input}
          result={event.result}
          followingPrompt={followingPrompt}
        />
      );
    case "TaskCreate":
      return <TaskBody mode="create" input={event.input} />;
    case "TaskUpdate":
      return <TaskBody mode="update" input={event.input} />;
    case "Agent":
    case "spawn_agent":
      return (
        <AgentBody
          input={event.input}
          toolUseId={event.id}
          shortId={shortId}
          agents={agents}
        />
      );
    case "Skill":
      return <SkillBody input={event.input} result={event.result} />;
    default:
      return <GenericBody input={event.input} result={event.result} />;
  }
}

// +N/−N for file-edit tools, computed from the same rows the diff body
// renders (structuredPatch when captured, else the input strings).
function editStats(
  event: ToolUseEvent,
): { adds: number; dels: number } | null {
  if (!FILE_EDIT_TOOLS.has(event.name)) return null;
  if (typeof event.input.file_path !== "string") return null;
  // A failed call changed nothing, so there is no diff to advertise.
  if (event.result?.isError) return null;
  const rows = buildWriteRows(
    event.input,
    extractPatch(event.result?.toolUseResult?.structuredPatch),
  );
  let adds = 0;
  let dels = 0;
  for (const r of rows) {
    if (r.kind === "add") adds += 1;
    else if (r.kind === "del") dels += 1;
  }
  return adds + dels > 0 ? { adds, dels } : null;
}

export function ToolCard({
  event,
  root,
  followingPrompt,
  shortId,
  agents,
  progress,
}: Props) {
  const [open, setOpen] = useState(false);
  const cat = toolCat(event.name);
  const label = toolLabel(event.name);
  const summary = toolSummary(event.name, event.input, root);
  const isErr = !!event.result?.isError;
  const stats = editStats(event);

  return (
    <div
      className={"tool-card" + (open ? " is-open" : "")}
      data-uuid={event.uuid}
      style={dotStyle(cat)}
    >
      <div className="tool-card-inner">
        <button
          className="tool-head"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          type="button"
        >
          <Chev />
          <span className="tool-name">
            <span className="dot" />
            {label}
          </span>
          <span className="tool-summary">
            {summary || <span className="muted">—</span>}
          </span>
          {stats && (
            <span className="tool-diffstat">
              {stats.adds > 0 && (
                <span className="diff-stat-add">+{stats.adds}</span>
              )}
              {stats.dels > 0 && (
                <span className="diff-stat-del">−{stats.dels}</span>
              )}
            </span>
          )}
          {isErr && <span className="tool-error-dot" title="error" />}
          {progress.length > 0 && (
            <span className="tool-hook-badge" title="hooks ran during this tool call">
              {progress.length} hook{progress.length === 1 ? "" : "s"}
            </span>
          )}
          <span className="tool-meta-r">{fmtTimeOfDay(event.ts)}</span>
        </button>
        {open && (
          <div className="tool-body">
            {renderBody(event, root, followingPrompt, shortId, agents)}
            {progress.length > 0 && <HookList progress={progress} />}
          </div>
        )}
      </div>
    </div>
  );
}
