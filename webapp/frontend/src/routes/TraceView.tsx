import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchRawJsonl, fetchTrace } from "../api";
import type { TraceSummary } from "../types";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { TraceHeader } from "../components/TraceHeader";
import { TraceViewer } from "../components/trace/TraceViewer";
import { buildSession, parseJsonl } from "../components/trace/parser";
import type { Session } from "../components/trace/types";
import styles from "./TraceView.module.css";

type BodyState =
  | { kind: "loading" }
  | { kind: "ready"; jsonl: string }
  | { kind: "error"; message: string };

export function TraceView() {
  const { shortId } = useParams<{ shortId: string }>();
  const [trace, setTrace] = useState<TraceSummary | null>(null);
  const [traceErr, setTraceErr] = useState<string | null>(null);
  const [body, setBody] = useState<BodyState>({ kind: "loading" });

  useEffect(() => {
    if (!shortId) return;
    setTrace(null);
    setTraceErr(null);
    fetchTrace(shortId)
      .then(setTrace)
      .catch((e) => setTraceErr(String(e)));
  }, [shortId]);

  useEffect(() => {
    if (!shortId) return;
    setBody({ kind: "loading" });
    fetchRawJsonl(shortId)
      .then((jsonl) => setBody({ kind: "ready", jsonl }))
      .catch((e) => setBody({ kind: "error", message: String(e) }));
  }, [shortId]);

  const session: Session | null = useMemo(() => {
    if (body.kind !== "ready") return null;
    return buildSession(parseJsonl(body.jsonl));
  }, [body]);

  if (traceErr) return <ErrorState message={traceErr} />;
  if (!trace) return <LoadingState label="Loading trace…" />;

  return (
    <div className={styles.container}>
      <TraceHeader trace={trace} />
      {body.kind === "loading" && <LoadingState label="Loading trace…" />}
      {body.kind === "error" && <ErrorState message={body.message} />}
      {body.kind === "ready" && session && (
        <TraceViewer
          session={session}
          rawHref={`/api/traces/${trace.short_id}/raw`}
          repoOwner={trace.repo_full_name.split("/")[0]}
          repoName={trace.repo_full_name.split("/")[1]}
        />
      )}
    </div>
  );
}
