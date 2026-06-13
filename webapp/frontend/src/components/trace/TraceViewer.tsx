import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { TraceSummary } from "../../types";
import type { Session } from "./types";
import { ViewerTopbar } from "./ViewerTopbar";
import { JumpStrip } from "./JumpStrip";
import { PromptRail } from "./PromptRail";
import { ChapterRail } from "./ChapterRail";
import { Hero } from "./Hero";
import { ThreadControls, type ViewMode } from "./ThreadControls";
import { Thread } from "./Thread";
import { ProvenanceView } from "./ProvenanceView";
import { buildProvenance } from "./provenance";
import { useSubagentStreams } from "./useSubagentStreams";
import { usePersistedBoolean } from "./persistedState";

interface Props {
  trace: TraceSummary;
  session: Session;
  shortId: string;
  rawHref: string;
  repoOwner?: string;
  repoName?: string;
  /** Optional owner-only controls rendered inside the topbar. */
  ownerControls?: ReactNode;
  /** Whether the current viewer owns this trace (enables title editing). */
  canEditTitle?: boolean;
  /** Called with the updated summary after an owner edits the title. */
  onTraceUpdated?: (trace: TraceSummary) => void;
}

export function TraceViewer({
  trace,
  session,
  shortId,
  rawHref,
  repoOwner,
  repoName,
  ownerControls,
  canEditTitle,
  onTraceUpdated,
}: Props) {
  const [showSystemEvents, setShowSystemEvents] = useState(false);
  const [expandToolCalls, setExpandToolCalls] = usePersistedBoolean(
    "vibeshub.trace.expandToolCalls",
    false,
  );

  const { entries: subagents, loading: subagentsLoading } =
    useSubagentStreams(trace);
  const provenance = useMemo(
    () => buildProvenance(session, subagents, trace.platform),
    [session, subagents, trace.platform],
  );
  const hasChanges = provenance.files.length > 0;

  // Changes (the provenance diff) is the default; #chat in the URL deep-links
  // into the conversation. Legacy #changes links land on the default anyway.
  const [mode, setModeState] = useState<ViewMode>(() =>
    typeof window !== "undefined" && window.location.hash === "#chat"
      ? "conversation"
      : "changes",
  );
  const setMode = (m: ViewMode) => {
    setModeState(m);
    if (typeof window === "undefined") return;
    const base = window.location.pathname + window.location.search;
    window.history.replaceState(
      null,
      "",
      m === "conversation" ? `${base}#chat` : base,
    );
  };

  const pendingJump = useRef<{
    jumpUuid: string | null;
    promptUuid: string | null;
  } | null>(null);
  const handleJump = (jumpUuid: string | null, promptUuid: string | null) => {
    pendingJump.current = { jumpUuid, promptUuid };
    setMode("conversation");
  };
  useEffect(() => {
    if (mode !== "conversation" || !pendingJump.current) return;
    const { jumpUuid, promptUuid } = pendingJump.current;
    pendingJump.current = null;
    // Wait one frame so the Thread is mounted before searching for anchors.
    requestAnimationFrame(() => {
      // Collapsed tool groups render no [data-uuid] for their tools; fall
      // back to the prompt card that produced the edit.
      const el =
        (jumpUuid && document.querySelector(`[data-uuid="${jumpUuid}"]`)) ||
        (promptUuid &&
          document.querySelector(`[data-uuid="${promptUuid}"]`)) ||
        null;
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [mode]);

  const empty = session.stream.length === 0;
  const inChanges = mode === "changes" && hasChanges;
  // Sessions with no edits fall back to the conversation body even while the
  // mode state says "changes"; the controls should match what's shown.
  const effectiveMode: ViewMode = inChanges ? "changes" : "conversation";

  return (
    <div className="vibeshub-viewer">
      <div className="viewer-header">
        <ViewerTopbar
          session={session}
          repoOwner={repoOwner}
          repoName={repoName}
          ownerControls={ownerControls}
        />
        <JumpStrip session={session} />
      </div>
      <Hero
        session={session}
        trace={trace}
        rawHref={rawHref}
        subagents={subagents}
        subagentsLoading={subagentsLoading}
        canEdit={canEditTitle}
        onTraceUpdated={onTraceUpdated}
      />
      {empty ? (
        <div className="empty-state">
          This trace has no parseable events.{" "}
          <a href={rawHref}>View raw JSONL ↗</a>
        </div>
      ) : inChanges ? (
        <div className="viewer-body viewer-body--prov">
          <div className="viewer-main">
            <ThreadControls
              showSystemEvents={showSystemEvents}
              setShowSystemEvents={setShowSystemEvents}
              expandToolCalls={expandToolCalls}
              setExpandToolCalls={setExpandToolCalls}
              mode={effectiveMode}
              setMode={setMode}
              hasChanges={hasChanges}
            />
            <ProvenanceView
              model={provenance}
              session={session}
              subagentsLoading={subagentsLoading}
              onJump={handleJump}
            />
          </div>
        </div>
      ) : (
        <div className="viewer-body">
          {trace.ai_digest?.chapters?.length ? (
            <ChapterRail session={session} digest={trace.ai_digest} />
          ) : (
            <PromptRail session={session} />
          )}
          <div className="viewer-main">
            <ThreadControls
              showSystemEvents={showSystemEvents}
              setShowSystemEvents={setShowSystemEvents}
              expandToolCalls={expandToolCalls}
              setExpandToolCalls={setExpandToolCalls}
              mode={effectiveMode}
              setMode={setMode}
              hasChanges={hasChanges}
            />
            <Thread
              session={session}
              shortId={shortId}
              showSystemEvents={showSystemEvents}
              expandToolCalls={expandToolCalls}
              digest={trace.ai_digest}
            />
          </div>
        </div>
      )}
      <footer className="viewer-footer">
        <span>session · {session.meta.sessionId ?? ""}</span>
        <span>vibeshub trace viewer</span>
      </footer>
    </div>
  );
}
