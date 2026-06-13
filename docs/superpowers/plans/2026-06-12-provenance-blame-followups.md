# Provenance Blame view: follow-ups

Status: backlog, written 2026-06-12. Context for picking these up in a fresh session.

## Background

The trace viewer's diff mode was redesigned as a **Provenance Blame** view (concept 03
from the claude.ai/design "Diff Rethink" exploration, file `Provenance Blame - Real
Trace.html` in the vibeshub design project). The view answers "where did every line
come from" instead of showing a raw diff: per-line gutters (prompt No / author band /
rewrite heat), a click-through provenance panel (instruction, research subagent, model
note, failed attempts, verification runs), ephemeral-file detection, and an outcome
timeline. It is the default mode on trace pages; the conversation stays available via
the pills and deep-links with `#chat` (legacy `#changes` links still land on the diff).

Implementation (all in `webapp/frontend`):

- `src/components/trace/provenance.ts` — pure derivation layer, session stream +
  subagent streams in, `ProvenanceModel` out. Everything is computed from the
  transcript; nothing is invented. Unit tests: `src/tests/trace/provenance.test.ts`.
- `src/components/trace/ProvenanceView.tsx` — the two-column UI (blame column +
  sticky provenance panel; bottom sheet under 1180px). CSS lives at the end of
  `src/styles/viewer.css` under the `prov-` prefix, terminal theme tokens only.
- `src/components/trace/changes.ts` — shared op-collection core (`collectOps`,
  `EditOp` with `tool`/`failed`/`errorText`/prompt `ordinal`, `markSuperseded`).
  The old chapter-grouped ChangesView / FileChangeCard / FilesRail were deleted;
  ChapterRail is conversation-only again.
- Verified against the real trace behind PR #129: `vibeshub/vibeshub` trace
  `plkgd4cln2` (dev proxy in `vite.config.ts` targets https://vibeshub.ai, so
  `http://localhost:5173/vibeshub/vibeshub/pull/129/plkgd4cln2` renders it).

## Follow-ups

### 1. Stop stripping thinking text on upload (backend / plugin)

The raw session for `plkgd4cln2` contains 45 `type:"thinking"` blocks, but the API
(`/api/traces/plkgd4cln2/session`) serves them with `thinking: ""` (signature kept,
text emptied). The provenance panel's "Model note" step therefore falls back to the
nearest `assistant_text`; the design intent was the model's actual reasoning.

- Decide whether stripping is intentional (privacy/size) or accidental in the upload
  redaction pass. If intentional, consider keeping a truncated excerpt (first ~300
  chars) so the panel has something real.
- Frontend already copes with absence: `ProvenanceView.StatRow` hides the
  "thinking blocks" cell when the count is 0; `reasoningBefore()` in provenance.ts
  prefers assistant text and falls back to thinking.

### 2. Fix cwd redaction false positive (backend redactor)

In the same trace, 73 records have `"cwd":"[REDACTED:high_entropy_token]"` — the
worktree path `/Users/bhavya/git/vibeshub/.claude/worktrees/changes-chapter-narrative`
tripped the high-entropy filter. That broke `shortenPath` everywhere meta.cwd is used.

- Fix the redactor to not flag filesystem paths (or to redact only the user segment).
- Frontend mitigation already in place: `effectiveRoot()` in ProvenanceView.tsx falls
  back to the longest common directory prefix of the changed-file paths. Keep it; it
  also covers traces whose cwd differs from where files were edited.

### 3. Expose PR merge state on TraceSummary (backend + frontend)

The outcome timeline only shows "Merged" when `gh pr merge` ran inside the session.
The design header shows a "merged 18:43" badge sourced from GitHub. Add
`pr_state` / `pr_merged_at` to `TraceSummary` (backend fetches PR state already for
linking), then:

- render the merged badge near the PR chip in `Hero.tsx` / `HeroBadges`,
- replace the heuristic merge row in `buildProvenance`'s outcome section
  (`gh pr merge|git merge` regex over shell commands) with the authoritative value.

### 4. AI-written hunk titles (backend digest pass, optional)

Hunk titles are currently derived in `hunkTitle()` (provenance.ts): best
declaration-looking added line, prose files use their first line. Works, but the
design mock's hand-written titles ("buildChapterChanges — ops bucketed by digest
chapter") were better. The trace digest agent (see `docs/trace-summary-agent` /
PR #127) could emit per-hunk or per-file captions the same way it writes chapter
titles; provenance.ts would prefer those when present and keep the heuristic as
fallback.

### 5. Map verification runs to files (frontend)

`verificationsAfter(pos)` attaches the next ≤2 test/build runs after an edit op.
That's "what ran next", not "what covers this file". Improvement: parse test-file
paths out of vitest/pytest output (`resultText()` already collects stdout) and rank
runs that mention the edited file (or its test sibling) first. Command classification
lives in `TEST_CMD`/`BUILD_CMD`/`LINT_CMD` + `classifyRun()`; note `sanitizeCmd()`
strips heredocs/quotes first because a `gh pr create --body "$(cat <<EOF ... npm
test ...)"` used to misclassify as a test run.

### 6. Prompt author identity (backend + frontend, small)

The design shows the prompter's GitHub handle on prompt cards. Traces don't record
identity per prompt; the trace owner (`trace.owner_login`) is the best proxy. If
wanted: pass owner into `ProvenanceView` and render a small avatar/login on prompt
cards. Skipped originally to keep clutter low (see frontend-taste memory: subtle).

### 7. Misc smaller ideas

- **Commit SHA in outcome**: `git commit` stdout contains the short SHA; parse and
  link it (`https://github.com/{repo}/commit/{sha}`) in the outcome row.
- **Per-line heat fidelity**: heat is line-text frequency across a file's ops
  (`buildHeatIndex`, lines ≥ 6 chars, capped at 4). True per-line history would
  require replaying file states across ops; only worth it if users ask.
- **rm detection looseness**: `deletedAfter()` matches `rm` + basename because shell
  commands use relative paths the trace can't resolve. A same-named file in another
  directory being deleted would false-positive as ephemeral. Tighten only if it
  misfires in practice.
- **Keyboard/a11y pass**: blame rows are clickable divs; hunk titles are buttons
  (so the panel is reachable by keyboard), but row-level selection isn't.

## How to verify any of these

```
cd webapp/frontend
npm test                 # 289 tests, includes provenance.test.ts
npm run build
npm run dev              # proxy hits prod API; open
#   http://localhost:5173/vibeshub/vibeshub/pull/129/plkgd4cln2
```

Useful real-trace checks: stat row shows "298 ✓ tests at end"; `changes.ts` first
hunk has the `retried` badge (the famous "File has not been read yet" Write retry);
`e2e/tmp-changes-visual.spec.ts` shows "ephemeral · deleted before commit".
