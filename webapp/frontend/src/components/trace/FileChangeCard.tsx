import { useState } from "react";
import type { CaptionGroup, ChangeHunk, FileChange } from "./changes";
import { changeAnchorId } from "./changes";
import { DiffView } from "./tool/DiffView";
import { langFromPath } from "./highlight";
import { shortenPath } from "./format";

interface Props {
  change: FileChange;
  root: string | null;
  onJump: (jumpUuid: string | null, promptUuid: string | null) => void;
}

function hunkStats(h: ChangeHunk): string {
  let a = 0;
  let d = 0;
  for (const r of h.rows) {
    if (r.kind === "add") a += 1;
    else if (r.kind === "del") d += 1;
  }
  const parts: string[] = [];
  if (a > 0) parts.push(`+${a}`);
  if (d > 0) parts.push(`−${d}`);
  return parts.join(" ");
}

function SupersededHunk({
  hunk,
  lang,
}: {
  hunk: ChangeHunk;
  lang: string | null;
}) {
  const [open, setOpen] = useState(false);
  const stats = hunkStats(hunk);
  return (
    <div className="superseded">
      <button
        type="button"
        className="superseded-stub"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="superseded-arrow">{open ? "▾" : "▸"}</span> 1 hunk
        {stats ? ` (${stats})` : ""} superseded by {hunk.supersededBy!.turnLabel}
      </button>
      {open && (
        <div className="superseded-body">
          <DiffView rows={hunk.rows} lang={lang} />
        </div>
      )}
    </div>
  );
}

function Caption({
  group,
  onJump,
}: {
  group: CaptionGroup;
  onJump: Props["onJump"];
}) {
  const target = group.hunks.find((h) => h.jumpUuid)?.jumpUuid ?? null;
  const canJump = target !== null || group.promptUuid !== null;
  return (
    <div className="change-caption">
      <span className="change-caption-text">
        {group.promptUuid
          ? `↳ “${group.promptExcerpt}”`
          : group.promptExcerpt}
      </span>
      {group.promptUuid && (
        <span className="change-caption-turn">{group.turnLabel}</span>
      )}
      {group.agentBadge && (
        <span className="change-caption-agent">via {group.agentBadge}</span>
      )}
      {canJump && (
        <button
          type="button"
          className="change-caption-jump"
          onClick={() => onJump(target, group.promptUuid)}
        >
          jump ↗
        </button>
      )}
    </div>
  );
}

export function FileChangeCard({ change, root, onJump }: Props) {
  const lang = langFromPath(change.path);
  return (
    <section className="change-card" id={changeAnchorId(change.path)}>
      <div className="file-card change-card-head">
        <span className="file-path">{shortenPath(change.path, root)}</span>
        {change.kind === "new" && (
          <span className="change-new-badge">new file</span>
        )}
        {(change.adds > 0 || change.dels > 0) && (
          <span className="file-stats">
            {change.adds > 0 && (
              <span className="diff-stat-add">+{change.adds}</span>
            )}
            {change.dels > 0 && (
              <span className="diff-stat-del">−{change.dels}</span>
            )}
          </span>
        )}
      </div>
      {change.groups.map((g, gi) => (
        <div key={gi} className="change-group">
          <Caption group={g} onJump={onJump} />
          {g.hunks.map((h, hi) => {
            if (h.supersededBy) {
              return <SupersededHunk key={hi} hunk={h} lang={lang} />;
            }
            if (h.rows.length === 0) {
              return (
                <div key={hi} className="change-nodata">
                  no patch data
                </div>
              );
            }
            return <DiffView key={hi} rows={h.rows} lang={lang} />;
          })}
        </div>
      ))}
    </section>
  );
}
