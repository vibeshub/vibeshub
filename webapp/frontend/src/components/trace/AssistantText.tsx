import type { AssistantTextEvent } from "./types";
import { Markdown } from "./Markdown";

interface Props {
  event: AssistantTextEvent;
}

export function AssistantText({ event }: Props) {
  return (
    <div className="assistant-text" data-uuid={event.uuid}>
      <div className="assistant-avatar">C</div>
      <div className="assistant-text-body">
        <Markdown text={event.text} />
      </div>
    </div>
  );
}
