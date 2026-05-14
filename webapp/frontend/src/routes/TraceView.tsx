import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  fetchRawJsonl,
  fetchRenderedHtml,
  fetchTrace,
  RenderFailedError,
} from "../api";
import type { TraceSummary } from "../types";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { RawFallback } from "../components/RawFallback";
import { TraceFrame } from "../components/TraceFrame";
import { TraceHeader } from "../components/TraceHeader";
import styles from "./TraceView.module.css";

type RenderedState =
  | { kind: "loading" }
  | { kind: "html"; html: string }
  | { kind: "raw"; jsonl: string }
  | { kind: "error"; message: string };

export function TraceView() {
  const { shortId } = useParams<{ shortId: string }>();
  const [trace, setTrace] = useState<TraceSummary | null>(null);
  const [traceErr, setTraceErr] = useState<string | null>(null);
  const [body, setBody] = useState<RenderedState>({ kind: "loading" });

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
    fetchRenderedHtml(shortId)
      .then((html) => setBody({ kind: "html", html }))
      .catch(async (e) => {
        if (e instanceof RenderFailedError) {
          try {
            const jsonl = await fetchRawJsonl(shortId);
            setBody({ kind: "raw", jsonl });
          } catch (rawErr) {
            setBody({ kind: "error", message: String(rawErr) });
          }
        } else {
          setBody({ kind: "error", message: String(e) });
        }
      });
  }, [shortId]);

  if (traceErr) return <ErrorState message={traceErr} />;
  if (!trace) return <LoadingState label="Loading trace…" />;

  return (
    <div className={styles.container}>
      <TraceHeader trace={trace} />
      {body.kind === "loading" && <LoadingState label="Rendering trace…" />}
      {body.kind === "html" && (
        <TraceFrame html={body.html} title={`Trace ${trace.short_id}`} />
      )}
      {body.kind === "raw" && <RawFallback jsonl={body.jsonl} />}
      {body.kind === "error" && <ErrorState message={body.message} />}
    </div>
  );
}
