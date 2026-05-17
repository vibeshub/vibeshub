import { useState } from "react";
import type { Session } from "./types";
import { ViewerTopbar } from "./ViewerTopbar";
import { Hero } from "./Hero";
import { ThreadControls } from "./ThreadControls";
import { Thread } from "./Thread";

interface Props {
  session: Session;
  rawHref: string;
}

export function TraceViewer({ session, rawHref }: Props) {
  const [showReasoning, setShowReasoning] = useState(false);
  const [showSystemEvents, setShowSystemEvents] = useState(false);

  const empty = session.stream.length === 0;

  return (
    <div className="vibeshub-viewer">
      <ViewerTopbar session={session} />
      <Hero session={session} />
      {empty ? (
        <div className="empty-state">
          This trace has no parseable events.{" "}
          <a href={rawHref}>View raw JSONL ↗</a>
        </div>
      ) : (
        <>
          <ThreadControls
            showReasoning={showReasoning}
            setShowReasoning={setShowReasoning}
            showSystemEvents={showSystemEvents}
            setShowSystemEvents={setShowSystemEvents}
          />
          <Thread
            session={session}
            showReasoning={showReasoning}
            showSystemEvents={showSystemEvents}
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
