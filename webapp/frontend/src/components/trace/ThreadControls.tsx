interface Props {
  showSystemEvents: boolean;
  setShowSystemEvents: (v: boolean) => void;
  expandToolCalls: boolean;
  setExpandToolCalls: (v: boolean) => void;
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
}: Props) {
  return (
    <div className="thread-controls">
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
    </div>
  );
}
