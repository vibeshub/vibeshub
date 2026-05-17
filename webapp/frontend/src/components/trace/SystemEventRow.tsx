import type {
  AttachmentEvent,
  FileSnapshotEvent,
  StreamEvent,
  SystemEvent,
  SystemTextEvent,
} from "./types";
import { fmtDurationCompact, fmtTimeOfDay, truncate } from "./format";

interface Props {
  event: StreamEvent;
}

function describeAttachment(a: AttachmentEvent): { label: string; detail: string } {
  const p = a.payload as Record<string, unknown>;
  switch (a.subtype) {
    case "opened_file_in_ide":
      return { label: "opened in IDE", detail: String(p.filename ?? "") };
    case "hook_success":
    case "hook_additional_context":
      return { label: a.subtype, detail: String(p.hookName ?? "") };
    case "skill_listing":
      return { label: "skill listing", detail: "" };
    case "deferred_tools_delta": {
      const added = (p.addedNames as unknown[]) ?? [];
      return {
        label: "tools delta",
        detail: `+${added.length} tools`,
      };
    }
    case "command_permissions": {
      const allowed = (p.allowedTools as unknown[]) ?? [];
      return { label: "permissions", detail: `${allowed.length} allowed` };
    }
    case "task_reminder":
      return { label: "task reminder", detail: "" };
    case "date_change":
      return { label: "date change", detail: "" };
    default:
      return { label: a.subtype, detail: "" };
  }
}

export function SystemEventRow({ event }: Props) {
  if (event.kind === "attachment") {
    const a = event as AttachmentEvent;
    const { label, detail } = describeAttachment(a);
    return (
      <div className="sys-row" data-uuid={a.uuid}>
        <span className="sys-dot" />
        <span>
          <strong>{label}</strong>
          {detail ? ` · ${detail}` : ""}
        </span>
        <span className="sys-ts">{fmtTimeOfDay(a.ts)}</span>
      </div>
    );
  }
  if (event.kind === "system_event") {
    const s = event as SystemEvent;
    return (
      <div className="sys-row" data-uuid={s.uuid}>
        <span className="sys-dot" />
        <span>
          <strong>{s.subtype}</strong>
          {s.durationMs ? ` · ${fmtDurationCompact(s.durationMs)}` : ""}
          {s.messageCount ? ` · ${s.messageCount} msgs` : ""}
        </span>
        <span className="sys-ts">{fmtTimeOfDay(s.ts)}</span>
      </div>
    );
  }
  if (event.kind === "file_snapshot") {
    const f = event as FileSnapshotEvent;
    return (
      <div className="sys-row" data-uuid={f.uuid}>
        <span className="sys-dot" />
        <span>
          <strong>file snapshot</strong>
        </span>
        <span className="sys-ts">{fmtTimeOfDay(f.ts)}</span>
      </div>
    );
  }
  if (event.kind === "system_text") {
    const t = event as SystemTextEvent;
    return (
      <div className="sys-row" data-uuid={t.uuid}>
        <span className="sys-dot" />
        <span>
          <strong>system text</strong> · {truncate(t.text, 80)}
        </span>
        <span className="sys-ts">{fmtTimeOfDay(t.ts)}</span>
      </div>
    );
  }
  return null;
}
