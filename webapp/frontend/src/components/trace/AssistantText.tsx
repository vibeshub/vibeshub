import type { AssistantTextEvent } from "./types";
import { Markdown } from "./Markdown";

interface Props {
  event: AssistantTextEvent;
  avatar?: string;
  agent?: string;
}

export function AssistantText({
  event,
  avatar = "C",
  agent = "claude",
}: Props) {
  return (
    <div className="assistant-text" data-uuid={event.uuid}>
      <div className="assistant-avatar" data-agent={agent}>
        {avatar}
      </div>
      <div className="assistant-text-body">
        <Markdown text={event.text} />
      </div>
    </div>
  );
}
