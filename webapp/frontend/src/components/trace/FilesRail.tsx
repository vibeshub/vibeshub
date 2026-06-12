import type { FileChange } from "./changes";
import { changeAnchorId } from "./changes";
import { shortenPath } from "./format";

interface Props {
  changes: FileChange[];
  root: string | null;
}

// Changes-mode rail for traces without a digest: one row per file card.
// Reuses the chapterrail shell so the two rails read as one component.
export function FilesRail({ changes, root }: Props) {
  if (changes.length === 0) return null;
  return (
    <aside className="chapterrail filesrail" aria-label="Changed files navigation">
      <div className="chapterrail-head">
        <span className="chapterrail-count">{changes.length}</span>
        <span className="chapterrail-label">
          {changes.length === 1 ? "file changed" : "files changed"}
        </span>
      </div>
      <ol className="chapterrail-list">
        {changes.map((c) => (
          <li key={c.path}>
            <button
              type="button"
              className="chapterrail-item filesrail-item"
              onClick={() =>
                document
                  .getElementById(changeAnchorId(c.path))
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              <span className="filesrail-path">{shortenPath(c.path, root)}</span>
              <span className="chapterrail-meta">
                {c.kind === "new" && (
                  <span className="changes-index-new">new </span>
                )}
                {c.adds > 0 && <span className="diff-stat-add">+{c.adds}</span>}
                {c.dels > 0 && <span className="diff-stat-del">−{c.dels}</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}
