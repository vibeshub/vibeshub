import type { TraceSummary } from "../types";
import styles from "./TraceHeader.module.css";

interface Props {
  trace: TraceSummary;
}

export function TraceHeader({ trace }: Props) {
  const dateStr = new Date(trace.created_at).toLocaleString();
  const sizeKb = Math.max(1, Math.round(trace.byte_size / 1024));

  return (
    <header className={styles.header}>
      <div className={styles.row}>
        <h1 className={styles.title}>
          {trace.pr_title ?? `PR #${trace.pr_number}`}
        </h1>
        <div className={styles.actions}>
          <a href={trace.pr_url} target="_blank" rel="noreferrer">
            View on GitHub ↗
          </a>
          <span className={styles.dot}>·</span>
          <a href={`/api/traces/${trace.short_id}/raw`}>Raw JSONL</a>
        </div>
      </div>
      <div className={styles.metaRow}>
        <span>
          <strong>{trace.repo_full_name}</strong> #{trace.pr_number}
        </span>
        <span className={styles.dot}>·</span>
        <span>{trace.platform}</span>
        <span className={styles.dot}>·</span>
        <span>{trace.message_count} messages</span>
        <span className={styles.dot}>·</span>
        <span>{sizeKb} KB</span>
        <span className={styles.dot}>·</span>
        <span>{dateStr}</span>
        <span className={styles.dot}>·</span>
        <span>uploaded by @{trace.owner_login}</span>
      </div>
    </header>
  );
}
