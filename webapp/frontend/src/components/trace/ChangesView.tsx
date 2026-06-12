import type { Session } from "./types";
import type { FileChange } from "./changes";
import { changeAnchorId } from "./changes";
import { FileChangeCard } from "./FileChangeCard";
import { shortenPath } from "./format";

interface Props {
  session: Session;
  changes: FileChange[];
  onJump: (jumpUuid: string | null, promptUuid: string | null) => void;
}

export function ChangesView({ session, changes, onJump }: Props) {
  const root = session.meta.cwd;
  const totalAdds = changes.reduce((n, c) => n + c.adds, 0);
  const totalDels = changes.reduce((n, c) => n + c.dels, 0);
  return (
    <div className="changes-view">
      <div className="changes-index">
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
            {c.kind === "new" && <span className="changes-index-new">new</span>}
            {c.adds > 0 && <span className="diff-stat-add">+{c.adds}</span>}
            {c.dels > 0 && <span className="diff-stat-del">−{c.dels}</span>}
          </button>
        ))}
        <span className="changes-index-total">
          {changes.length} {changes.length === 1 ? "file" : "files"} · +
          {totalAdds} −{totalDels} net
        </span>
      </div>
      {changes.map((c) => (
        <FileChangeCard key={c.path} change={c} root={root} onJump={onJump} />
      ))}
    </div>
  );
}
