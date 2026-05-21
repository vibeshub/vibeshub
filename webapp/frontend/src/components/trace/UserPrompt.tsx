import type { UserPromptEvent } from "./types";
import { fmtTimestamp } from "./format";
import { IconArrowDown } from "./icons";

interface Props {
  event: UserPromptEvent;
  idx: number;
  total: number;
  nextPromptUuid?: string;
}

export function UserPrompt({ event, idx, total, nextPromptUuid }: Props) {
  function jumpToNext() {
    if (!nextPromptUuid) return;
    const el = document.querySelector(`[data-uuid="${nextPromptUuid}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  return (
    <div className="user-prompt" data-uuid={event.uuid}>
      <div className="user-prompt-avatar">U</div>
      <div className="user-prompt-body">
        <div className="user-prompt-meta">
          <span>
            Prompt {idx + 1}
            {total ? ` / ${total}` : ""}
          </span>
          <span>·</span>
          <span>{fmtTimestamp(event.ts)}</span>
          {nextPromptUuid && (
            <button
              type="button"
              className="user-prompt-jump"
              onClick={jumpToNext}
              title="Jump to next prompt"
              aria-label="Jump to next prompt"
            >
              <IconArrowDown />
            </button>
          )}
        </div>
        {event.command ? (
          <div className="slash-command" title={`${event.command.name}${event.command.args ? " " + event.command.args : ""}`}>
            <span className="slash-command-name">{event.command.name}</span>
            {event.command.args && (
              <span className="slash-command-args">{event.command.args}</span>
            )}
          </div>
        ) : (
          <div className="user-prompt-text">{event.text}</div>
        )}
      </div>
    </div>
  );
}
