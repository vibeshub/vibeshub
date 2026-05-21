# Capture PR updates, not just PR creation

**Date:** 2026-05-21
**Status:** Approved

## Problem

The vibeshub plugin uploads a Claude Code session trace only when a PR is
first created (`gh pr create`). A PR usually keeps evolving afterwards — more
commits, edited description — and that later work is never captured. We want
the trace to keep pace with the PR.

## Goal

Re-run the share pipeline whenever the PR meaningfully changes, so each PR
ends up with an up-to-date trace for every Claude Code session that
contributed to it.

## Behavior

The hook re-runs the share pipeline on three commands:

- `gh pr create` — unchanged; PR URL parsed from `gh` stdout.
- `git push` — new commits land on the PR branch.
- `gh pr edit` — PR title/body changed.

Each Claude Code session maps to **one trace per PR**. Re-uploading from the
same session *refreshes* that trace in place, keeping a stable URL. A
different session that pushes to the same PR gets its own trace. A PR thus
accumulates one trace per session that contributed to it.

`gh` has no push command, so `git push` is the only push trigger.

## Design

### 1. Trigger detection — `hooks/on-pr-create.py` → `hooks/on-pr-share.py`

The inline `"gh pr create" not in command` check is replaced by a pure
function:

```
classify_share_trigger(command: str) -> "create" | "push" | "edit" | None
```

Substring matching, so compound commands (`git add . && git push`) are
handled. Returns `None` for anything unrelated, and the hook bails early as
it does today.

The hook file is renamed from `on-pr-create.py` to `on-pr-share.py` — the old
name is now misleading. This touches:

- `hooks/hooks.json` — the `command` path.
- Test imports / references to the hook script.

The `hooks.json` entry stays `PostToolUse` / `Bash` / `async: false`
(synchronous, per the decision below).

### 2. PR URL resolution

- **create**: parsed from `gh` stdout via the existing
  `extract_pr_url_from_gh_stdout`. A missing URL means the command failed —
  the hook bails, as today.
- **push / edit**: there is no URL in the command output. Resolve the current
  branch's open PR with `gh pr view --json url -q .url`. If that fails (the
  branch has no PR, the directory is not a repo, no auth), **bail silently**:
  this is the normal case for any push outside a PR. The reason is written to
  `~/.vibeshub/hook.log` only — nothing on stderr.

This resolver logic already exists in `commands/share-pr.py` (`_resolve_pr_url`).
It moves into a shared module under `vibeshub_client/`, and both the hook and
the `share-pr` command use it.

**Accepted cost:** this adds one `gh pr view` call to every `git push` the
user runs, anywhere. The hook is already synchronous, so this is a small added
latency on pushes; it returns fast when the directory is not a repo.

**Push success is not checked.** The trace is the conversation transcript, not
the diff, so refreshing it after a failed push is harmless and idempotent.

### 3. Backend upsert — `app/api/ingest.py`

Before creating a `Trace`, look up an existing row matching
`(repo_full_name, pr_number, session_id)` where `session_id IS NOT NULL` and
`deleted_at IS NULL`:

- **Found** → update in place: overwrite `traces/{short_id}/main.jsonl` and
  the agent blobs; refresh `message_count`, `byte_size`,
  `redaction_count_client`, `redaction_count_server`, `agents`,
  `agent_count`, `plugin_version`, and `pr_title`. The `short_id` is kept, so
  the trace URL is stable. If the existing row is a legacy v1 trace
  (`blob_path` set), set `blob_prefix` and null `blob_path`.
- **Not found**, or the incoming `session_id` is null → create a new row, as
  today.

A trace the user has deleted (`deleted_at` set) is *not* resurrected — a later
push creates a fresh row.

Re-uploading the same session does not normally orphan any agent blob.
`agent_id` is parsed from the subagent sidecar *filename*, which Claude Code
never renames, and subagents within a session are append-only — a later upload
re-discovers every earlier subagent plus any new ones, so the refreshed
`agents` JSON references everything previously written. The one exception is a
subagent sidecar file that disappears between uploads (e.g. the session ran in
a git worktree that was later removed); that leaves a harmless, unreferenced
blob. Not worth a cleanup pass.

### 4. Comment once per trace

`IngestResponse` gains a `created: bool` field. It flows from the ingest
response through `upload_bundle`'s result into `RunResult.created`.

`run_share_pipeline` posts the PR comment **only when `created` is true**:

- first `gh pr create` → new trace → comment posted.
- same-session `git push` / `gh pr edit` → trace refreshed → no comment.
- a *different* session pushing to the same PR → new trace → comment posted.

The upload result is logged to `~/.vibeshub/hook.log` and stderr regardless of
whether a comment was posted.

### 5. Synchronous execution

The hook stays synchronous (`async: false`). Each `git push` blocks Claude
until redact + upload + comment finishes. Accepted for simplicity and so the
result is visible inline.

## Testing

- **Unit** — `classify_share_trigger` (create / push / edit / unrelated /
  compound commands); the shared PR-URL resolver (success, no-PR, not-a-repo).
- **`test_hook_e2e.py`** — add `git push` and `gh pr edit` cases alongside the
  existing `gh pr create` case.
- **`test_pipeline.py`** — the PR comment is posted only when `created` is
  true.
- **Backend ingest** — uploading twice with the same `session_id` yields one
  `Trace` row, with refreshed content, an identical `short_id`, and
  `created=false` on the second response. Uploading with a null `session_id`
  always creates a new row.

## Out of scope (YAGNI)

- **No `updated_at` column / migration.** The upsert refreshes trace
  *content*, which is the requirement. A "refreshed N minutes ago" timestamp
  has no UI consumer yet.
- **No cleanup of orphaned agent blobs** on upsert — only possible via the
  narrow worktree-removal edge in §3, and the leftover blob is harmless.
- **No async hook execution.**
