import type { TraceDigest } from "../../types";
import styles from "./DigestPanel.module.css";

interface Props {
  digest: TraceDigest;
}

const BULLETS: Array<{ key: keyof Omit<TraceDigest, "chapters" | "file_notes">; label: string }> = [
  { key: "ask", label: "Ask" },
  { key: "decisions", label: "Key decisions" },
  { key: "dead_ends", label: "Dead ends" },
];

// Digest agents emit "none." style filler for sections with nothing to say;
// a row spent saying nothing is noise, so drop it.
const EMPTY_VALUE = /^\s*(none|n\/a|nothing)\.?\s*$/i;

export function DigestPanel({ digest }: Props) {
  const rows = BULLETS.filter(({ key }) => {
    const v = digest[key];
    return typeof v === "string" && v.trim() !== "" && !EMPTY_VALUE.test(v);
  });
  if (rows.length === 0) return null;
  return (
    <div className={styles.wrap}>
      <section className={styles.panel}>
        <div className={styles.eyebrow}>
          <span className={styles.badge}>ai digest</span>
          <span className={styles.note}>generated on upload</span>
        </div>
        <div className={styles.bullets}>
          {rows.map(({ key, label }) => (
            <div className={styles.row} key={key}>
              <div className={styles.label}>{label}</div>
              <div className={styles.value}>{digest[key]}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
