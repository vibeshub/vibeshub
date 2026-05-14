import styles from "./states.module.css";

export function LoadingState({ label }: { label?: string }) {
  return (
    <div className={styles.center} role="status" aria-live="polite">
      {label ?? "Loading…"}
    </div>
  );
}
