interface Props {
  showSystemEvents: boolean;
  setShowSystemEvents: (v: boolean) => void;
  compact: boolean;
  setCompact: (v: boolean) => void;
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
  compact,
  setCompact,
}: Props) {
  return (
    <div className="thread-controls">
      <Toggle
        on={showSystemEvents}
        onClick={() => setShowSystemEvents(!showSystemEvents)}
        label="Show system events"
      />
      <Toggle
        on={compact}
        onClick={() => setCompact(!compact)}
        label="Compact"
      />
    </div>
  );
}
