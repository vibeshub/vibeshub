import { useState } from "react";
import type { ReactNode } from "react";
import type { TraceSummary } from "../../types";
import type { Session } from "./types";
import { ViewerTopbar } from "./ViewerTopbar";
import { JumpStrip } from "./JumpStrip";
import { PromptRail } from "./PromptRail";
import { Hero } from "./Hero";
import { ThreadControls } from "./ThreadControls";
import { Thread } from "./Thread";
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

  const empty = session.stream.length === 0;

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
        canEdit={canEditTitle}
        onTraceUpdated={onTraceUpdated}
      />
      {empty ? (
        <div className="empty-state">
          This trace has no parseable events.{" "}
          <a href={rawHref}>View raw JSONL ↗</a>
        </div>
      ) : (
        <div className="viewer-body">
          <PromptRail session={session} />
          <div className="viewer-main">
            <ThreadControls
              showSystemEvents={showSystemEvents}
              setShowSystemEvents={setShowSystemEvents}
              expandToolCalls={expandToolCalls}
              setExpandToolCalls={setExpandToolCalls}
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
