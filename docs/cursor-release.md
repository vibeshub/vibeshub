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
git tag "v$(python3 -c 'from vibeshub_client.version import PLUGIN_VERSION; print(PLUGIN_VERSION)')"
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
