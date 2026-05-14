import styles from "./states.module.css";

export function ErrorState({ message }: { message: string }) {
  return (
    <div className={styles.error} role="alert">
      <strong>Something went wrong</strong>
      <span>{message}</span>
    </div>
  );
}
