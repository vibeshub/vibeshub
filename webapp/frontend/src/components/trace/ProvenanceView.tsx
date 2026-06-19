import { useState, type ReactNode } from "react";
import type { Session } from "./types";
import type {
  BlameFile,
  BlameHunk,
  ProvenanceModel,
} from "./provenance";
import { orderRegions } from "./provenance";
import type { DiffRow } from "./diff";
import type { NetRow } from "./netdiff";
import { changeAnchorId } from "./changes";
import { fmtTimeOfDay, shortenPath } from "./format";
import { highlightLine, langFromPath } from "./highlight";
import type { TraceDigest } from "../../types";

// ProvenanceView — the "Provenance Blame" diff: the session's net changes
// annotated with where every line came from. Gutters carry prompt №, author
// band and rewrite heat; clicking a line opens its provenance chain (the
// instruction, research, failed attempts and verification) in the side panel.

interface Sel {
  file: BlameFile;
  hunk: BlameHunk | null; // null = file-level provenance
  rowIdx: number | null;
}

interface Props {
  model: ProvenanceModel;
  session: Session;
  subagentsLoading: boolean;
  digest?: TraceDigest | null;
  onJump: (jumpUuid: string | null, promptUuid: string | null) => void;
}

const FILE_FOLD_THRESHOLD = 80;
const FILE_FOLD_HEAD = 48;

function clip(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length <= n ? t : t.slice(0, n) + "…";
}

// The trace cwd is sometimes unusable for shortening (recorded in a different
// checkout, or redacted on upload); fall back to the longest common directory
// prefix of the changed files so paths stay readable.
function effectiveRoot(paths: string[], cwd: string | null): string | null {
  if (cwd && paths.some((p) => p.startsWith(cwd + "/"))) return cwd;
  if (paths.length === 0) return null;
  if (paths.length === 1) {
    const segs = paths[0].split("/");
    return segs.length > 6 ? segs.slice(0, -5).join("/") : null;
  }
  let prefix = paths[0].slice(0, paths[0].lastIndexOf("/"));
  for (const p of paths) {
    while (prefix && !p.startsWith(prefix + "/")) {
      prefix = prefix.slice(0, prefix.lastIndexOf("/"));
    }
  }
  return prefix || null;
}

