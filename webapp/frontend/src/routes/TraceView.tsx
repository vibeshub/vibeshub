import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, fetchRawJsonl, fetchTrace } from "../api";
import type { TraceSummary } from "../types";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { PrivateTraceGate } from "../components/PrivateTraceGate";
import { TraceHeader } from "../components/TraceHeader";
import { TraceViewer } from "../components/trace/TraceViewer";
import { buildSession, parseJsonl } from "../components/trace/parser";
import type { Session } from "../components/trace/types";
import styles from "./TraceView.module.css";

type HeadState =
  | { kind: "loading" }
  | { kind: "ready"; trace: TraceSummary }
  | { kind: "gate"; gate: "signin" | "enable" }
  | { kind: "error"; message: string };

type BodyState =
  | { kind: "loading" }
  | { kind: "ready"; jsonl: string }
  | { kind: "error"; message: string };

export function TraceView() {
  const { shortId } = useParams<{ shortId: string }>();
  const [head, setHead] = useState<HeadState>({ kind: "loading" });
  const [body, setBody] = useState<BodyState>({ kind: "loading" });

  useEffect(() => {
    if (!shortId) return;
    setHead({ kind: "loading" });
    fetchTrace(shortId)
      .then((trace) => setHead({ kind: "ready", trace }))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          setHead({ kind: "gate", gate: "signin" });
        } else if (e instanceof ApiError && e.status === 403) {
          setHead({ kind: "gate", gate: "enable" });
        } else {
          setHead({ kind: "error", message: String(e) });
        }
      });
  }, [shortId]);

  useEffect(() => {
    if (!shortId) return;
    setBody({ kind: "loading" });
    fetchRawJsonl(shortId)
      .then((jsonl) => setBody({ kind: "ready", jsonl }))
      .catch((e) => setBody({ kind: "error", message: String(e) }));
  }, [shortId]);

  const trace = head.kind === "ready" ? head.trace : null;

  const session: Session | null = useMemo(() => {
    if (body.kind !== "ready") return null;
    const built = buildSession(parseJsonl(body.jsonl));
    if (trace?.agents) {
      built.meta.agents = trace.agents;
    }
    return built;
  }, [body, trace]);

  if (head.kind === "gate") return <PrivateTraceGate kind={head.gate} />;
  if (head.kind === "error") return <ErrorState message={head.message} />;
  if (head.kind === "loading") return <LoadingState label="Loading trace…" />;

  return (
    <div className={styles.container}>
      <TraceHeader trace={head.trace} />
      {body.kind === "loading" && <LoadingState label="Loading trace…" />}
      {body.kind === "error" && <ErrorState message={body.message} />}
      {body.kind === "ready" && session && (
        <TraceViewer
          session={session}
          shortId={head.trace.short_id}
          rawHref={`/api/traces/${head.trace.short_id}/raw`}
          repoOwner={head.trace.repo_full_name.split("/")[0]}
          repoName={head.trace.repo_full_name.split("/")[1]}
        />
      )}
    </div>
  );
}
