import { useState, type CSSProperties } from "react";
import type { ToolUseEvent } from "../types";
import { fmtTimeOfDay, toolSummary } from "../format";
import { toolCat, toolLabel } from "../tools";
import { Chev } from "../icons";
import { BashBody } from "./BashBody";
import { FileBody } from "./FileBody";
import { AskUserBody } from "./AskUserBody";
import { TaskBody } from "./TaskBody";
import { AgentBody } from "./AgentBody";
import { SkillBody } from "./SkillBody";
import { GenericBody } from "./GenericBody";

interface Props {
  event: ToolUseEvent;
  root: string | null;
  followingPrompt: string | null;
}

function dotStyle(cat: string): CSSProperties {
  return { ["--dot" as string]: `var(--tool-${cat})` } as CSSProperties;
}

function renderBody(event: ToolUseEvent, root: string | null, followingPrompt: string | null) {
  switch (event.name) {
    case "Bash":
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
      return <FileBody mode="write" input={event.input} root={root} />;
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
      return <AgentBody input={event.input} />;
    case "Skill":
      return <SkillBody input={event.input} />;
    default:
      return <GenericBody input={event.input} result={event.result} />;
  }
}

export function ToolCard({ event, root, followingPrompt }: Props) {
  const [open, setOpen] = useState(false);
  const cat = toolCat(event.name);
  const label = toolLabel(event.name);
  const summary = toolSummary(event.name, event.input, root);
  const isErr = !!event.result?.isError;

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
          {isErr && <span className="tool-error-dot" title="error" />}
          <span className="tool-meta-r">{fmtTimeOfDay(event.ts)}</span>
        </button>
        {open && (
          <div className="tool-body">
            {renderBody(event, root, followingPrompt)}
          </div>
        )}
      </div>
    </div>
  );
}