function StatRow({ model }: { model: ProvenanceModel }) {
  const s = model.stats;
  const cells: Array<[string | number, string]> = [
    [s.prompts, s.prompts === 1 ? "prompt" : "prompts"],
    [s.editOps, "edit ops"],
    [s.files, s.files === 1 ? "file" : "files"],
    [s.reads, "reads"],
    [s.bash, "shell cmds"],
    // Imported and redaction-stripped traces record no thinking; a zero here
    // would read as "the model never thought", so drop the cell instead.
    ...(s.thinking > 0
      ? ([[s.thinking, "thinking blocks"]] as Array<[string | number, string]>)
      : []),
    [s.subagents, s.subagents === 1 ? "subagent" : "subagents"],
    [s.tests ?? "n/a", "tests at end"],
  ];
  return (
    <div className="prov-statrow">
      {cells.map(([v, label]) => (
        <div key={label} className="prov-stat">
          <b>{v}</b>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

// Author colors keyed to the existing tool palette: the main agent is the
// terminal green, subagents the Task purple.
function authorVar(key: "ai" | "agent" | "human"): string {
  if (key === "ai") return "var(--acc)";
  if (key === "agent") return "var(--t-agent)";
  return "var(--t-read)";
}

function Attribution({
  model,
  loading,
}: {
  model: ProvenanceModel;
  loading: boolean;
}) {
  const { slices } = model.attribution;
  const withLines = slices.filter((s) => s.lines > 0);
  return (
    <div className="prov-attrib">
      <div className="prov-bar" aria-hidden="true">
        {withLines.map((s) => (
          <i
            key={s.label}
            style={{ width: `${s.pct}%`, background: authorVar(s.key) }}
          />
        ))}
      </div>
      <div className="prov-legend">
        {slices.map((s) => (
          <span className="k" key={s.label}>
            <i style={{ background: authorVar(s.key) }} />
            {s.label}{" "}
            <b>
              {s.lines > 0
                ? `${s.pct}% of lines`
                : `0 lines${s.key === "agent" ? " (research only)" : ""}`}
            </b>
          </span>
        ))}
        {loading && <p>Loading subagent streams…</p>}
      </div>
    </div>
  );
}

function FilesIndex({
  files,
  root,
}: {
  files: BlameFile[];
  root: string | null;
}) {
  const [open, setOpen] = useState(false);
  const adds = files.reduce((n, f) => n + (f.hasNetData ? f.netAdds : f.adds), 0);
  const dels = files.reduce((n, f) => n + (f.hasNetData ? f.netDels : f.dels), 0);
  const total = adds + dels;
  return (
    <header className="prov-summary">
      <div className="prov-summary-line">
        <span className="prov-summary-count">
          {files.length} {files.length === 1 ? "file" : "files"} changed
        </span>
        {adds > 0 && <span className="diff-stat-add">+{adds}</span>}
        {dels > 0 && <span className="diff-stat-del">−{dels}</span>}
        {total > 0 && (
          <span className="prov-ratio" aria-hidden="true">
            <span
              className="prov-ratio-add"
              style={{ width: `${(adds / total) * 100}%` }}
            />
          </span>
        )}
        <button
          type="button"
          className="prov-summary-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "hide files" : "show files"}
        </button>
      </div>
      {open && (
        <nav className="prov-index" aria-label="Changed files">
          {files.map((f) => {
            const fa = f.hasNetData ? f.netAdds : f.adds;
            const fd = f.hasNetData ? f.netDels : f.dels;
            return (
              <button
                key={f.path}
                type="button"
                className="prov-index-item"
                onClick={() =>
                  document
                    .getElementById(changeAnchorId(f.path))
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              >
                <span className="prov-index-path">{shortenPath(f.path, root)}</span>
                {f.status !== "mod" && (
                  <span className={"prov-index-status " + f.status}>{f.status}</span>
                )}
                {fa > 0 && <span className="diff-stat-add">+{fa}</span>}
                {fd > 0 && <span className="diff-stat-del">−{fd}</span>}
              </button>
            );
          })}
        </nav>
      )}
    </header>
  );
}

const SIGN: Record<DiffRow["kind"], string> = {
  add: "+",
  del: "-",
  ctx: "",
  hunk: "",
};

interface FlatRow {
  row: DiffRow;
  region: BlameHunk;
  localIdx: number;
}

function FlatRowView({
  entry,
  file,
  lang,
  sel,
  onSelect,
}: {
  entry: FlatRow;
  file: BlameFile;
  lang: string | null;
  sel: Sel | null;
  onSelect: (s: Sel) => void;
}) {
  const { row, region, localIdx } = entry;
  if (row.kind === "hunk") {
    return (
      <div className="prov-ln hunkline">
        <span className="prov-pidx" />
        <span className="prov-band" />
        <span className="prov-heat" />
        <span className="prov-sign" />
        <span className="prov-src">{row.text}</span>
      </div>
    );
  }
  const changed = row.kind !== "ctx";
  const isSel =
    sel !== null && sel.hunk !== null && sel.hunk.id === region.id && sel.rowIdx === localIdx;
  const author = region.agentType ? "agent" : "ai";
  const select = () => onSelect({ file, hunk: region, rowIdx: localIdx });
  return (
    <div
      className={
        `prov-ln ${row.kind}` +
        (isSel ? " sel" : "") +
        (region.retried ? " retried" : "")
      }
      role="button"
      tabIndex={0}
      title={region.retried ? "This edit was retried" : undefined}
      onClick={select}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          select();
        }
      }}
    >
      <span className="prov-pidx">
        {changed && region.promptIdx > 0 ? region.promptIdx : ""}
      </span>
      <span
        className="prov-band"
        style={changed ? { background: authorVar(author) } : undefined}
      />
      <span className="prov-heat" aria-hidden="true">
        {[0, 1, 2].map((n) => (
          <i key={n} className={changed && region.heat[localIdx] > n + 1 ? "on" : ""} />
        ))}
      </span>
      <span className="prov-sign">{SIGN[row.kind]}</span>
      {row.kind === "add" ? (
        <span
          className="prov-src diff-code"
          dangerouslySetInnerHTML={{ __html: highlightLine(row.text || " ", lang) }}
        />
      ) : (
        <span className="prov-src">{row.text || " "}</span>
      )}
    </div>
  );
}

const NET_MARK: Record<DiffRow["kind"], string> = {
  add: "+",
  del: "-",
  ctx: "",
  hunk: "",
};

function NetRowView({
  row,
  lang,
  selectedHunkId,
  onPick,
}: {
  row: NetRow;
  lang: string | null;
  selectedHunkId: string | null;
  onPick: (hunkId: string | null) => void;
}) {
  if (row.kind === "hunk") {
    return (
      <div className="diff-row diff-hunk">
        <span className="diff-gutter" />
        <span className="diff-gutter" />
        <span className="diff-mark" />
        <span className="diff-code">{row.text}</span>
      </div>
    );
  }
  const attributed = row.kind === "add" && row.hunkId !== null;
  const isSel = attributed && selectedHunkId !== null && row.hunkId === selectedHunkId;
  const pick = () => onPick(attributed ? (row.hunkId as string) : null);
  return (
    <div
      className={
        `diff-row diff-${row.kind} net-click` + (isSel ? " net-sel" : "")
      }
      role="button"
      tabIndex={0}
      onClick={pick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          pick();
        }
      }}
    >
      <span className="diff-gutter">{row.oldNo ?? ""}</span>
      <span className="diff-gutter">{row.newNo ?? ""}</span>
      <span className="diff-mark">{NET_MARK[row.kind]}</span>
      <span
        className="diff-code"
        dangerouslySetInnerHTML={{ __html: highlightLine(row.text || " ", lang) }}
      />
    </div>
  );
}

// Shared file-card header for both the net and per-op views. The two differ
// only in which counts they show (net vs surviving) and whether a per-edit
// summary span is present, so those are props/slots rather than duplicated.
function FileHead({
  file,
  root,
  adds,
  dels,
  caption,
  summary,
}: {
  file: BlameFile;
  root: string | null;
  adds: number;
  dels: number;
  caption: string | undefined;
  summary?: ReactNode;
}) {
  return (
    <>
      <div className="prov-fhead">
        <span className="prov-fpath" title={file.path}>
          {shortenPath(file.path, root)}
        </span>
        <span className={"prov-fstatus " + file.status}>{statusLabel(file)}</span>
        <span className="prov-fstats">
          {adds > 0 && <span className="diff-stat-add">+{adds}</span>}
          {dels > 0 && <span className="diff-stat-del">−{dels}</span>}
        </span>
        {summary}
      </div>
      {caption && <p className="prov-fcaption">{caption}</p>}
    </>
  );
}

function FileBlock({
  file,
  root,
  caption,
  sel,
  onSelect,
}: {
  file: BlameFile;
  root: string | null;
  caption: string | undefined;
  sel: Sel | null;
  onSelect: (s: Sel) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const lang = langFromPath(file.path);

  if (file.hasNetData) {
    const rows = file.netRows;
    const folded =
      rows.length > FILE_FOLD_THRESHOLD && !expanded
        ? rows.slice(0, FILE_FOLD_HEAD)
        : rows;
    const hidden = rows.length - folded.length;
    const selectRow = (hunkId: string | null) => {
      const hunk = hunkId ? file.hunks.find((h) => h.id === hunkId) ?? null : null;
      onSelect({ file, hunk, rowIdx: null });
    };
    return (
      <section
        id={changeAnchorId(file.path)}
        className={"prov-file" + (file.status === "ephemeral" ? " ephemeral" : "")}
      >
        <FileHead
          file={file}
          root={root}
          adds={file.netAdds}
          dels={file.netDels}
          caption={caption}
        />
        {rows.length === 0 ? (
          <div className="prov-nodata">no net change</div>
        ) : (
          <div className="prov-code net">
            {folded.map((row, i) => (
              <NetRowView
                key={i}
                row={row}
                lang={lang}
                selectedHunkId={
                  sel && sel.file.path === file.path && sel.hunk ? sel.hunk.id : null
                }
                onPick={selectRow}
              />
            ))}
            {hidden > 0 && (
              <button
                type="button"
                className="diff-expand"
                onClick={() => setExpanded(true)}
              >
                ▸ show {hidden} more lines
              </button>
            )}
            {expanded && rows.length > FILE_FOLD_THRESHOLD && (
              <button
                type="button"
                className="diff-expand"
                onClick={() => setExpanded(false)}
              >
                ▾ collapse
              </button>
            )}
          </div>
        )}
      </section>
    );
  }

  const regions = orderRegions(file.hunks.filter((h) => !h.superseded));
  const flat: FlatRow[] = [];
  for (const region of regions) {
    region.rows.forEach((row, localIdx) => flat.push({ row, region, localIdx }));
  }
  const retriedCount = regions.filter((r) => r.retried).length;
  const folded =
    flat.length > FILE_FOLD_THRESHOLD && !expanded
      ? flat.slice(0, FILE_FOLD_HEAD)
      : flat;
  const hidden = flat.length - folded.length;
  return (
    <section
      id={changeAnchorId(file.path)}
      className={"prov-file" + (file.status === "ephemeral" ? " ephemeral" : "")}
    >
      <FileHead
        file={file}
        root={root}
        adds={file.adds}
        dels={file.dels}
        caption={caption}
        summary={
          <span className="prov-fsummary">
            · {regions.length} {regions.length === 1 ? "edit" : "edits"}
            {retriedCount > 0 ? `, ${retriedCount} retried` : ""}
          </span>
        }
      />
      {flat.length === 0 ? (
        <div className="prov-nodata">no patch data</div>
      ) : (
        <div className="prov-code">
          {folded.map((entry, i) => (
            <FlatRowView
              key={i}
              entry={entry}
              file={file}
              lang={lang}
              sel={sel}
              onSelect={onSelect}
            />
          ))}
          {hidden > 0 && (
            <button
              type="button"
              className="diff-expand"
              onClick={() => setExpanded(true)}
            >
              ▸ show {hidden} more lines
            </button>
          )}
          {expanded && flat.length > FILE_FOLD_THRESHOLD && (
            <button
              type="button"
              className="diff-expand"
              onClick={() => setExpanded(false)}
            >
              ▾ collapse
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function statusLabel(f: BlameFile): string {
  if (f.status === "new") return "new";
  if (f.status === "ephemeral") return "ephemeral · deleted before commit";
  return "modified";
}

function OutcomeRows({ model }: { model: ProvenanceModel }) {
  if (model.outcome.length === 0) return null;
  return (
    <div className="prov-outcome">
      <h2>Outcome</h2>
      {model.outcome.map((o, i) => (
        <div key={i} className="prov-orow">
          <span className="t">{fmtTimeOfDay(o.ts)}</span>
          <span>
            <b>{o.label}</b> {o.detail}
          </span>
        </div>
      ))}
    </div>
  );
}

function Panel({
  sel,
  model,
  root,
  onJump,
  onClose,
}: {
  sel: Sel | null;
  model: ProvenanceModel;
  root: string | null;
  onJump: Props["onJump"];
  onClose: () => void;
}) {
  if (!sel) {
    const s = model.stats;
    return (
      <aside className="prov-panel">
        <h2>Provenance</h2>
        <div className="prov-empty">
          Every prompt, code line, failed attempt and test run here was
          extracted from the session transcript ({s.editOps} edit ops,{" "}
          {s.bash} shell commands, {s.reads} reads).
          <br />
          <br />
          <b>Click any line</b> to walk its provenance chain: the instruction
          that caused it, the reasoning behind it, the attempts it took, and
          what verified it.
          <dl className="prov-gutter-key" aria-label="What the gutters mean">
            <div>
              <dt>
                <span className="k-num">№</span>
              </dt>
              <dd>prompt that wrote the line</dd>
            </div>
            <div>
              <dt>
                <i className="k-band" />
              </dt>
              <dd>author (color matches the legend)</dd>
            </div>
            <div>
              <dt className="k-heat">
                <i />
                <i className="on" />
                <i className="on" />
              </dt>
              <dd>rewrite heat (times the line was redone)</dd>
            </div>
          </dl>
        </div>
      </aside>
    );
  }

  if (sel.hunk === null) {
    const f = sel.file;
    const editCount = f.hunks.length;
    const retried = f.hunks.filter((h) => h.retried).length;
    const promptIdxs = [
      ...new Set(f.hunks.map((h) => h.promptIdx).filter((i) => i > 0)),
    ];
    const seen = new Set<string>();
    const verifs = f.hunks
      .flatMap((h) => h.verifications)
      .filter((v) => v.status !== "none")
      .filter((v) => (seen.has(v.label) ? false : (seen.add(v.label), true)));
    return (
      <aside className="prov-panel has-sel">
        <button type="button" className="prov-panel-close" onClick={onClose}>
          ✕
        </button>
        <h2>File · {shortenPath(f.path, root).split("/").pop()}</h2>
        <div className="prov-chain">
          <div className="prov-step">
            <h3>
              {editCount} {editCount === 1 ? "edit" : "edits"}
              {retried > 0 ? `, ${retried} retried` : ""}
            </h3>
          </div>
          <div className="prov-step prompt">
            <h3>Prompts that touched this file</h3>
            {promptIdxs.map((idx) => {
              const p = model.prompts[idx - 1];
              return p ? (
                <p className="q" key={idx}>
                  №{p.idx} “{clip(p.text, 200)}”
                  {p.uuid && (
                    <button
                      type="button"
                      className="prov-jump"
                      onClick={() => onJump(p.uuid, p.uuid)}
                    >
                      ↗
                    </button>
                  )}
                </p>
              ) : null;
            })}
          </div>
          {verifs.length > 0 && (
            <div className="prov-step verify">
              <h3>Verified by</h3>
              <div className="prov-vrow">
                {verifs.map((v, i) => (
                  <span key={i} className={"prov-vchip " + v.status}>
                    {v.status === "pass" ? "✓" : v.status === "fail" ? "✗" : "○"} {v.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>
    );
  }

  const { hunk, file, rowIdx } = sel;
  const row = rowIdx !== null ? hunk.rows[rowIdx] : null;
  const heat = rowIdx !== null ? hunk.heat[rowIdx] : 1;
  const prompt =
    hunk.promptIdx > 0 ? model.prompts[hunk.promptIdx - 1] : null;
  return (
    <aside className="prov-panel has-sel">
      <button type="button" className="prov-panel-close" onClick={onClose}>
        ✕
      </button>
      <h2>
        Provenance · {shortenPath(file.path, root).split("/").pop()} ·{" "}
        {fmtTimeOfDay(hunk.ts)}
      </h2>
      <div className="prov-chain">
        <div className="prov-step prompt">
          <h3>
            {prompt
              ? `Instruction №${prompt.idx} · ${fmtTimeOfDay(prompt.ts)}`
              : "Before the first prompt"}
          </h3>
          {prompt && (
            <p className="q">
              “{clip(prompt.text, 280)}”
              {prompt.uuid && (
                <button
                  type="button"
                  className="prov-jump"
                  onClick={() => onJump(prompt.uuid, prompt.uuid)}
                >
                  ↗
                </button>
              )}
            </p>
          )}
        </div>
        {hunk.research && (
          <div className="prov-step research">
            <h3>Research · {hunk.research.agentType} subagent</h3>
            <p>
              {hunk.research.description} · {hunk.research.reads} reads, wrote
              0 lines.
            </p>
          </div>
        )}
        {hunk.reasoning && (
          <div className="prov-step">
            <h3>Model note · {fmtTimeOfDay(hunk.reasoning.ts)}</h3>
            <p>{hunk.reasoning.text}</p>
          </div>
        )}
        {hunk.attempts.length > 0 && (
          <div className="prov-step">
            <h3>{hunk.attempts.length} attempts</h3>
            <div className="prov-attempts">
              {hunk.attempts.map((a, i) => (
                <span
                  key={i}
                  className={"prov-attempt" + (a.ok ? "" : " dead")}
                >
                  <span className={a.ok ? "ok" : "no"}>
                    {a.ok ? "✓" : "✗"}
                  </span>
                  <span>
                    {fmtTimeOfDay(a.ts)} {a.label}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
        {row && (
          <div className="prov-step">
            <h3>This line{heat > 1 ? ` · written ${heat}×` : ""}</h3>
            <div className="prov-thisline">{row.text || "(blank line)"}</div>
          </div>
        )}
        <div className="prov-step verify">
          <h3>Verified by</h3>
          <div className="prov-vrow">
            {hunk.verifications.map((v, i) => (
              <span key={i} className={"prov-vchip " + v.status}>
                {v.status === "pass" ? "✓" : v.status === "fail" ? "✗" : "○"}{" "}
                {v.label}
                {v.ts ? ` · ${fmtTimeOfDay(v.ts)}` : ""}
              </span>
            ))}
          </div>
        </div>
        {hunk.jumpUuid && (
          <div className="prov-step">
            <button
              type="button"
              className="prov-open-chat"
              onClick={() => onJump(hunk.jumpUuid, hunk.promptUuid)}
            >
              open this edit in the conversation ↗
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

export function ProvenanceView({
  model,
  session,
  subagentsLoading,
  digest,
  onJump,
}: Props) {
  const root = effectiveRoot(
    model.files.map((f) => f.path),
    session.meta.cwd,
  );
  const captions = new Map(
    (digest?.file_notes ?? []).map((n) => [n.path, n.caption] as const),
  );
  const [sel, setSel] = useState<Sel | null>(null);

  return (
    <div className="prov">
      <div className={"prov-grid" + (sel ? " has-sel" : "")}>
        <div className="prov-main">
          <StatRow model={model} />
          <Attribution model={model} loading={subagentsLoading} />
          <FilesIndex files={model.files} root={root} />
          {model.files.map((file) => (
            <FileBlock
              key={file.path}
              file={file}
              root={root}
              caption={captions.get(file.path)}
              sel={sel}
              onSelect={setSel}
            />
          ))}
          <OutcomeRows model={model} />
        </div>
        <Panel
          sel={sel}
          model={model}
          root={root}
          onJump={onJump}
          onClose={() => setSel(null)}
        />
      </div>
    </div>
  );
}
