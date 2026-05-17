import type { UserPromptEvent } from "./types";
import { fmtTimestamp } from "./format";

interface Props {
  event: UserPromptEvent;
  idx: number;
  total: number;
}

export function UserPrompt({ event, idx, total }: Props) {
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
        </div>
        <div className="user-prompt-text">{event.text}</div>
      </div>
    </div>
  );
}
