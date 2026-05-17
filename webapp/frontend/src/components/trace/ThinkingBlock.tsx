import type { ThinkingEvent } from "./types";

interface Props {
  event: ThinkingEvent;
}

export function ThinkingBlock({ event }: Props) {
  const txt = (event.text ?? "").trim();
  if (!txt) {
    return <div className="thinking-empty">··· thinking ···</div>;
  }
  return (
    <div className="thinking-block" data-uuid={event.uuid}>
      {txt}
    </div>
  );
}
