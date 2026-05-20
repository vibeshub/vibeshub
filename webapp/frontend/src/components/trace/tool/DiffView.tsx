import type { DiffRow } from "../diff";
import { highlightLine } from "../highlight";

interface Props {
  rows: DiffRow[];
  lang: string | null;
}

// Cap very large diffs (e.g. a freshly written 2000-line file) so the DOM
// stays light. The viewer is a summary, not a full file browser.
const MAX_ROWS = 800;

const MARK: Record<DiffRow["kind"], string> = {
  add: "+",
  del: "-",
  ctx: "",
  hunk: "",
};

export function DiffView({ rows, lang }: Props) {
  if (rows.length === 0) return null;
  const shown = rows.slice(0, MAX_ROWS);
  const hidden = rows.length - shown.length;
  return (
    <div className="diff-view">
      {shown.map((r, i) => (
        <div key={i} className={`diff-row diff-${r.kind}`}>
          <span className="diff-gutter">{r.oldNo ?? ""}</span>
          <span className="diff-gutter">{r.newNo ?? ""}</span>
          <span className="diff-mark">{MARK[r.kind]}</span>
          {r.kind === "hunk" ? (
            <span className="diff-code">{r.text}</span>
          ) : (
            <span
              className="diff-code"
              dangerouslySetInnerHTML={{
                __html: highlightLine(r.text, lang),
              }}
            />
          )}
        </div>
      ))}
      {hidden > 0 && (
        <div className="diff-row diff-truncated">
          <span className="diff-gutter" />
          <span className="diff-gutter" />
          <span className="diff-mark" />
          <span className="diff-code">… {hidden} more lines</span>
        </div>
      )}
    </div>
  );
}
