interface Props {
  showReasoning: boolean;
  setShowReasoning: (v: boolean) => void;
  showSystemEvents: boolean;
  setShowSystemEvents: (v: boolean) => void;
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
  showReasoning,
  setShowReasoning,
  showSystemEvents,
  setShowSystemEvents,
}: Props) {
  return (
    <div className="thread-controls">
      <Toggle
        on={showReasoning}
        onClick={() => setShowReasoning(!showReasoning)}
        label="Show reasoning"
      />
      <Toggle
        on={showSystemEvents}
        onClick={() => setShowSystemEvents(!showSystemEvents)}
        label="Show system events"
      />
    </div>
  );
}
