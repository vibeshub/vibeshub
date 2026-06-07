import styles from "./ChapterDivider.module.css";

interface Props {
  title: string;
  caption: string;
}

export function ChapterDivider({ title, caption }: Props) {
  return (
    <div className={styles.divider}>
      <div className={styles.title}>{title}</div>
      {caption && <div className={styles.caption}>{caption}</div>}
    </div>
  );
}
