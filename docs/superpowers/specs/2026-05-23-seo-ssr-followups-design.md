# SEO SSR follow-ups: extend server-side meta, dedupe client/server tags

## Background

PR #73 (`a7ef7ca`) landed server-side `<head>` injection for trace URLs only. Three follow-ups were called out in that PR's description:

1. React's client-side `SeoHead` re-emits the same tags after hydration, leaving duplicate `<title>` and `<meta>` nodes in the live DOM.
2. Repo, user, and PR-list pages still get only the default landing meta on first byte. Adding server-side variants requires a DB query those routes don't otherwise do.
3. All trace pages share `/og-default.png`; dynamic per-trace OG images would be the next jump.

This spec covers (1) and (2). Per-trace OG image generation is out of scope.

## Goals

- Repo, user, and PR-list pages emit page-specific `<title>`, `description`, `canonical`, OG, and Twitter tags on first byte so scrapers (Slack, X, LinkedIn, Discord) see useful link previews.
- The live DOM in browsers contains exactly one `<title>` and one of each `meta` after hydration on every route, regardless of whether the backend injected SSR tags.
- No new dependency, no schema change, no route-table change. One extra indexed DB query per matching HTML request to the three new URL shapes.

## Non-goals

- Per-trace OG images.
- Noindex on entities with zero public traces (we fall through to the default template instead).
- Caching the count queries (revisit only if traffic warrants it).

## Design

### Backend: extend `spa_seo.py` to handle three new URL shapes

The existing `render_spa_html` in `webapp/backend/app/api/spa_seo.py` recognises two trace URL shapes. Extend it with three more, dispatched in this order (longest path first):

1. `/<owner>/<repo>/pull/<n>/<short>` — trace, existing
2. `/t/<short>` — trace, existing
3. `/<owner>/<repo>/pull/<n>` — PR-list, new
4. `/<owner>/<repo>` — repo, new
5. `/<owner>` — user, new

Regexes:

```python
_USER_RE = re.compile(r"^(?P<owner>[^/]+)$")
_REPO_RE = re.compile(r"^(?P<owner>[^/]+)/(?P<repo>[^/]+)$")
_PR_RE   = re.compile(r"^(?P<owner>[^/]+)/(?P<repo>[^/]+)/pull/(?P<n>\d+)$")
```

#### Reserved-slug guard

The user regex would otherwise match `/upload`, `/privacy`, `/home`, `/t`, etc. Guard with a module-level set:

```python
_RESERVED_OWNERS = frozenset({
    "upload", "privacy", "home", "t",
    "api", "sitemap.xml", "robots.txt",
})
```

Any handler whose `owner` group falls in this set returns `None`, and `render_spa_html` falls through to the unmodified template. One place to update when new top-level routes are added.

#### Lookup + render per shape

Each new URL shape gets a `_lookup_*` (one async query) and `_render_*_head` (string formatter), mirroring the structure of `_lookup_trace` / `_render_trace_head`:

| Route | Query | Title | Description |
|---|---|---|---|
| `/<owner>` | `SELECT COUNT(*) AS n, MAX(created_at) AS last FROM traces WHERE owner_login=? AND is_private=false AND deleted_at IS NULL` | `@<owner> · vibeshub` | `<N> public Claude Code sessions from @<owner>.` |
| `/<owner>/<repo>` | same filter + `repo_full_name=?` | `<owner>/<repo> · Claude Code traces` | `<N> Claude Code sessions on <owner>/<repo>.` |
| `/<owner>/<repo>/pull/<n>` | same filter + `pr_number=?`, also `MAX(pr_title)` | If `pr_title` present: `<owner>/<repo>#<n> · <pr_title>`. Else: `<owner>/<repo>#<n> · PR #<n>`. | `<N> Claude Code sessions for <owner>/<repo>#<n>.` |

All values pass through `html_escape`. OG type is `profile` for user, `website` for repo and PR-list. OG image stays `/og-default.png`.

#### Fall-through rules

`_lookup_*` returns `None` (and the dispatcher leaves the template unchanged) when:

- The URL doesn't match the shape's regex.
- The `owner` group is in `_RESERVED_OWNERS`.
- The count query returns `0`.
- The DB raises (wrapped in `try/except → None`, matching the existing trace handler).

In all of these cases the user sees the same landing default that ships in `index.html` today. No noindex emission — the URL might be 404 from the React app but the SSR layer doesn't try to mirror that.

#### Indexes

Confirm these exist before merging (check via `\d+ traces` or migration files):

- `traces(owner_login, is_private, deleted_at)`
- `traces(repo_full_name, is_private, deleted_at)`
- `traces(repo_full_name, pr_number, is_private, deleted_at)`

If any are missing, surface as a blocker, not a follow-up — these queries run on every matching HTML request.

