import { Link } from "react-router-dom";
import type { TraceSummary } from "../types";
import styles from "./TraceHeader.module.css";

interface Props {
  trace: TraceSummary;
}

export function TraceHeader({ trace }: Props) {
  const dateStr = new Date(trace.created_at).toLocaleString();
  const sizeKb = Math.max(1, Math.round(trace.byte_size / 1024));
  const title =
    trace.pr_title ??
    (trace.pr_number != null
      ? `PR #${trace.pr_number}`
      : `Trace ${trace.short_id}`);

  return (
    <header className={styles.header}>
      <div className={styles.row}>
        <h1 className={styles.title}>
          {title}
          {trace.is_private && (
            <span className={styles.privateBadge}>
              <span aria-hidden="true">🔒</span> Private
            </span>
          )}
        </h1>
        <div className={styles.actions}>
          {trace.pr_url && (
            <>
              <a href={trace.pr_url} target="_blank" rel="noreferrer">
                View on GitHub ↗
              </a>
              <span className={styles.dot}>·</span>
            </>
          )}
          <a href={`/api/traces/${trace.short_id}/raw`}>Raw JSONL</a>
        </div>
      </div>
      <div className={styles.metaRow}>
        {trace.repo_full_name && (
          <>
            {(() => {
              const [repoOwner, repoName] =
                trace.repo_full_name.split("/");
              return (
                <span>
                  <Link to={`/${repoOwner}`} className={styles.crumb}>
                    {repoOwner}
                  </Link>
                  <span className={styles.crumbSep}>/</span>
                  <Link
                    to={`/${repoOwner}/${repoName}`}
                    className={styles.crumb}
                  >
                    {repoName}
                  </Link>
                  {trace.pr_number != null && <> #{trace.pr_number}</>}
                </span>
              );
            })()}
            <span className={styles.dot}>·</span>
          </>
        )}
        <span>{trace.platform}</span>
        <span className={styles.dot}>·</span>
        <span>{trace.message_count} messages</span>
        <span className={styles.dot}>·</span>
        <span>{sizeKb} KB</span>
        <span className={styles.dot}>·</span>
        <span>{dateStr}</span>
        <span className={styles.dot}>·</span>
        <span>
          uploaded by{" "}
          <Link to={`/${trace.owner_login}`} className={styles.crumb}>
            @{trace.owner_login}
          </Link>
        </span>
      </div>
    </header>
  );
}
