import { useState } from "react";
import type { Session } from "./types";
import type { ChapterChange, FileChange } from "./changes";
import { changeAnchorId, changesChapterAnchorId } from "./changes";
import { FileChangeCard } from "./FileChangeCard";
import { shortenPath } from "./format";

interface Props {
  session: Session;
  changes: FileChange[];
  /** Chapter-grouped cut of the same diff; null/empty falls back to flat. */
  chapters: ChapterChange[] | null;
  onJump: (jumpUuid: string | null, promptUuid: string | null) => void;
}

// One quiet line of net stats with the per-file index folded behind a toggle;
// the old always-open strip read as a wall of paths on large sessions.
function ChangesSummary({
  changes,
  root,
}: {
  changes: FileChange[];
  root: string | null;
}) {
  const [open, setOpen] = useState(false);
  const adds = changes.reduce((n, c) => n + c.adds, 0);
  const dels = changes.reduce((n, c) => n + c.dels, 0);
  const total = adds + dels;
  return (
    <header className="changes-summary">
      <div className="changes-summary-line">
        <span className="changes-summary-count">
          {changes.length} {changes.length === 1 ? "file" : "files"} changed
        </span>
        {adds > 0 && <span className="diff-stat-add">+{adds}</span>}
        {dels > 0 && <span className="diff-stat-del">−{dels}</span>}
        {total > 0 && (
          <span className="changes-ratio" aria-hidden="true">
            <span
              className="changes-ratio-add"
              style={{ width: `${(adds / total) * 100}%` }}
            />
          </span>
        )}
        <button
          type="button"
          className="changes-summary-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "hide files" : "show files"}
        </button>
      </div>
      {open && (
        <nav className="changes-index" aria-label="Changed files">
          {changes.map((c) => (
            <button
              key={c.path}
              type="button"
              className="changes-index-item"
              onClick={() =>
                document
                  .getElementById(changeAnchorId(c.path))
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              <span className="changes-index-path">
                {shortenPath(c.path, root)}
              </span>
              {c.kind === "new" && (
                <span className="changes-index-new">new</span>
              )}
              {c.adds > 0 && <span className="diff-stat-add">+{c.adds}</span>}
              {c.dels > 0 && <span className="diff-stat-del">−{c.dels}</span>}
            </button>
          ))}
        </nav>
      )}
    </header>
  );
}

export function ChangesView({ session, changes, chapters, onJump }: Props) {
  const root = session.meta.cwd;
  const withFiles = chapters?.filter((c) => c.files.length > 0) ?? [];

  // The file index jumps to a path's first card; in chapter mode later
  // occurrences of the same path must not repeat the anchor id.
  const seen = new Set<string>();
  const anchorFor = (path: string): string | undefined => {
    if (seen.has(path)) return undefined;
    seen.add(path);
    return changeAnchorId(path);
  };

  return (
    <div className="changes-view">
      <ChangesSummary changes={changes} root={root} />
      {withFiles.length > 0
        ? withFiles.map((c) => (
            <section
              key={c.anchorUuid}
              className="changes-chapter"
              id={changesChapterAnchorId(c.anchorUuid)}
            >
              <div className="changes-chapter-head">
                <span className="changes-chapter-n">{c.ordinal}</span>
                <h3 className="changes-chapter-title">{c.title}</h3>
                <span className="changes-chapter-stats">
                  {c.adds > 0 && (
                    <span className="diff-stat-add">+{c.adds}</span>
                  )}
                  {c.dels > 0 && (
                    <span className="diff-stat-del">−{c.dels}</span>
                  )}
                </span>
                <button
                  type="button"
                  className="changes-chapter-jump"
                  title="Read this chapter in the conversation"
                  onClick={() => onJump(c.anchorUuid, c.anchorUuid)}
                >
                  read ↗
                </button>
              </div>
              {c.caption && (
                <p className="changes-chapter-caption">{c.caption}</p>
              )}
              {c.files.map((f) => (
                <FileChangeCard
                  key={f.path}
                  change={f}
                  root={root}
                  onJump={onJump}
                  anchorId={anchorFor(f.path)}
                />
              ))}
            </section>
          ))
        : changes.map((c) => (
            <FileChangeCard
              key={c.path}
              change={c}
              root={root}
              onJump={onJump}
              anchorId={changeAnchorId(c.path)}
            />
          ))}
    </div>
  );
}
