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

### 4. AI-written hunk titles (backend digest pass, optional) — ✅ DONE (#131)

Shipped as per-file digest captions: the digest agent now emits `file_notes`
(one prose caption per significant changed file, grounded on an edit preview),
plumbed through the `TraceDigest` API schema and rendered as the head of each
merged file block. The `hunkTitle()` heuristic was retired entirely (hunks are
now merged per file, so there are no per-hunk titles). Reshaped from the
per-hunk idea below to per-file.

Original note (superseded):

Hunk titles are currently derived in `hunkTitle()` (provenance.ts): best
declaration-looking added line, prose files use their first line. Works, but the
design mock's hand-written titles ("buildChapterChanges — ops bucketed by digest
chapter") were better. The trace digest agent (see `docs/trace-summary-agent` /
PR #127) could emit per-hunk or per-file captions the same way it writes chapter
titles; provenance.ts would prefer those when present and keep the heuristic as
fallback.

### 5. Map verification runs to files (frontend) — ✅ DONE (2026-06-13)

Implemented in `provenance.ts` + `provenance.test.ts` (suite now 304 green,
`tsc`/`build` clean). What landed, matching the spec below:

- `VerifyRun` grew `refs: string[]`, parsed in `classifyRun` via new
  `parseRefs(cmdHead, out)` from the **heredoc-cut, un-quote-stripped** command
  (new `cutHeredoc` helper; `sanitizeCmd` now builds on it) plus the runner
  output. File tokens via a `FILE_EXT` regex; bare directory args (`backend/`,
  `src/tests`) captured separately.
- Relevance scoring: `runTier(run, opPath)` returns 3 (file or test sibling) /
  2 (directory contains it) / 1 (whole-suite test, no refs) / 0 (ran after, no
  coverage). Helpers `suffixMatch` (path-suffix, never exact — handles absolute
  op vs repo-relative output and redacted cwd), `stemKey` (test/spec sibling
  collapse for TS/JS + Python), `dirPrefixOf`.
- `verificationsAfter(pos, opPath)` now ranks the `r.pos > pos` set by tier desc
  then `pos` asc before `.slice(0, 2)`; the `none` fallback is unchanged.
- Surfacing stayed subtle (frontend-taste): **reordering only**, no new chip.
  `VerificationInfo` gained an optional `relevance?: "covers" | "ran-after"`
  for tests + a future label prefix; `ProvenanceView` does not render it yet.

Tests added to the `describe("verification runs")` block: covering sibling
ranks above an earlier build; `pytest backend/` after a frontend edit claims no
coverage (`ran-after`); directory-scoped run covers files under it; suffix match
with absolute op vs relative output; whole-suite no-refs run attaches as
`covers`. Existing temporal tests + `none` fallback unchanged.

**Still open (optional):** the manual real-trace check below (open a
`provenance.ts` hunk on `…/pull/129/plkgd4cln2`, confirm the "Verified by" panel
leads with the covering run). If the reorder reads as ambiguous there, add the
one-word `relevance` label prefix (`covers · vitest · 26 passed`) — the data is
already plumbed.

---

Original spec (kept for reference):

`verificationsAfter(pos)` (provenance.ts) is purely temporal today:
`verifyRuns.filter((r) => r.pos > pos).slice(0, 2)`. It answers "what ran next",
not "what covers this file". Two failure modes show up on real traces:

- **False reassurance.** An `Edit` to a frontend file followed by `pytest backend/`
  paints a green `✓ pytest · 41 passed` chip on the frontend hunk — a passing suite
  that never touched the edited file.
- **Lost signal.** When the agent *does* run the file's own test
  (`vitest run src/tests/trace/provenance.test.ts`) but a `npm run build` fired
  first, the build takes one of the two slots and the relevant test gets dropped.

The fix is to **rank** runs by relevance to the edited file, keeping temporal order
only as a tiebreaker/fallback (never discarding the current behavior, just
reordering before the `.slice`).

**Signal we already have but don't capture.** `classifyRun(e, pos)` builds each
`VerifyRun` from `sanitizeCmd(commandOf(e))` (the command) and `resultText(e)`
(stdout + stderr + content). Both carry file paths we throw away:

- command args: `vitest run src/tests/trace/provenance.test.ts`,
  `pytest backend/tests/test_redactor.py::test_paths`;
- runner output: vitest prints `✓ src/tests/trace/provenance.test.ts (26)`,
  pytest prints `tests/test_redactor.py ....`, etc.

Grow `VerifyRun` with `refs: string[]` — file-ish tokens parsed from cmd args +
output (match `[\w./-]+\.(ts|tsx|js|jsx|py|rb|go|rs|…)`, plus bare directory args
like `src/tests` or `backend/`). Build/lint runs usually yield none; that's fine,
they stay temporal.

**`sanitizeCmd` caveat.** It blanks quoted segments (`"…"` → `""`) so heredoc
bodies don't misclassify (`gh pr create --body "$(cat <<EOF … npm test …)"`). A
quoted path arg (`pytest "tests/test_x.py"`) would be blanked too — so parse
`refs` from the **heredoc-cut but un-quote-stripped** command (the `head` slice
before `<<`), not the fully sanitized string. `resultText` needs no sanitizing.

**Source ⇄ test mapping** — add `coversFile(run, opPath)`: true when any `run.refs`
entry is the edited file or its test sibling. Sibling rules by basename stem:

