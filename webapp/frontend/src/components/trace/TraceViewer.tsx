import { useState } from "react";
import type { TraceSummary } from "../../types";
import type { Session } from "./types";
import { TraceHeader } from "../TraceHeader";
import { ViewerTopbar } from "./ViewerTopbar";
import { Hero } from "./Hero";
import { ThreadControls } from "./ThreadControls";
import { Thread } from "./Thread";

interface Props {
  trace: TraceSummary;
  session: Session;
  shortId: string;
  rawHref: string;
  repoOwner?: string;
  repoName?: string;
}

export function TraceViewer({
  trace,
  session,
  shortId,
  rawHref,
  repoOwner,
  repoName,
}: Props) {
  const [showSystemEvents, setShowSystemEvents] = useState(false);
  const [compact, setCompact] = useState(false);

  const empty = session.stream.length === 0;

  return (
    <div className="vibeshub-viewer">
      <div className="viewer-header">
        <ViewerTopbar
          session={session}
          repoOwner={repoOwner}
          repoName={repoName}
        />
      </div>
      <TraceHeader trace={trace} />
      <Hero session={session} />
      {empty ? (
        <div className="empty-state">
          This trace has no parseable events.{" "}
          <a href={rawHref}>View raw JSONL ↗</a>
        </div>
      ) : (
        <>
          <ThreadControls
            showSystemEvents={showSystemEvents}
            setShowSystemEvents={setShowSystemEvents}
            compact={compact}
            setCompact={setCompact}
          />
          <Thread
            session={session}
            shortId={shortId}
            showSystemEvents={showSystemEvents}
            compact={compact}
          />
        </>
      )}
      <footer className="viewer-footer">
        <span>session · {session.meta.sessionId ?? ""}</span>
        <span>vibeshub trace viewer</span>
      </footer>
    </div>
  );
}
