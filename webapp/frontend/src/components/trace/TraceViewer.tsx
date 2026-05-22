import { useEffect, useRef, useState } from "react";
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
  const [stuck, setStuck] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const empty = session.stream.length === 0;

  return (
    <div className="vibeshub-viewer">
      <div
        ref={sentinelRef}
        aria-hidden="true"
        style={{ height: 1, marginBottom: -1 }}
      />
      <div className={"viewer-header" + (stuck ? " is-stuck" : "")}>
        <ViewerTopbar
          session={session}
          trace={trace}
          repoOwner={repoOwner}
          repoName={repoName}
        />
        <TraceHeader trace={trace} />
      </div>
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
          />
          <Thread
            session={session}
            shortId={shortId}
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