- TS/JS: `a.ts` ⇄ `a.test.ts` / `a.spec.ts` / `__tests__/a.ts` (strip `.test`/`.spec`
  before comparing stems);
- Python: `foo.py` ⇄ `test_foo.py` / `foo_test.py` / `tests/…/test_foo.py`;
- generic fallback: same basename stem, or a `run.ref` that is a **directory prefix**
  of `opPath` (a `vitest run src/tests` covers everything under it; `pytest backend/`
  covers the backend tree).

**Matching is path-suffix, never exact.** Per #2, `meta.cwd` can be
`[REDACTED:high_entropy_token]` and `EditOp.path` is usually absolute
(`/Users/…/provenance.ts`) while runner output prints repo-relative paths
(`src/components/trace/provenance.ts`). Compare on the longest shared path suffix /
basename — same instinct as `effectiveRoot()` in ProvenanceView. Full-string
equality will silently match nothing.

**Ranking** — replace `.slice(0, 2)` with a scored sort over the
`r.pos > pos` set:

1. directly covers the edited file or its test sibling,
2. covers the op's directory (prefix match),
3. broad run with **no** refs (whole-suite `npm test` / `pytest` legitimately
   covers everything, so it must not lose to nothing — this is the `298 passed`
   case `stats.tests` already surfaces),
4. otherwise temporal order (today's behavior).

Take the top ≤2 after sorting; within equal scores keep ascending `pos`
(nearest-after first). Keep the `status:"none"` fallback when the set is empty.

**Surfacing it stays subtle** (see frontend-taste memory). Default to *just
reordering* so the covering run leads the "Verified by" panel — no new chip. If
the distinction reads as ambiguous on the real trace, the cheapest tell is an
optional `relevance?: "covers" | "ran-after"` on `VerificationInfo` and a one-word
label prefix (`covers · vitest · 26 passed`), not a separate badge.

**Edge cases (cover in code + tests):**

- subagent op with `streamPos === -1` → unchanged (returns the `none` chip);
- frontend `Edit` then only `pytest backend/` → must **not** rank as covering;
  should fall to a low rank, not present a misleading ✓ as the file's primary chip;
- file's own `vitest run …/provenance.test.ts` beats an earlier `npm run build`
  for the top slot;
- whole-suite `npm test` (no refs) still attaches at rank 3;
- absolute op path vs repo-relative output ref → matches on suffix.

**Tests** — extend the existing `describe("verification runs")` block in
`provenance.test.ts` (the `bash` / `okRun` / `failRun` helpers already exist):
covering sibling ranks above an unrelated/earlier build; `pytest backend/` after a
frontend edit claims no coverage; suffix match when the op path is absolute and the
output path is relative; whole-suite run with no refs still attaches; `none`
fallback unchanged.

**Verify** (per "How to verify any of these" below): `npm test`, `npm run build`,
then open a `provenance.ts` hunk on
`http://localhost:5173/vibeshub/vibeshub/pull/129/plkgd4cln2` and confirm the
"Verified by" panel leads with the run that actually exercised the file and never
fronts an unrelated green run as its verification.

### 6. Prompt author identity (backend + frontend, small)

The design shows the prompter's GitHub handle on prompt cards. Traces don't record
identity per prompt; the trace owner (`trace.owner_login`) is the best proxy. If
wanted: pass owner into `ProvenanceView` and render a small avatar/login on prompt
cards. Skipped originally to keep clutter low (see frontend-taste memory: subtle).

### 7. Misc smaller ideas

- **True net per-file diff** (new, post-#131): #131 renders each file as one
  merged block by concatenating its surviving edit regions in file-position
  order (`orderRegions`/`regionPos`), but it does not compute a *net* diff —
  an add in edit 1 later deleted in edit 3 still shows both rows, and per-line
  `heat` is still line-text frequency (`buildHeatIndex`), not reconstructed
  per-line history. A true net diff would require replaying file states across
  ops. Listed as out-of-scope in #131's commit; only worth it if users ask.
- **Commit SHA in outcome**: `git commit` stdout contains the short SHA; parse and
  link it (`https://github.com/{repo}/commit/{sha}`) in the outcome row.
- **Per-line heat fidelity**: heat is line-text frequency across a file's ops
  (`buildHeatIndex`, lines ≥ 6 chars, capped at 4). True per-line history would
  require replaying file states across ops; only worth it if users ask.
- **rm detection looseness**: `deletedAfter()` matches `rm` + basename because shell
  commands use relative paths the trace can't resolve. A same-named file in another
  directory being deleted would false-positive as ephemeral. Tighten only if it
  misfires in practice.
- **Keyboard/a11y pass**: partly done in #131 — blame rows are now
  keyboard-accessible (focusable + selectable). Remaining: broader a11y sweep
  (roles, aria labels on the provenance panel).

## How to verify any of these

```
cd webapp/frontend
npm test                 # 304 tests, includes provenance.test.ts
npm run build
npm run dev              # proxy hits prod API; open
#   http://localhost:5173/vibeshub/vibeshub/pull/129/plkgd4cln2
```

Useful real-trace checks: stat row shows "298 ✓ tests at end"; `changes.ts` first
hunk has the `retried` badge (the famous "File has not been read yet" Write retry);
`e2e/tmp-changes-visual.spec.ts` shows "ephemeral · deleted before commit".
