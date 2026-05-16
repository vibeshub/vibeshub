# Remove upload consent prompt — design

## Background

Today the share pipeline (`plugins/shared/vibeshub_client/pipeline.py`) tries to
prompt the user for `y/N` confirmation before uploading a trace. The prompt
opens `/dev/tty` directly so it works even when stdin/stdout are piped by the
Claude Code hook harness. When no TTY is available it falls back to
"installing the plugin is consent" and auto-shares with a note. Two env vars
gate the behavior: `VIBESHUB_AUTO_YES=1` skips the prompt, `VIBESHUB_AUTO_NO=1`
declines without prompting.

In practice the TTY prompt is rarely seen — most Claude Code clients (especially
the VS Code extension) run hooks without a controlling terminal, so the
auto-share fallback already fires for the majority of installs. The prompt adds
code paths, surprise behavior for the small minority who *do* hit it, and one
more flag to document.

## Goal

Treat installation of the plugin as consent for uploading traces. Remove the
prompt and the surrounding env-var gating entirely.

## Non-goals

- No changes to redaction.
- No changes to the upload protocol, PR comment behavior, or share-pr command
  shape.
- No new opt-out env var. If a user does not want uploads, they uninstall the
  plugin or remove the hook.

## Changes

### `plugins/shared/vibeshub_client/pipeline.py`

- Remove the entire `if options.confirm:` block (lines 49–66 today),
  including the `VIBESHUB_AUTO_NO` / `VIBESHUB_AUTO_YES` env checks and the
  `auto_share_note` variable.
- Remove the `confirm: bool = True` field from `RunOptions`.
- Drop the `preview` import line.
- The `skip_reason` field on `RunResult` is still useful for upload/comment
  failures, so it stays.

### `plugins/shared/vibeshub_client/preview.py`

- Delete the file. All four functions (`format_summary`, `parse_yes_no`,
  `has_interactive_tty`, `confirm_via_tty`) become unused.

### `plugins/claude-code/hooks/on-pr-create.py`

- Drop `confirm=os.environ.get("VIBESHUB_AUTO_YES") != "1",` from the
  `RunOptions(...)` call.

### `plugins/claude-code/commands/share-pr.py`

- Drop the same `confirm=...` argument from its `RunOptions(...)` call.

### Tests

- Delete `plugins/shared/tests/test_preview.py`.
- In `plugins/shared/tests/test_pipeline.py`, delete the three TTY/env-gated
  tests (`test_pipeline_skips_when_user_declines`,
  `test_pipeline_auto_shares_when_no_tty`,
  `test_pipeline_skips_when_auto_no_env_set`,
  `test_pipeline_skips_prompt_when_auto_yes_env_set`). Update the happy-path
  test to drop the `confirm=False` argument (now invalid).
- In `plugins/claude-code/tests/test_hook_e2e.py`, remove the
  `env["VIBESHUB_AUTO_YES"] = "1"` line — no longer needed since the prompt is
  gone.

### Docs

- `plugins/claude-code/README.md`: remove the `VIBESHUB_AUTO_YES` row from the
  env table, and rewrite step 3 of "How it works" to drop the y/N preview
  language. The redaction step now does its work without a user-facing summary.

## Risk

- Users who relied on `VIBESHUB_AUTO_NO=1` to skip uploads will start sharing
  traces silently. This is a behavior change — flagged in the commit message.
- The y/N preview was also serving as a redaction spot-check. We rely on the
  existing dual redaction passes (client + server) and the post-upload PR
  comment, which still lets the author delete the trace via `/share-pr delete`.
