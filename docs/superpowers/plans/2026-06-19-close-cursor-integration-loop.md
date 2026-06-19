# Close the Cursor Integration Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish vibeshub to the Cursor marketplace from current source by re-syncing the stale `vibeshub-cursor` repo, adding a committed snapshot + blocking CI drift gate, documenting the release runbook, and removing the deprecated `install-cursor.py` path.

**Architecture:** `plugins/cli` is the single source of truth. `scripts/sync-cursor-plugin.py` deterministically generates a self-contained Cursor plugin tree from it. We commit that generated tree at repo-root `cursor-plugin/` (CI-verified against a fresh generate, so drift can't merge), and the release runbook pushes the same bytes to `github.com/vibeshub/vibeshub-cursor`, which feeds the Cursor marketplace.

**Tech Stack:** Python 3 standard library only (generator + plugin), GitHub Actions (CI), Markdown (docs). Tests run under `env/bin/pytest`.

## Global Constraints

- **Stdlib only.** The generator and plugin runtime use only the Python standard library (plus the vendored `truststore`). No new third-party deps.
- **Python floor 3.9+.** Code must run on `python3` 3.9+.
- **No em-dashes in user-facing copy** (`—`). Use commas, periods, parentheses, or arrows (`→`).
- **Single source of truth.** Never hand-edit `cursor-plugin/` or the `vibeshub-cursor` remote. Both are regenerated from `plugins/cli` by `scripts/sync-cursor-plugin.py`.
- **Test runner is `env/bin/pytest`** (run from repo root `/Users/bhavya/git/vibeshub`).
- **Verify the branch in the same command as every commit** (other sessions switch branches in this checkout). Work happens on branch `cursor-close-loop`.
- **Commit messages** end with a trailer line: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure

- **Delete:** `plugins/cli/commands/install-cursor.py`, `plugins/cli/tests/test_install_cursor.py`
- **Modify:** `README.md` (Cursor rows), `plugins/cli/README.md` (`## Cursor` section), `scripts/sync-cursor-plugin.py` (`_readme()` troubleshooting copy), `plugins/cli/vibeshub_client/version.py` (version bump)
- **Create (generated):** `cursor-plugin/**` (committed snapshot — the generator owns its contents)
- **Create:** `.github/workflows/cursor-sync.yml` (drift gate + Cursor tests), `docs/cursor-release.md` (release runbook)

---

### Task 1: Deprecate `install-cursor.py` and update all references

Remove the legacy user-level hook installer and repoint every reference to the marketplace / local-symlink paths. This includes the generator's own README copy, so it must land **before** the snapshot is generated in Task 2.

**Files:**
- Delete: `plugins/cli/commands/install-cursor.py`
- Delete: `plugins/cli/tests/test_install_cursor.py`
- Modify: `README.md` (lines ~43 and ~52)
- Modify: `plugins/cli/README.md` (`## Cursor` section, ~lines 30-46)
- Modify: `scripts/sync-cursor-plugin.py` (`_readme()` troubleshooting block, ~lines 177-183)

**Interfaces:**
- Consumes: nothing.
- Produces: an updated `_readme()` whose generated text no longer mentions `install-cursor.py` (Task 2 generates the snapshot from this).

- [ ] **Step 1: Delete the installer and its test**

```bash
cd /Users/bhavya/git/vibeshub
git rm plugins/cli/commands/install-cursor.py plugins/cli/tests/test_install_cursor.py
```

- [ ] **Step 2: Update root `README.md` Quick-start comment (line ~43)**

Replace:

```
# Cursor: python3 plugins/cli/commands/install-cursor.py
```

with:

```
# Cursor: install vibeshub from the Cursor marketplace
```

- [ ] **Step 3: Update root `README.md` Supported-platforms table (line ~52)**

Replace:

```
| Cursor | One-time hook install: `python3 plugins/cli/commands/install-cursor.py` |
```

with:

```
| Cursor | Marketplace plugin: install **vibeshub** from the Cursor marketplace ([vibeshub/vibeshub-cursor](https://github.com/vibeshub/vibeshub-cursor)) |
```

- [ ] **Step 4: Rewrite the `## Cursor` section of `plugins/cli/README.md`**

Replace the whole section (from `## Cursor` through the paragraph ending `...blank in the viewer.`, i.e. the current lines 30-46) with:

```markdown
## Cursor

Cursor runs the same share logic through its own hook system, packaged as a
separate plugin generated from this one by `scripts/sync-cursor-plugin.py` and
published at [vibeshub/vibeshub-cursor](https://github.com/vibeshub/vibeshub-cursor).

Install **vibeshub** from the Cursor marketplace, then Reload Window.

To install without the marketplace (local development or air-gapped machines),
symlink the generated plugin tree into Cursor's local plugins directory:

```
ln -s /path/to/vibeshub-cursor ~/.cursor/plugins/local/vibeshub-cursor
```

Enable Settings → Features → "Include third-party Plugins, Skills, and other
configs", then Reload Window.

Either way, an `afterShellExecution` hook runs the plugin's share script after a
`git push`, tagged with `VIBESHUB_PLATFORM=cursor`. It reads the Cursor agent
transcript from `~/.cursor/projects/<project>/agent-transcripts/<id>/`
(including any subagents) and uploads it the same way. Cursor transcripts record
the conversation and tool calls but not tool outputs, token counts, or the model
name, so those fields are blank in the viewer.
```

- [ ] **Step 5: Update the generator's `_readme()` troubleshooting block in `scripts/sync-cursor-plugin.py`**

Replace:

```
If the Hooks output channel reports that `./hooks/on-pr-share.sh` cannot be
found, Cursor did not resolve the command relative to the plugin root. Edit
`hooks/hooks.json` to use an absolute path to `on-pr-share.sh`, or fall back to
the user-level hook installer in the main repo
(`plugins/cli/commands/install-cursor.py`).
```

with:

```
If the Hooks output channel reports that `./hooks/on-pr-share.sh` cannot be
found, Cursor did not resolve the command relative to the plugin root. Edit
`hooks/hooks.json` to use an absolute path to `on-pr-share.sh`, or install the
plugin locally by symlinking this directory into
`~/.cursor/plugins/local/vibeshub-cursor` (see "Local development / testing"
above) so Cursor resolves the hook from a fixed path.
```

- [ ] **Step 6: Verify no stray references remain and the suite is green**

Run:

```bash
cd /Users/bhavya/git/vibeshub
grep -rIn --exclude-dir=.git --exclude-dir=node_modules "install-cursor\|install_cursor" \
  README.md plugins/ scripts/
```

Expected: **no matches** (exit 1 / empty output). Historical docs under `docs/superpowers/` may still mention it — that is fine; do not edit them.

Run:

```bash
env/bin/pytest plugins/cli/tests/ -q
```

Expected: PASS (the suite runs without `test_install_cursor.py`; nothing imports the deleted module).

- [ ] **Step 7: Commit**

```bash
cd /Users/bhavya/git/vibeshub
test "$(git branch --show-current)" = "cursor-close-loop" && \
git add -A README.md plugins/cli/README.md scripts/sync-cursor-plugin.py \
  plugins/cli/commands/install-cursor.py plugins/cli/tests/test_install_cursor.py && \
git commit -m "$(cat <<'EOF'
Deprecate install-cursor.py in favor of the Cursor marketplace plugin

Remove the user-level ~/.cursor/hooks.json installer and its test; repoint the
root README, plugin README, and the generator's troubleshooting copy to the
marketplace and local-symlink paths.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Bump version and commit the `cursor-plugin/` snapshot

Bump the plugin version for the first marketplace release, then generate the committed snapshot from current source (now including Task 1's copy change and the four files that drifted on the remote).

**Files:**
- Modify: `plugins/cli/vibeshub_client/version.py`
- Create (generated): `cursor-plugin/**`

**Interfaces:**
- Consumes: the updated `_readme()` from Task 1; `PLUGIN_VERSION` from `version.py` (read by the generator into `plugin.json`).
- Produces: `cursor-plugin/` — the committed snapshot that Task 3's CI gate checks and the release runbook (Task 4 / Task 5) pushes.

- [ ] **Step 1: Bump the version**

In `plugins/cli/vibeshub_client/version.py`, replace:

```python
PLUGIN_VERSION = "0.4.0"
```

with:

```python
PLUGIN_VERSION = "0.5.0"
```

- [ ] **Step 2: Confirm the version-sync test tracks the bump**

Run:

```bash
cd /Users/bhavya/git/vibeshub
env/bin/pytest plugins/cli/tests/test_sync_cursor_plugin.py::test_plugin_json_version_matches_source -q
```

Expected: PASS (the test reads `version.py` dynamically, so the generated `plugin.json` version follows the bump).

- [ ] **Step 3: Generate the committed snapshot**

```bash
cd /Users/bhavya/git/vibeshub
python3 scripts/sync-cursor-plugin.py --out cursor-plugin
```

Expected output includes: `Generated Cursor plugin at .../cursor-plugin`.

- [ ] **Step 4: Verify the snapshot is in sync and shaped correctly**

Run:

```bash
cd /Users/bhavya/git/vibeshub
python3 scripts/sync-cursor-plugin.py --check --out cursor-plugin
echo "exit=$?"
grep -RIl "install-cursor" cursor-plugin || echo "no install-cursor refs in snapshot"
test -f cursor-plugin/.cursor-plugin/plugin.json && grep '"version"' cursor-plugin/.cursor-plugin/plugin.json
```

Expected: `in sync: cursor-plugin`, `exit=0`; `no install-cursor refs in snapshot`; version line shows `"version": "0.5.0"`.

- [ ] **Step 5: Commit the version bump and snapshot**

```bash
cd /Users/bhavya/git/vibeshub
test "$(git branch --show-current)" = "cursor-close-loop" && \
git add plugins/cli/vibeshub_client/version.py cursor-plugin && \
git commit -m "$(cat <<'EOF'
Bump plugin to 0.5.0 and commit the generated cursor-plugin snapshot

cursor-plugin/ is the CI-verified, deterministic generate of the Cursor
marketplace plugin from plugins/cli. It is the source of truth for what we push
to vibeshub/vibeshub-cursor. Regenerate with scripts/sync-cursor-plugin.py;
never hand-edit.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add the CI drift-gate workflow

A blocking check that regenerates the Cursor tree from `plugins/cli` and diffs it against the committed `cursor-plugin/` snapshot. Any PR that changes plugin source without regenerating the snapshot fails. Also runs the Cursor-relevant tests (there is currently no PR CI running them).

**Files:**
- Create: `.github/workflows/cursor-sync.yml`

**Interfaces:**
- Consumes: `cursor-plugin/` (Task 2), `scripts/sync-cursor-plugin.py --check`.
- Produces: nothing (CI gate only).

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/cursor-sync.yml`:

```yaml
name: Cursor plugin sync

# Fail any change that desyncs the committed cursor-plugin/ snapshot from a
# fresh generate of plugins/cli. The snapshot is what we push to
# vibeshub/vibeshub-cursor, so this keeps the published plugin from drifting.
on:
  pull_request:
    paths:
      - "plugins/cli/**"
      - "scripts/sync-cursor-plugin.py"
      - "cursor-plugin/**"
      - ".github/workflows/cursor-sync.yml"
  push:
    branches: [main]
    paths:
      - "plugins/cli/**"
      - "scripts/sync-cursor-plugin.py"
      - "cursor-plugin/**"

jobs:
  sync-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Cursor snapshot is in sync with plugins/cli
        run: python3 scripts/sync-cursor-plugin.py --check --out cursor-plugin

      - name: Cursor plugin tests
        run: |
          python3 -m pip install --quiet pytest
          python3 -m pytest \
            plugins/cli/tests/test_sync_cursor_plugin.py \
            plugins/cli/tests/test_cursor_reader.py \
            plugins/cli/tests/test_cursor_subagent_link.py \
            plugins/cli/tests/test_platform_adapter.py \
            -q
```

- [ ] **Step 2: Validate the YAML parses**

Run:

```bash
cd /Users/bhavya/git/vibeshub
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/cursor-sync.yml')); print('yaml ok')"
```

Expected: `yaml ok`. (If `yaml` is unavailable, instead run `python3 -c "import json,sys; print('skip - pyyaml not installed')"` and rely on Step 3.)

- [ ] **Step 3: Run the exact commands the workflow runs, locally**

Run:

```bash
cd /Users/bhavya/git/vibeshub
python3 scripts/sync-cursor-plugin.py --check --out cursor-plugin && \
env/bin/pytest plugins/cli/tests/test_sync_cursor_plugin.py \
  plugins/cli/tests/test_cursor_reader.py \
  plugins/cli/tests/test_cursor_subagent_link.py \
  plugins/cli/tests/test_platform_adapter.py -q
```

Expected: `in sync: cursor-plugin` then all tests PASS. (This proves the gate is green on the current tree, so the workflow will pass on merge.)

- [ ] **Step 4: Commit**

```bash
cd /Users/bhavya/git/vibeshub
test "$(git branch --show-current)" = "cursor-close-loop" && \
git add .github/workflows/cursor-sync.yml && \
git commit -m "$(cat <<'EOF'
Add CI gate: cursor-plugin snapshot must match a fresh generate

Regenerates the Cursor tree from plugins/cli and diffs it against the committed
cursor-plugin/ snapshot, failing on drift, plus runs the Cursor-relevant tests.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Write the release runbook

A single followed procedure for cutting a Cursor release, including the manual maintainer steps (GUI smoke test + marketplace submission) that can't be automated from this repo.

**Files:**
- Create: `docs/cursor-release.md`

**Interfaces:**
- Consumes: the generator, the `cursor-plugin/` snapshot, the CI gate.
- Produces: documented commands consumed by Task 5 (the maintainer-run release).

- [ ] **Step 1: Create `docs/cursor-release.md`**

```markdown
# Releasing the Cursor plugin

vibeshub for Cursor is generated from `plugins/cli` by
`scripts/sync-cursor-plugin.py`, committed to `cursor-plugin/` (CI-verified),
and published to [`vibeshub/vibeshub-cursor`](https://github.com/vibeshub/vibeshub-cursor),
which feeds the Cursor marketplace. Never hand-edit `cursor-plugin/` or the
remote; regenerate instead.

## Cut a release (in this repo, via PR)

1. Bump the version in `plugins/cli/vibeshub_client/version.py`
   (`PLUGIN_VERSION`). The generated `plugin.json` reads this.
2. Regenerate the committed snapshot:
   ```sh
   python3 scripts/sync-cursor-plugin.py --out cursor-plugin
   ```
3. Run the tests:
   ```sh
   env/bin/pytest plugins/cli/tests/
   ```
4. Open a PR. The **Cursor plugin sync** workflow must pass (it fails if
   `cursor-plugin/` does not match a fresh generate). Merge it.

## Publish to the remote (after merge)

Generate directly into a clone of the remote so its `.git` is preserved
(`--out` only ever touches the managed paths):

```sh
git clone git@github.com:vibeshub/vibeshub-cursor.git /tmp/vibeshub-cursor
cd /path/to/vibeshub          # this repo, on the merged main
python3 scripts/sync-cursor-plugin.py --out /tmp/vibeshub-cursor
cd /tmp/vibeshub-cursor
git add -A
git commit -m "Generate from vibeshub@$(git -C /path/to/vibeshub rev-parse --short HEAD)"
git push
git tag "v$(python3 - <<'PY'
import re,io
print(re.search(r'"([^"]+)"', open('/path/to/vibeshub/plugins/cli/vibeshub_client/version.py').read()).group(1))
PY
)"
git push --tags
```

Confirm the remote is now in sync:

```sh
cd /path/to/vibeshub
git clone git@github.com:vibeshub/vibeshub-cursor.git /tmp/vibeshub-cursor-verify
python3 scripts/sync-cursor-plugin.py --check --out /tmp/vibeshub-cursor-verify
```

Expected: `in sync`.

## Marketplace submission (manual, maintainer)

1. **Local GUI smoke test.** Symlink the tree into Cursor's local plugins dir:
   ```sh
   ln -s /tmp/vibeshub-cursor ~/.cursor/plugins/local/vibeshub-cursor
   ```
   Enable Settings → Features → "Include third-party Plugins, Skills, and other
   configs", then Reload Window. Confirm the Plugins panel shows the **Cursor**
   description (not "Claude Code") and an **`afterShellExecution`** hook (not
   `PostToolUse`). Trigger it with a real `git push` to an open PR from a Cursor
   agent session and watch the Hooks output channel; the trace should upload
   with the Cursor badge.
2. **Submit.** Go to cursor.com/marketplace/publish, point it at
   `vibeshub/vibeshub-cursor`, and complete review.
```

- [ ] **Step 2: Sanity-check the runbook's read-only command**

Run (this is the verify command quoted in the runbook; it must succeed on the current tree):

```bash
cd /Users/bhavya/git/vibeshub
python3 scripts/sync-cursor-plugin.py --check --out cursor-plugin
```

Expected: `in sync: cursor-plugin`.

- [ ] **Step 3: Commit**

```bash
cd /Users/bhavya/git/vibeshub
test "$(git branch --show-current)" = "cursor-close-loop" && \
git add docs/cursor-release.md && \
git commit -m "$(cat <<'EOF'
Document the Cursor plugin release runbook

Ordered procedure: bump, regenerate, test, PR (CI gate), push to
vibeshub/vibeshub-cursor, tag, then the manual GUI smoke test and marketplace
submission.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Release (maintainer-executed — NOT for automated execution)

> Automated task-by-task execution stops at Task 4. This task is performed by the maintainer because it pushes to a public external repo and submits to a third-party marketplace. Follow `docs/cursor-release.md` exactly.

**Deliverable:** `vibeshub/vibeshub-cursor` updated to v0.5.0 (the four drifted files fixed) and the plugin submitted to the Cursor marketplace.

- [ ] **Step 1:** Open and merge the PR for this branch; confirm the **Cursor plugin sync** workflow passes.
- [ ] **Step 2:** Run `docs/cursor-release.md` "Publish to the remote" against merged `main`; confirm the post-push `--check` reports `in sync`.
- [ ] **Step 3:** Run `docs/cursor-release.md` "Marketplace submission" (local GUI smoke test, then submit at cursor.com/marketplace/publish).

---

## Self-Review

- **Spec coverage:** §4.1 version bump + re-sync → Task 2 (+ Task 5 push); §4.2 snapshot + CI gate → Tasks 2 & 3; §4.3 release runbook → Task 4; §4.4 deprecate install-cursor.py → Task 1; §4.5 verification → embedded verify steps in each task + Task 5 post-push `--check`. §5 out-of-scope items (cross-repo automation, broad CI, marketplace submission) are respected (submission is the manual Task 5).
- **Placeholders:** none — every code/edit step shows exact content and exact commands with expected output.
- **Type/name consistency:** `cursor-plugin/` (snapshot path), `scripts/sync-cursor-plugin.py --check --out cursor-plugin`, `PLUGIN_VERSION = "0.5.0"`, and workflow name `Cursor plugin sync` are used identically across tasks and the runbook.
