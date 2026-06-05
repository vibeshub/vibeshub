# Cursor marketplace plugin generator — Design

**Status**: draft, pending implementation
**Date**: 2026-06-05
**Branch**: `feature/cursor-marketplace-plugin`
**Issue**: vibeshub/vibeshub#108
**Follow-up to**: #104 (Cursor trace support), #105 → reverted in #107 (in-repo
marketplace packaging), `2026-06-04-cursor-trace-support-design.md`

## 1. Purpose

Cursor support ships today only via `plugins/cli/commands/install-cursor.py`,
which writes a hook straight into `~/.cursor/hooks.json`. We also want vibeshub
on the **Cursor marketplace**. The naive attempt (serve a Cursor marketplace
plugin from the main repo, #105) failed because Cursor walks up to the
repo-root `.claude-plugin/marketplace.json` and prefers it, and auto-discovers
`plugins/cli/hooks/hooks.json`, which is **Claude format** (`PostToolUse` +
`${CLAUDE_PLUGIN_ROOT}`) and breaks under Cursor. The two hook formats collide
on the same filename and are incompatible.

The fix (per #108) is a **separate, self-contained repo** `vibeshub/vibeshub-cursor`
with no `.claude-plugin/` ancestor and no Claude-format hooks, **generated from
`plugins/cli`** so there is no hand-maintained duplication.

This spec covers the part that lives in **this** repo: a generator/sync script
that deterministically produces the Cursor plugin tree from `plugins/cli`.
Creating/pushing the external repo and the manual Cursor GUI validation +
marketplace publish are explicitly out of scope for this branch (done by the
maintainer using the commands this spec hands off).

## 2. Decisions (settled at kickoff)

- **Repo name / layout**: `vibeshub/vibeshub-cursor`, single plugin,
  `source: "."` at repo root.
- **Sync mechanism**: copy-script (not git-subtree/submodule). Single source of
  truth is `plugins/cli` in this repo; regenerate on release.
- **What to copy**: the **whole** `vibeshub_client/` package (incl.
  `_vendor/truststore`) plus the four top-level runtime modules
  (`platform_adapter.py`, `reader.py`, `codex_reader.py`, `cursor_reader.py`)
  and `hooks/on-pr-share.py`. A whole-package copy is chosen over a computed
  minimal subset: it is robust against missing transitive imports and there is
  no meaningful size cost. (Codex/Claude readers ride along unused — harmless;
  `platform_adapter` imports all three regardless.)
- **Hook shape**: a generated **wrapper shell script** (`hooks/on-pr-share.sh`)
  rather than the inline `VIBESHUB_PLATFORM=cursor python3 ./hooks/on-pr-share.py`
  form. The wrapper `export`s the platform itself and resolves the python path
  via `$0`, eliminating the "does the env-prefix survive Cursor's runner?"
  unknown and shrinking the "does `./` resolve?" unknown to a single path.
- **Copy tone**: functional parity. Generate Cursor-flavored README + manifest
  descriptions; leave the copied runtime code's messages as-is (already a
  neutral `[vibeshub]` prefix). No deep rewording (YAGNI; polish later).

## 3. Deliverable: `scripts/sync-cursor-plugin.py`

A stdlib-only Python 3 script (no third-party deps, matching the plugin).
Hyphenated filename to match the repo's other CLI scripts
(`install-cursor.py`, `on-pr-share.py`); tests load it via `importlib`.

### 3.1 CLI

- `--out PATH` — output directory. Default `dist/vibeshub-cursor/` (gitignored).
  May also point at a checked-out clone of `vibeshub/vibeshub-cursor`.
- `--source PATH` — plugin source. Default `plugins/cli`.
- `--check` — regenerate into a temp dir and diff against `--out`; exit non-zero
  on drift. This is the optional CI sync check from #108.
- Default action writes/refreshes the tree and prints the path.

### 3.2 Safe regeneration

The script owns a fixed set of **managed paths** and only ever removes those
before regenerating:

```
.cursor-plugin/  hooks/  vibeshub_client/
platform_adapter.py  reader.py  codex_reader.py  cursor_reader.py
README.md  LICENSE
```

It never touches anything else in `--out` (notably `.git/`, `.gitignore`), so
pointing `--out` at a real clone is safe. Copies exclude `__pycache__`/`*.pyc`.

### 3.3 Generated tree

```
vibeshub-cursor/
├── .cursor-plugin/
│   ├── marketplace.json   # name, owner, metadata.description,
│   │                      #   plugins:[{name:"vibeshub", source:".",
│   │                      #   description, category:"Engineering", keywords}]
│   └── plugin.json        # name, description (Cursor wording), version
│                          #   (read from vibeshub_client/version.py), author,
│                          #   repository (vibeshub-cursor), keywords,
│                          #   hooks:"./hooks/hooks.json"
├── hooks/
│   ├── hooks.json         # Cursor format (see 3.4)
│   ├── on-pr-share.sh      # GENERATED wrapper, chmod 0755
│   └── on-pr-share.py      # copied verbatim from plugins/cli/hooks/
├── vibeshub_client/        # whole package copied, __pycache__ excluded
├── platform_adapter.py     # copied
├── reader.py               # copied
├── codex_reader.py         # copied
├── cursor_reader.py        # copied
├── README.md               # GENERATED (Cursor-flavored + "do not hand-edit")
└── LICENSE                 # GENERATED MIT
```

Invariant (asserted by tests): **no** `.claude-plugin/`, `.codex-plugin/`,
`PostToolUse`, `${CLAUDE_PLUGIN_ROOT}`, or `__pycache__` anywhere in the tree.

### 3.4 hooks.json (Cursor format)

```json
{
  "hooks": {
    "afterShellExecution": [
      {
        "command": "./hooks/on-pr-share.sh",
        "matcher": "gh pr (create|edit)|git\\s+push"
      }
    ]
  }
}
```

Flat, lowercase event, same matcher as `vibeshub_client.share_trigger`. No
`${CLAUDE_PLUGIN_ROOT}`.

### 3.5 Wrapper `hooks/on-pr-share.sh`

```sh
#!/usr/bin/env bash
# GENERATED by scripts/sync-cursor-plugin.py in vibeshub/vibeshub — do not edit.
# Cursor afterShellExecution wrapper for vibeshub auto-share. Resolves its own
# directory (cwd-independent) and routes the adapter to the Cursor reader.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
export VIBESHUB_PLATFORM=cursor
exec python3 "$here/on-pr-share.py"
```

`on-pr-share.py:57` resolves `plugin_root = Path(__file__).resolve().parent.parent`
when `CLAUDE_PLUGIN_ROOT` is unset (= the tree root, where `vibeshub_client/`
and `platform_adapter.py` live), then `sys.path.insert(0, plugin_root)` and
imports succeed. The Cursor `afterShellExecution` payload carries `command`
(handled at `on-pr-share.py:75`) and `cwd` (used for `resolve_pr_url`); the
wrapper passes stdin through to python unchanged via `exec`.

### 3.6 Manifests

`plugin.json` `version` is read from `plugins/cli/vibeshub_client/version.py`
(`PLUGIN_VERSION`, currently `0.4.0`) so it can never drift from source.
`repository` points at `https://github.com/vibeshub/vibeshub-cursor`. Author
block mirrors `plugins/cli/.claude-plugin/plugin.json`. Descriptions use Cursor
wording ("Cursor agent conversation traces").

## 4. Local testing (before any marketplace submission)

Both paths need neither the marketplace nor the external GitHub repo.

1. **Offline harness** — run the *generated* `hooks/on-pr-share.py` standalone
   against a synthetic Cursor `afterShellExecution` payload on stdin with
   `VIBESHUB_PLATFORM=cursor`. Proves the copied import tree resolves from the
   new plugin root and the adapter selects `CursorTranscriptReader`. (Encoded as
   an automated test; also documented for manual runs.)
2. **In-Cursor GUI** (manual, maintainer) — Cursor loads "local" plugins from a
   directory:
   ```
   ln -s <out>/vibeshub-cursor ~/.cursor/plugins/local/vibeshub-cursor
   ```
   enable Settings → Features → "Include third-party Plugins, Skills, and other
   configs"; Reload Window. Confirm the Plugins panel shows the **Cursor**
   description (not "Claude Code") and an **`afterShellExecution`** hook (not
   `PostToolUse`). Watch the Hooks output channel for the two known risks
   (does `./hooks/on-pr-share.sh` resolve? does the env survive? — the wrapper
   removes the second). Then a real `git push` to an open PR from a Cursor agent
   session → trace uploads with the Cursor badge + nested subagents.

If `./hooks/on-pr-share.sh` does not resolve in Cursor, the generated README
documents the fallbacks (absolute path / Cursor-provided root var / re-run the
existing `install-cursor.py` user-hook path).

## 5. Tests (TDD)

`scripts/test_sync_cursor_plugin.py`, run under the repo's pytest
(`env/bin/pytest`). The generator is loaded via `importlib` (hyphenated name).

1. **Tree shape** — generating into a temp dir produces every expected file;
   asserts the §3.3 invariant (none of the forbidden markers/dirs present).
2. **hooks.json** — parses, is Cursor format, correct matcher, command is the
   wrapper, no `PostToolUse`/`${CLAUDE_PLUGIN_ROOT}`.
3. **Version sync** — `plugin.json` `version` == `PLUGIN_VERSION` from source.
4. **Wrapper** — mode `0755`, contains the `export` and `exec`.
5. **Import-completeness** (key guarantee) — from the generated root,
   `import platform_adapter, vibeshub_client.pipeline, …` succeeds in a
   subprocess and `select_adapter({}, {"VIBESHUB_PLATFORM": "cursor"})` returns
   `CursorTranscriptReader`. Catches any missing transitive module.
6. **Idempotency & safety** — two runs produce byte-identical trees; a `.git`
   dir and stray file in `--out` survive; `--check` passes after a clean
   generate and fails after a managed file is mutated.

## 6. Out of scope (maintainer follow-up, handed off with commands)

- Create public repo `vibeshub/vibeshub-cursor` and push the generated tree.
- Manual Cursor GUI validation (§4.2) and real-PR smoke test.
- Submit at cursor.com/marketplace/publish (manual review).
- Wiring the generator into a release/CI step (the `--check` mode is provided;
  the workflow that calls it is out of scope here).
