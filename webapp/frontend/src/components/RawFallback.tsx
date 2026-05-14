import styles from "./RawFallback.module.css";

interface Props {
  jsonl: string;
}

export function RawFallback({ jsonl }: Props) {
  const lines = jsonl.split(/\n/);
  return (
    <>
      <div className={styles.note}>
        Could not render this trace with claude-code-log. Showing raw JSONL.
      </div>
      <pre className={styles.pre}>
        {lines.map((line, i) => (
          <div key={i} className={styles.line}>
            <span className={styles.lineNumber}>{i + 1}</span>
            <span>{line}</span>
          </div>
        ))}
      </pre>
    </>
  );
}