### Frontend: strip-on-mount in `SeoHead`

The duplication problem is that the SSR-injected tags in `index.html` are static HTML; React 19's head hoisting doesn't see them and renders fresh ones alongside. Fix it inside `SeoHead` with a single `useEffect` that, on first mount, finds the `<!--SEO_HEAD_START-->` / `<!--SEO_HEAD_END-->` comment markers in `document.head` and removes all nodes between them.

```tsx
useEffect(() => {
  if (typeof document === "undefined") return;
  const head = document.head;
  const walker = document.createNodeIterator(head, NodeFilter.SHOW_COMMENT);
  let start: Comment | null = null;
  let end: Comment | null = null;
  let node = walker.nextNode() as Comment | null;
  while (node) {
    if (node.data === "SEO_HEAD_START") start = node;
    else if (node.data === "SEO_HEAD_END") { end = node; break; }
    node = walker.nextNode() as Comment | null;
  }
  if (!start || !end) return;
  const toRemove: ChildNode[] = [];
  for (let n = start.nextSibling; n && n !== end; n = n.nextSibling) {
    toRemove.push(n);
  }
  for (const n of toRemove) n.remove();
}, []);
```

Behavior:

- Runs on every `SeoHead` mount. On the first mount the start/end markers stay, the contents go.
- Idempotent: subsequent mounts find an empty range and remove nothing.
- No SSR vs CSR branching. On trace pages it strips the server-injected trace tags before React paints over them; on landing/privacy/upload it strips the default block that ships with `index.html`. End-state DOM is identical to "no SSR ever happened" — only React-rendered tags survive.
- If the markers are missing (older builds), no-op.
- If a route forgets to render `SeoHead`, the default `index.html` tags survive. Same as today; no regression.

### Tests

#### Backend — extend `tests/test_spa_seo.py`

- User route: public traces present → swap, title contains `@<owner>`, description contains count.
- User route: zero public traces → template unchanged.
- User route: reserved owner (`upload`, `privacy`, `home`, `t`, `api`) → template unchanged.
- User route: weird/empty owner segment → template unchanged.
- Repo route: counts > 0 → swap.
- Repo route: unknown repo → template unchanged.
- Repo route: private-only repo (public count = 0) → template unchanged.
- PR-list route: counts > 0 with `pr_title` → title uses `pr_title`.
- PR-list route: counts > 0 without `pr_title` → title falls back to `PR #<n>`.
- PR-list route: private-only PR → template unchanged.
- Precedence: a URL that matches a trace pattern is handled by the trace path, not the shorter patterns.

#### Frontend — new `SeoHead.test.tsx`

- Renders inside a `<head>` containing the SSR marker block with stale `<title>` and `<meta>` → after mount, only the React-rendered tags remain between the markers.
- Renders inside a `<head>` with no markers → no-op, no throw.
- Mount, unmount, remount → strip is idempotent; no duplicates accrue.

#### Manual / post-deploy

- Paste `https://vibeshub.ai/<owner>/<repo>` into Slack — preview shows the repo-specific title, not the landing card.
- Paste `https://vibeshub.ai/<owner>/<repo>/pull/<n>` into Slack — preview shows the PR title.
- Paste `https://vibeshub.ai/<owner>` into Slack — preview shows `@<owner>`.
- Open a trace page in the browser, inspect `<head>` — exactly one `<title>`, no duplicate `og:*` tags.
- Open the landing page in the browser, inspect `<head>` — exactly one `<title>` and one of each meta.

## File-level scope

- `webapp/backend/app/api/spa_seo.py` — new regexes, reserved-slug set, three new `_lookup_*` / `_render_*_head` helpers, dispatch ladder in `render_spa_html`. ~150 lines added.
- `webapp/backend/tests/test_spa_seo.py` — ~10 new tests, ~200 lines.
- `webapp/frontend/src/components/SeoHead.tsx` — one `useEffect` block, ~25 lines added.
- `webapp/frontend/src/components/SeoHead.test.tsx` — new file, ~80 lines.

No DB schema, no new dependencies, no route-table changes, no `index.html` changes (the marker block is already there). The dispatch in `app/main.py` already calls `render_spa_html` — it just sees a wider set of matches.

## Risk

- One extra indexed query per *matching* HTML request to the three new URL shapes. Each query is by `(owner_login)`, `(repo_full_name)`, or `(repo_full_name, pr_number)` and must be indexed (see Indexes section above).
- All lookups are inside the existing `try/except → return template` envelope, so any DB hiccup degrades to current behavior, never breaks the page.
- The strip-on-mount runs once per `SeoHead`. If multiple `SeoHead`s ever mount in one tree (shouldn't happen, but possible with bad nesting), the second one no-ops on an empty range.
