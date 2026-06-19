# Close the Cursor integration loop — Design

**Status**: approved, pending implementation
**Date**: 2026-06-19
**Branch**: `cursor-close-loop`
**Follow-up to**: #108 / #110 (Cursor marketplace plugin generator),
`2026-06-05-cursor-marketplace-plugin-generator-design.md` (§6 deferred the
release/CI wiring and the marketplace submission)

## 1. Purpose

Cursor support was built but the distribution loop was never closed. Concretely:

- The generator `scripts/sync-cursor-plugin.py` produces a self-contained Cursor
  plugin tree from `plugins/cli` (the single source of truth), and the standalone
  repo `vibeshub/vibeshub-cursor` exists. But that repo holds exactly one commit,
  *"Generate from vibeshub@dbe43fc"* (2026-06-05), and is now **stale**: running
  `sync-cursor-plugin.py --check` against a fresh clone of the live remote exits
  non-zero. Four files drifted (`vibeshub_client/cursor_subagent_link.py`,
  `pipeline.py`, `post_comment.py`, `upload.py`) because #114 (digest agent) and
  #126 (converted traces) edited shared `vibeshub_client/` code after the
  June-5 generation, and nothing regenerated and pushed.
- **Nothing keeps it in sync.** The only workflow is `deploy.yml` (Azure deploy
  on push to `main`); there is no PR CI at all, and nothing calls `--check`. The
  repo silently goes stale whenever *any* shared client code changes.
- **The version never bumped.** `version.py` and the remote `plugin.json` are
  both `0.4.0`, so even a fresh re-push would not signal a marketplace update.
- **It was never submitted to the Cursor marketplace** (confirmed with the
  maintainer). So "close the loop" means: publish it end-to-end, from current
  source, and make drift structurally impossible.

The legacy user-level installer `plugins/cli/commands/install-cursor.py` (which
merges a hook into `~/.cursor/hooks.json`) is superseded by the marketplace
plugin and will be removed; the local-symlink dev path remains the
no-marketplace escape hatch.

## 2. Decisions (settled at kickoff)

- **Goal**: get vibeshub published on the Cursor marketplace from current source.
- **Sync strategy**: CI drift gate + manual (human-gated) release push. No
  automated cross-repo push, no cross-repo secrets.
- **Drift gate shape**: a **committed generated snapshot** in this repo plus a
  **blocking PR check**. Drift cannot merge. (Alternative considered and
  rejected: a non-blocking scheduled check against the live remote — leaves a
  transient-drift window and relies on someone acting on an alert.)
- **Snapshot location**: repo-root `cursor-plugin/` (committed). The generator's
  default `dist/vibeshub-cursor/` stays gitignored scratch for ad-hoc local
  generation. `cursor-plugin/` is the source of truth for "what we publish."
- **install-cursor.py**: removed (deprecated), along with its test and all
  references.
- **Version**: bump `PLUGIN_VERSION` `0.4.0 → 0.5.0` for the first marketplace
  release (shared code changed since the last generation; the milestone deserves
  a clean version). The generated `plugin.json` reads `version.py`, so it tracks
  automatically.

## 3. Architecture (unchanged; restated for context)

```
plugins/cli/                  source of truth (Claude Code + Codex plugin)
  └─ vibeshub_client/, platform_adapter.py, readers, hooks/on-pr-share.py
        │  scripts/sync-cursor-plugin.py  (deterministic generator)
        ▼
cursor-plugin/                committed generated snapshot (NEW; CI-verified)
        │  release runbook: push verified bytes
        ▼
github.com/vibeshub/vibeshub-cursor   published, feeds the Cursor marketplace
```

The runtime routing is already in place: the generated `hooks/on-pr-share.sh`
wrapper exports `VIBESHUB_PLATFORM=cursor` so `platform_adapter` selects the
Cursor reader. Nothing about the generated tree's shape changes here.

## 4. Workstreams

### 4.1 Version bump + first re-sync (the one-time fix)

- Set `PLUGIN_VERSION = "0.5.0"` in `plugins/cli/vibeshub_client/version.py`.
- Generate the current tree into the new committed snapshot
  (`python3 scripts/sync-cursor-plugin.py --out cursor-plugin`), which captures
  the four drifted files at the new version.
- Push the snapshot to `vibeshub/vibeshub-cursor` via the release runbook (4.3).
  This is the first execution of that runbook and brings the remote current.

### 4.2 Committed snapshot + blocking CI drift gate

- Generate `cursor-plugin/` and commit it. Add to git (it is *not* under the
  gitignored `dist/`). The tree carries its own "Generated (do not hand-edit)"
  README, so readers are warned.
