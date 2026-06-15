# Trace social card + Share to X — design

**Date:** 2026-06-14
**Status:** approved, ready for implementation plan

## Goal

Make every shared public trace its own distribution channel. Today a pasted
trace link unfurls on X/Slack/Discord/LinkedIn with a correct dynamic title and
description (`spa_seo.py`) but a single static image (`og-default.png`), so every
shared trace looks identical. This is the biggest leak in the solo-first viral
loop: the shared link *is* the ad, and the image is the ad's most attention-
grabbing element.

Two deliverables:

1. A **dynamic per-trace social card** (Open Graph / Twitter image) rendered from
   the trace's own digest data.
2. A **one-click "Share to X"** affordance on the public trace viewer.

Out of scope for now (explicitly deferred): copy-link button, native mobile
`navigator.share`, share buttons for other networks, embeddable badges.

## Data (already available on `Trace`)

- `digest_json` -> `Digest`: `ask` (<=200), `decisions` (<=200), `dead_ends`
  (<=200). Em-dashes already stripped at the digest layer (`strip_em_dashes`).
- `pr_title`, `repo_full_name`, `pr_number`, `owner_login`, `platform`,
  `message_count`, `agent_count`.
- Subject derivation mirrors `spa_seo._render_trace_head`: `pr_title` ->
  `repo_full_name #pr_number` -> `Trace <short_id>`.
- Agent label mirrors `spa_seo._agent_label`: Claude Code / Codex CLI / Cursor.

Traces with no `digest_json` still get a card: subject + stat strip + brand,
no digest rows. Private traces (`is_private`) get **no** card (preserves the
existing no-leak / noindex guarantee).

## Card layout (1200x630 PNG, site dark theme)

```
+--------------------------------------------------------------+
|  v vibeshub        * claude code              acme/site #482  |
|                                                               |
|  Fix navbar overflow on mobile                                |
|                                                               |
|  ASK            Stop the navbar overflowing on small screens  |
|  KEY DECISIONS  Switched to flex-wrap, dropped fixed widths   |
|  DEAD ENDS      Tried overflow-x first, broke the sticky head |
|                                                               |
|  -----------------------------------------------------------  |
|  257 messages   *   4 subagents                     @bhavya   |
|                                              vibeshub.ai       |
+--------------------------------------------------------------+
```

- Background `#0f1411`; green accent (`.grn`) on the brand mark and platform dot.
- Title: up to 2 wrapped lines, ellipsized after.
- Digest rows: labels `ASK` / `KEY DECISIONS` / `DEAD ENDS` (matches the PR-card
  copy). Each value wrapped to one line, ellipsized. Rows with empty values are
  omitted.
- Stat strip: `message_count` messages and subagent count (`agent_count`). Omit
  a stat when zero. (No first-class file-edit count exists on `Trace`;
  `digest.files` is a narrative string, so it is not shown as a number.)
- Footer: `@owner_login` (if present) and `vibeshub.ai`.

## Architecture (backend)

Four small, independently testable units under `app/api/` (or `app/og/`):

1. **`og_card.py`** — pure `Trace -> CardData` dataclass assembly. No I/O.
   Handles subject/agent derivation, digest extraction, truncation inputs.
2. **`og_render.py`** — pure `CardData -> bytes` (PNG). Pillow + one bundled
   brand TTF. Fixed 1200x630. Deterministic.
3. **Cache** — store PNG in existing blob storage (`BlobStore.put/get`) at key
   `og/{short_id}-{hash}.png`. `hash` = short content hash over the card inputs
   (e.g. `digest_input_hash` + a `CARD_VERSION` constant). Lazy: generate on
   first request, reuse after. No explicit invalidation — when the digest
   changes the hash changes, so the `og:image` URL changes and scrapers refetch.
4. **Route** `GET /api/og/{short_id}.png` — returns `image/png` with long
   `Cache-Control` + `ETag`. Public traces only; private/missing -> 302 to
   `/og-default.png` (never 500, never leak). Registered before the SPA
   catch-all (under `/api`, so it already wins).

### Wiring into meta tags

`spa_seo._render_trace_head` (public branch only) sets `og:image` /
`twitter:image` to `{base}/api/og/{short_id}.png?v={hash}`. Requires extending
`_render_card_head` to accept a full image URL (today it only takes a filename
at site root). Private branch unchanged. Frontend `SeoHead` on the trace route
passes the same absolute `image` so client tags match the SSR contract.

## Frontend: Share to X

A subtle **Share** control in the trace `ViewerTopbar` (in-context, on-brand).
For now a single action: open
`https://twitter.com/intent/tweet?text=<text>&url=<trace_url>` in a new tab.

Prefilled text (em-dash-free), derived from subject + agent:

> Shipped "<subject>" with <agent>. Here's the whole session:

Hidden/disabled for private traces. No copy-link, no native share yet.

## Dependency / deploy

Add `pillow>=11` to backend `[project].dependencies`. Pure manylinux wheel — no
Dockerfile / apt changes. Bundle one TTF (brand sans) under the backend package
so rendering has no system-font dependency.

## Testing

Backend (`env/bin/pytest`):
- `og_card`: subject/agent derivation; digest present vs absent; stat omission;
  long-string inputs.
- `og_render`: returns non-empty PNG, correct dimensions (1200x630), renders
  with and without digest, with and without owner.
- route: public -> 200 `image/png`; second call served from cache (blob `get`
  hit, no re-render); private -> 302 default; unknown short_id -> 302 default.
- `spa_seo`: public trace head `og:image` points at `/api/og/<id>.png?v=`;
  private trace head still noindex with no image.

Frontend (`npm test`):
- Share button renders on a public trace; intent URL composes the expected
  text + encoded url; control absent/disabled for a private trace.

## Sequencing

Backend card data -> renderer -> cache+route -> spa_seo wiring -> frontend
share. Each step test-first, one at a time on this branch.
