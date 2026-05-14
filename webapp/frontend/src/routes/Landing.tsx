import styles from "./Landing.module.css";

export function Landing() {
  return (
    <div className={styles.container}>
      <h1 className={styles.h1}>vibeshub</h1>
      <p className={styles.lede}>
        Public viewer for AI coding traces, attached to the pull requests they
        produced.
      </p>

      <section className={styles.section}>
        <h2>How it works</h2>
        <p>
          Install the Claude Code plugin in your dev environment. When you run{" "}
          <code>gh pr create</code> from inside a Claude Code session, the
          plugin uploads that session's transcript to vibeshub and posts a
          comment on the new PR linking to the public trace.
        </p>
      </section>

      <section className={styles.section}>
        <h2>Install</h2>
        <code className={styles.code}>
          claude plugin install ~/code/vibeshub/plugins/claude-code
        </code>
      </section>

      <section className={styles.section}>
        <h2>Privacy</h2>
        <p>
          Traces are public by default. The plugin runs two redaction passes
          (client- and server-side) for known secret patterns before storing
          anything, and shows you a preview before each upload.
        </p>
      </section>
    </div>
  );
}
