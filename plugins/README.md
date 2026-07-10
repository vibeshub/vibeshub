# Platform plugins

Claude Code, Codex, and Cursor all share one upload pipeline. The source of
truth is [cli/](cli/):

- **Claude Code + Codex** install from this repo's marketplace package
  (`plugins/cli`). Runtime detection picks the right transcript reader.
- **Cursor** is a separate marketplace package generated from `plugins/cli` by
  [`scripts/sync-cursor-plugin.py`](../scripts/sync-cursor-plugin.py) and
  published at [vibeshub/vibeshub-cursor](https://github.com/vibeshub/vibeshub-cursor).
  Do not hand-edit the generated tree; change `plugins/cli` and re-run the sync
  script.

`vibeshub_client/` lives bundled inside `plugins/cli/` (and is copied into the
Cursor package) so each marketplace install is self-contained. Install and
config details: [cli/README.md](cli/README.md).

## How platforms are selected

[`cli/platform_adapter.py`](cli/platform_adapter.py) chooses a
`TranscriptReader` from `VIBESHUB_PLATFORM` (Cursor hooks set this explicitly),
transcript path (`~/.claude`, `~/.codex/sessions`, `~/.cursor/projects`), or
Codex/Claude env signals. Each reader returns a stable `platform_id` that
becomes the `platform` field on uploaded traces.

Triggers (`gh pr create`, `gh pr edit`, `git push`) are classified in
[`cli/vibeshub_client/share_trigger.py`](cli/vibeshub_client/share_trigger.py);
all platforms call the shared `run_share_pipeline()`.

## Adding another platform

1. Add a `TranscriptReader` subclass next to `reader.py` / `codex_reader.py` /
   `cursor_reader.py` that:
   - returns the transcript JSONL path for the active session
   - returns a stable `platform_id` string
2. Wire it into `platform_adapter.select_adapter()`.
3. Hook the platform's event surface so PR create/update/push invokes
   `run_share_pipeline()` (Claude/Codex: `PostToolUse` on `Bash`; Cursor:
   `afterShellExecution`).
4. Add a slash command (or platform equivalent) for manual share + delete.
5. If the platform needs its own marketplace package (like Cursor), extend
   `scripts/sync-cursor-plugin.py` or add a sibling generator — keep
   `plugins/cli` as the shared source.
6. Document install + config in [cli/README.md](cli/README.md).

The server accepts any free-form `platform` on `/api/ingest`. Non-Claude
transcript shapes are converted to Claude-shaped JSONL at ingest (see
`webapp/backend/app/codex_convert.py` and `cursor_convert.py`); the viewer and
digest agent always read that converted stream.
