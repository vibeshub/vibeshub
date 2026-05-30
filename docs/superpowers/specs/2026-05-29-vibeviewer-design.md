# vibeviewer — public no-login upload page — Design

**Date:** 2026-05-29
**Status:** Implemented
**Design source:** Claude Design handoff bundle (`Vibeviewer.html` + `chats/chat10.md`)

## Problem

Uploading a trace today requires a GitHub sign-in: `/upload` shows a sign-in
wall and `POST /api/uploads` returns `403` for anonymous callers. That is
friction for the most common "I just want to show off / share this session"
case. We want a public, no-login page where anyone can drop a Claude Code
transcript and immediately get a shareable `/t/<shortId>` link, while still
nudging sign-in so the trace can be linked to a GitHub profile.

## Decisions (from brainstorming + the design handoff)

- **New canonical page `/vibeviewer`; retire `/upload`.** `/upload` now
  redirects to `/vibeviewer`. The old signed-in, multi-step upload form
  (repo/PR picker + privacy toggle) is removed; that linking now happens
  **after claiming**, via the existing Edit UI on the trace view
  (`PATCH /api/traces/:id`).
- **Anonymous uploads are ownerless and public.** `Trace.owner_login` becomes
  nullable. An anonymous upload has `owner_login = NULL`, `is_private = false`,
  no repo/PR association (anonymous callers can't authenticate to GitHub), and
  is reachable only by its `/t/<id>` link (it never appears on a profile).
- **Post-upload claim flow.** Anyone uploads without an account and gets the
  link immediately. The on-page success card offers "Sign in to claim it";
  signing in (or, if already signed in, clicking "Claim to your profile")
  transfers ownership of that just-uploaded trace to the user. Claiming is
  authorized by a one-time **claim token** returned only to the uploader.
- **Success stays on the page** (per the design). Rather than redirecting
  straight to `/t/<id>`, the page shows a "Your trace is live" card with the
  shareable link (hover-to-copy, auto-prompted), an "Open trace" button, the
  claim CTA, and "Upload another".
- **Abuse mitigation is deferred.** v1 ships with only the existing
  `max_trace_bytes` (50 MB) cap and the existing client+server redaction. No
  rate limiting or CAPTCHA yet (add reactively).

## Architecture

### Data model (`app/storage/models.py` + migration `d2e4f6a8c0b1`)

- `Trace.owner_login` → `Optional[str]`, `nullable=True` (index kept).
- New `Trace.claim_token_hash: Optional[str]` (`String(64)`, sha256 hex). Holds
  the hash of the anonymous upload's claim token; cleared on claim.

One Alembic migration alters `owner_login` to nullable and adds
`claim_token_hash`. Existing rows all carry an owner and a null hash, so they
are unaffected.

### `POST /api/uploads` (`app/api/uploads.py`)

The `403`-on-anonymous guard is removed.

- **Anonymous** (no session cookie): `owner_login = None`, `is_private = False`,
  `pr_url` / `repo_full_name` ignored. Generates
  `claim_token = secrets.token_urlsafe(32)`, stores
  `sha256(claim_token)` as `claim_token_hash`, and returns the raw
  `claim_token` in the response.
- **Signed-in**: unchanged from today (attributed to the user, optional
  repo/PR association); `claim_token` is `null`.

`create_or_update_trace` takes `owner_login: str | None` and a new
`claim_token_hash`, and **skips the session-id upsert lookup when
`owner_login is None`** so distinct anonymous uploads never collapse into one
row.

### `POST /api/traces/{short_id}/claim` (`app/api/traces.py`)

- Auth: session cookie; `401 auth_required` if anonymous.
- Body: `{ "claim_token": "<token>" }` (`ClaimRequest`).
- `404 not_found` if the trace is missing/soft-deleted.
- `409 already_claimed` if `owner_login` is already set; `409 not_claimable`
  if there is no claim hash.
- Constant-time (`secrets.compare_digest`) compare of `sha256(token)` against
  `claim_token_hash`; mismatch → `403 invalid_claim_token`.
- On success: `owner_login = user.github_login`, `claim_token_hash = NULL`,
  returns the trace summary. `Cache-Control: no-store` on all responses.

### Subagent zip (method 2 convenience) — `app/redact/bundle.py`

`unpack_loose_files` now also accepts the **local** Claude Code naming
`agent-<id>.jsonl` / `agent-<id>.meta.json` (matched on the basename, so a
leading `subagents/` dir is tolerated), in addition to the canonical
`agents/<id>.*`. This makes the suggested `zip -j out.zip <session>/subagents/*`
command "just work". The CLI tar path (`unpack_and_redact`) is untouched.

### Access control / serialization

`TraceSummary.owner_login` is nullable. Anonymous (null-owner) traces are
always public, so the existing public-trace path serves them; profile/list
queries filter by `owner_login == login`, which null never matches, so they
stay off profiles until claimed. The SSR meta (`spa_seo.py`) null-guards the
`@owner` description.

## Frontend (`/vibeviewer`)

The page recreates the Claude Design `Vibeviewer.html` mock in React, on the
real design tokens. Topbar chrome reuses `PageTopbar`/`AuthWidget`; the
page-specific styles live in `src/styles/vibeviewer.css`, scoped under
`.vv-page` (registered in `index.html`).

- **Components:** `src/routes/VibeViewer.tsx`. A centered hero (eyebrow,
  italic-accent headline, subline), then a "stage" that swaps between
  **idle** (drag-and-drop dropzone), **uploading** (progress bar), and
  **success** (the live-trace card). Below: a sign-in nudge, a trust row
  (no account / secrets redacted / delete anytime), and the
  "Three ways to get your transcript" section.
- **One dropzone, classified by extension.** A drop can carry the main
  transcript (`.jsonl`/`.json`/`.txt`) plus an optional subagents `.zip`. A
  `.txt` is converted client-side to a synthetic `.jsonl`
  (`terminalExportToJsonl`) with the raw `.txt` archived, reusing the existing
  terminal-export path.
- **Upload → success.** Calls `uploadTrace({ isPrivate: false })`. On success
  it stashes the `claim_token` in `localStorage` (`vibeshub.claim.<shortId>`),
  fetches the trace summary for the card metadata (title · N msgs · platform),
  and reveals the success card with the auto-prompted copy tooltip.
- **Copy hand-off.** The share row is hover-to-copy and auto-prompts
  ("Copy your link") the moment the trace is live; clicking copies
  `<origin>/t/<shortId>` and flips to "Copied!".
- **Claim.** If already signed in, "Claim to your profile" calls
  `claimTrace(shortId, token)` directly and flips to "On your profile". If
  anonymous, "Sign in to claim it" starts GitHub OAuth with
  `next=/vibeviewer?claim=<shortId>`; on return the page reads the stored
  token, calls the claim endpoint, and opens `/t/<shortId>`.

### The three acquisition methods (page copy)

1. **`/export` — Easiest.** Run `/export`, upload the `.txt`. Noted as a
   best-effort reconstruction (drops token counts, timings, thinking,
   subagents).
2. **Local session files — Richest.** The full `.jsonl` under
   `~/.claude/projects/`, with `ls -t` to find the newest session and a
   `zip -j … /subagents/*` to bundle subagents (the Copy button carries the
   full robust command; the displayed snippet is shortened so it wraps without
   horizontal scroll).
3. **vibeshub plugin — Recommended.** `/plugin marketplace add` +
   `/plugin install`, then `/share-trace`. Uses the `gh` identity so uploads
   land on the profile automatically.

## Testing

- **Backend** (`webapp/backend/tests/`): anonymous upload → ownerless public +
  `claim_token`; two anonymous uploads stay distinct; anonymous ignores
  repo/PR association; signed-in upload still attributes (no token); the full
  claim matrix (happy → already_claimed, wrong token 403, anon 401, missing
  404); local `agent-<id>` subagent-zip naming accepted. 299 backend tests
  pass.
- **Frontend** (`src/tests/routes/VibeViewer.test.tsx`): idle render (dropzone
  + three methods), anonymous upload → success card + token stashed, copy to
  clipboard, signed-in claim from the card, non-transcript drop guidance.

## Out of scope / deferred

Rate limiting / CAPTCHA on the public endpoint; any change to the auto
`gh pr create` PR-comment hook; repo/PR linking and the privacy toggle on the
upload page (these move to the post-claim Edit UI on the trace view).
