import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchPrTraces } from "../api";
import type { TraceSummary } from "../types";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import styles from "./PrTracesList.module.css";

export function PrTracesList() {
  const params = useParams<{ owner: string; repo: string; number: string }>();
  const [traces, setTraces] = useState<TraceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params.owner || !params.repo || !params.number) return;
    setError(null);
    setTraces(null);
    fetchPrTraces(params.owner, params.repo, Number(params.number))
      .then((resp) => setTraces(resp.traces))
      .catch((e) => setError(String(e)));
  }, [params.owner, params.repo, params.number]);

  if (error) return <ErrorState message={error} />;
  if (traces === null) return <LoadingState label="Loading traces…" />;

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>
        {params.owner}/{params.repo} #{params.number}
      </h1>
      <p className={styles.subtitle}>
        Claude Code traces uploaded for this pull request
      </p>

      {traces.length === 0 ? (
        <div className={styles.empty}>No traces yet.</div>
      ) : (
        <div className={styles.list}>
          {traces.map((t) => (
            <Link
              key={t.short_id}
              to={`/${t.owner_login}/${params.repo}/pull/${t.pr_number}/${t.short_id}`}
              className={styles.item}
              aria-label={`Open trace ${t.short_id}`}
            >
              <span className={styles.itemTitle}>
                {t.pr_title ?? `PR #${t.pr_number}`}
              </span>
              <span className={styles.itemMeta}>
                {t.platform} · {t.message_count} messages ·{" "}
                {Math.max(1, Math.round(t.byte_size / 1024))} KB · uploaded by @
                {t.owner_login} ·{" "}
                {new Date(t.created_at).toLocaleDateString()}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
