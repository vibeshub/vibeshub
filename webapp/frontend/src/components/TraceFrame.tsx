import styles from "./TraceFrame.module.css";

interface Props {
  html: string;
  title: string;
}

export function TraceFrame({ html, title }: Props) {
  return (
    <div className={styles.wrapper}>
      <iframe
        className={styles.iframe}
        sandbox="allow-same-origin"
        srcDoc={html}
        title={title}
      />
    </div>
  );
}