- Add a new workflow (e.g. `.github/workflows/cursor-sync.yml`) that, on PRs and
  pushes touching `plugins/cli/**`, `scripts/sync-cursor-plugin.py`, or
  `cursor-plugin/**` (so a hand-edit of the snapshot alone is also caught), runs:
  `python3 scripts/sync-cursor-plugin.py --check --out cursor-plugin`. Build
  **fails on drift**, forcing the regenerate into the same PR. Self-contained
  (no network, no clone of the remote).
- This workflow also runs the plugin test suite for the generator and Cursor
  paths (`env/bin/pytest plugins/cli/tests/test_sync_cursor_plugin.py
  plugins/cli/tests/test_cursor_reader.py
  plugins/cli/tests/test_cursor_subagent_link.py
  plugins/cli/tests/test_platform_adapter.py`), since there is currently no PR
  CI running them at all. (Scope kept to Cursor-relevant tests; a broader CI
  workflow is out of scope.)

### 4.3 Release runbook (the manual push)

A short doc — `docs/cursor-release.md` (or a `Makefile`/script target invoked by
it) — with the ordered steps, so releasing is a single followed procedure rather
than tribal memory:

1. Bump `PLUGIN_VERSION` in `version.py`.
2. Regenerate the snapshot: `python3 scripts/sync-cursor-plugin.py --out cursor-plugin`.
3. Run tests: `env/bin/pytest plugins/cli/tests/`.
4. Open a PR; CI drift gate must pass (snapshot matches a fresh generate).
5. After merge, push the verified bytes to the remote: generate directly into a
   clone of `vibeshub/vibeshub-cursor`
   (`python3 scripts/sync-cursor-plugin.py --out /path/to/vibeshub-cursor-clone`,
   which preserves the clone's `.git`), commit with a
   `Generate from vibeshub@<sha>` message, and push. `--out` pointed at the
   clone touches only managed paths, never `.git`/`.gitignore`.
6. Tag the release.
7. **Manual maintainer steps** (documented, not automatable from here):
   - Local GUI smoke test: symlink the tree into
     `~/.cursor/plugins/local/vibeshub-cursor`, enable third-party plugins,
     Reload Window, confirm the Cursor description and `afterShellExecution`
     hook appear, and trigger it with a real `git push` to an open PR.
   - Submit at cursor.com/marketplace/publish and complete review.

### 4.4 Deprecate install-cursor.py

- Delete `plugins/cli/commands/install-cursor.py` and
  `plugins/cli/tests/test_install_cursor.py`.
- Update references away from it:
  - Root `README.md` (lines ~43, ~52): Cursor row becomes "Install vibeshub from
    the Cursor marketplace" (with the local-symlink dev path as the fallback).
  - `plugins/cli/README.md` (the `## Cursor` section, ~lines 30-44): replace the
    `install-cursor.py` instructions with the marketplace + local-symlink paths.
  - The generator's `_readme()` troubleshooting block
    (`scripts/sync-cursor-plugin.py`, ~lines 178-183): the fallback that points
    at `install-cursor.py` is rewritten to point at the local-symlink path and
    the absolute-path `hooks.json` edit. (Regenerating the snapshot then
    propagates this into `cursor-plugin/` and the remote.)
- Leave historical design/plan docs under `docs/superpowers/` untouched (they
  describe past state).

### 4.5 Verification

- `env/bin/pytest plugins/cli/tests/` passes (the removed `test_install_cursor.py`
  is gone; nothing else references the deleted module).
- `python3 scripts/sync-cursor-plugin.py --check --out cursor-plugin` exits 0.
- After the release push, `--check` against a fresh clone of the live remote
  exits 0 (the drift that started this work is gone).
- No user-facing copy uses em-dashes (project convention).

## 5. Out of scope

- Automated cross-repo push (rejected in §2).
- A general-purpose PR CI workflow beyond the Cursor sync + Cursor tests.
- The marketplace submission itself and the in-Cursor GUI validation (maintainer
  steps, documented in 4.3.7).
- Any change to the generated tree's runtime behavior or shape.

## 6. Risks / notes

- **Committed generated code** adds ~20 files and will show churn in diffs when
  shared code changes. Accepted: it is the price of a self-contained, blocking,
  network-free drift gate, and the snapshot doubles as the exact publish payload.
- **Version-bump discipline** is not CI-enforced (CI enforces tree sync, not that
  a human bumped the version). The release runbook makes the bump step 1.
- **Snapshot vs remote divergence**: both are generated from the same source +
  `version.py`, so byte-identical. The runbook pushes the same generator output;
  the post-release `--check` against the remote confirms it.
