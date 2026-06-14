export type ViewMode = "conversation" | "changes";

interface Props {
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
  hasChanges: boolean;
  promptCount: number;
  fileCount: number;
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

/**
 * The trace viewer's switcher: a single sticky, full-frame underlined tab bar
 * (GitHub-PR style) rendered once between the Hero and the body. The tabs carry
 * live counts; the conversation-only toggles sit at the right edge of the bar.
 */
export function ViewTabs({
  mode,
  setMode,
  hasChanges,
  promptCount,
  fileCount,
  showSystemEvents,
  setShowSystemEvents,
  expandToolCalls,
  setExpandToolCalls,
}: Props) {
  return (
    <div className="view-tabs">
      <div className="view-tabs-inner">
        {hasChanges && (
          <div className="view-tabs-list" role="tablist" aria-label="View mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "conversation"}
              className={"view-tab" + (mode === "conversation" ? " on" : "")}
              onClick={() => setMode("conversation")}
            >
              Conversation <span className="cnt">{promptCount} prompts</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "changes"}
              className={"view-tab" + (mode === "changes" ? " on" : "")}
              onClick={() => setMode("changes")}
            >
              Changes <span className="cnt">{fileCount} files</span>
            </button>
          </div>
        )}
        <span className="view-tabs-spacer" />
        {mode === "conversation" && (
          <div className="view-tabs-toggles">
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
        )}
      </div>
    </div>
  );
}
