# Adding a new platform plugin

Each platform plugin (Claude Code, Cursor, Codex, ...) is a thin layer over
the shared `vibeshub-client` library.

To add `<platform>`:

1. Create `plugins/<platform>/` mirroring the layout of `plugins/claude-code/`.
2. Implement `reader.py` with a `TranscriptReader` subclass that:
   - returns the transcript JSONL path for the active session
   - returns a stable `platform_id` string (this becomes the `platform` field
     on uploaded traces)
3. Configure the platform's hook/event surface to invoke the shared
   `run_share_pipeline()` when a PR is created. The Claude Code plugin uses a
   `PostToolUse` hook on `Bash` matching `gh pr create`; other platforms will
   have different surfaces.
4. Add a slash command (or its platform equivalent) for manual share + delete.
5. Document install + config in a `README.md` modeled on
   `plugins/claude-code/README.md`.

The server doesn't need to change to accept a new platform — the `platform`
field is free-form on `/api/ingest`. If the new platform's transcript shape
isn't supported by `claude-code-log`, the server's render endpoint will return
`render_failed` and the frontend will fall back to raw JSONL.
