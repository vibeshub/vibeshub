import type { TraceDigest } from "../../types";
import styles from "./DigestPanel.module.css";

interface Props {
  digest: TraceDigest;
}

const BULLETS: Array<{ key: keyof Omit<TraceDigest, "chapters">; label: string }> = [
  { key: "ask", label: "Ask" },
  { key: "decisions", label: "Key decisions" },
  { key: "files", label: "Files touched" },
  { key: "tests", label: "Tests added" },
  { key: "dead_ends", label: "Dead ends" },
];

export function DigestPanel({ digest }: Props) {
  const onJump = (uuid: string) => {
    const el = document.getElementById(`evt-${uuid}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div className={styles.wrap}>
      <section className={styles.panel}>
        <div className={styles.eyebrow}>Digest</div>
        <div className={styles.bullets}>
          {BULLETS.map(({ key, label }) => (
            <div className={styles.row} key={key}>
              <div className={styles.label}>{label}</div>
              <div className={styles.value}>{digest[key]}</div>
            </div>
          ))}
        </div>
        {digest.chapters.length > 0 && (
          <div className={styles.rail}>
            <div className={styles.railLabel}>Jump to</div>
            <div className={styles.chapters}>
              {digest.chapters.map((c) => (
                <button
                  key={c.anchor_uuid}
                  className={styles.chapter}
                  onClick={() => onJump(c.anchor_uuid)}
                >
                  {c.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
