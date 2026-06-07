import styles from "./ChapterDivider.module.css";

interface Props {
  title: string;
  caption: string;
  /** When set, the divider gets id="chapter-<uuid>" as the rail's scroll
   *  and IntersectionObserver target. */
  anchorUuid?: string;
}

export function ChapterDivider({ title, caption, anchorUuid }: Props) {
  return (
    <div
      className={styles.divider}
      id={anchorUuid ? `chapter-${anchorUuid}` : undefined}
    >
      <div className={styles.title}>{title}</div>
      {caption && <div className={styles.caption}>{caption}</div>}
    </div>
  );
}
