export type ViewMode = "conversation" | "changes";

interface Props {
  showSystemEvents: boolean;
  setShowSystemEvents: (v: boolean) => void;
  expandToolCalls: boolean;
  setExpandToolCalls: (v: boolean) => void;
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
  hasChanges: boolean;
}

function Toggle({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      className={"toggle" + (on ? " on" : "")}
      onClick={onClick}
      type="button"
      aria-pressed={on}
    >
      <span className="check" />
      {label}
    </button>
  );
}

export function ThreadControls({
  showSystemEvents,
  setShowSystemEvents,
  expandToolCalls,
  setExpandToolCalls,
  mode,
  setMode,
  hasChanges,
}: Props) {
  return (
    <div className="thread-controls">
      {hasChanges && (
        <div className="view-pills" role="tablist" aria-label="View mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "conversation"}
            className={"view-pill" + (mode === "conversation" ? " on" : "")}
            onClick={() => setMode("conversation")}
          >
            Conversation
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "changes"}
            className={"view-pill" + (mode === "changes" ? " on" : "")}
            onClick={() => setMode("changes")}
          >
            Changes
          </button>
        </div>
      )}
      {mode === "conversation" && (
        <>
          <Toggle
            on={showSystemEvents}
            onClick={() => setShowSystemEvents(!showSystemEvents)}
            label="Show system events"
          />
          <Toggle
            on={expandToolCalls}
            onClick={() => setExpandToolCalls(!expandToolCalls)}
            label="Expand tool calls"
          />
        </>
      )}
    </div>
  );
}
