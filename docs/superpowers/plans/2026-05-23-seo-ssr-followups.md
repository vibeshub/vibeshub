# SEO SSR Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend server-side `<head>` injection to repo, user, and PR-list pages, and make `SeoHead` strip stale SSR tags on mount so the live DOM never carries duplicates.

**Architecture:** Refactor `spa_seo.render_spa_html` to dispatch through an ordered list of `(path → optional replacement)` handlers; add three new handlers for the new URL shapes. On the frontend, add one `useEffect` to `SeoHead` that removes everything between the `<!--SEO_HEAD_START-->` / `<!--SEO_HEAD_END-->` markers on first mount.

**Tech Stack:** FastAPI + SQLAlchemy (async) on the backend, React 19 + Vitest + Testing Library on the frontend.

**Spec:** `docs/superpowers/specs/2026-05-23-seo-ssr-followups-design.md`

**Branch:** `seo-ssr-followups` (already created from `a7ef7ca`).

---

## File Structure

- `webapp/backend/app/api/spa_seo.py` — extend with reserved-owner guard, three new URL regexes, three `_lookup_*` + `_render_*_head` helpers, and a `(handler) -> str | None` dispatch loop.
- `webapp/backend/tests/test_spa_seo.py` — add ~10 tests for the three new routes plus a precedence test.
- `webapp/frontend/src/components/SeoHead.tsx` — add a single `useEffect` that strips the marker block on mount.
- `webapp/frontend/src/tests/components/SeoHead.test.tsx` — new file; jsdom tests for strip-on-mount behavior.

No DB schema, dependency, route table, or `index.html` change. The marker block already ships in `index.html` and the SPA catch-all already calls `render_spa_html`.

---

## Task 1: Refactor `render_spa_html` to a handler-list dispatcher (no behavior change)

**Files:**
- Modify: `webapp/backend/app/api/spa_seo.py`
- Test: `webapp/backend/tests/test_spa_seo.py` (existing suite — should remain green)

This is a pure refactor that prepares the file for three more URL shapes. Existing tests are the safety net.

- [ ] **Step 1: Run the existing SEO tests to confirm green baseline**

Run from `webapp/backend`:
```bash
pytest tests/test_spa_seo.py -v
```
Expected: all existing tests pass.

- [ ] **Step 2: Extract the trace branch into a handler function**

In `webapp/backend/app/api/spa_seo.py`, **above** the existing `render_spa_html`, add:

```python
async def _try_trace(
    path: str, session: AsyncSession, base_url: str
) -> str | None:
    """Render trace-specific <head> if `path` matches a trace URL.

    Returns None when the path isn't a trace URL, the trace isn't found,
    or the DB raises. Callers fall through to the unmodified template.
    """
    short_id = extract_trace_short_id(path)
    if short_id is None:
        return None
    try:
        trace = await _lookup_trace(session, short_id)
    except Exception:
        return None
    if trace is None:
        return None
    return _render_trace_head(trace, base_url)
```

- [ ] **Step 3: Add the dispatcher tuple and a splice helper, replace `render_spa_html` body**

Replace the existing `render_spa_html` function (the one that ends with the `template[:start] + ... + template[end:]` return) with:

```python
def _splice(template: str, replacement: str) -> str:
    """Replace the contents between SEO_HEAD_START/END with `replacement`."""
    start = template.index(SEO_START)
    end = template.index(SEO_END) + len(SEO_END)
    return (
        template[:start]
        + SEO_START
        + "\n    "
        + replacement
        + "\n    "
        + SEO_END
        + template[end:]
    )


# Ordered handlers: each returns a rendered <head> block or None. The
# first non-None wins. Order matters — longer/more-specific URL shapes
# must come before greedier ones. Today only _try_trace is registered;
# user/repo/PR-list handlers land in later tasks.
_HANDLERS = (_try_trace,)


async def render_spa_html(
    template: str,
    request_path: str,
    session: AsyncSession,
    base_url: str,
) -> str:
    """Return index.html, optionally with route-specific meta tags injected.

    Falls through to the unmodified template for:
      - templates without the SEO markers (older builds)
      - URLs no handler claims
      - missing/invalid IDs and DB errors (handlers swallow internally)
    """
    if SEO_START not in template or SEO_END not in template:
        return template
    for handler in _HANDLERS:
        replacement = await handler(request_path, session, base_url)
        if replacement is not None:
            return _splice(template, replacement)
    return template
```

- [ ] **Step 4: Run the existing SEO tests — must still be green**

Run from `webapp/backend`:
```bash
pytest tests/test_spa_seo.py -v
```
Expected: every existing test still passes. No new tests yet.

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/api/spa_seo.py
git commit -m "refactor: split spa_seo render into handler-list dispatcher

No behavior change. Sets up the file for additional URL-shape handlers."
```

---

## Task 2: Add reserved-owner guard

**Files:**
- Modify: `webapp/backend/app/api/spa_seo.py`

Tiny, self-contained — a frozenset and one helper. No consumers yet; Task 3 will use it. Splitting it out keeps the diff in Task 3 focused on the route logic.

- [ ] **Step 1: Add the reserved-slug set near the top-level constants**

In `webapp/backend/app/api/spa_seo.py`, just below the `SEO_END = "<!--SEO_HEAD_END-->"` line, add:

```python
# Top-level route slugs that look like `/<owner>` but aren't user pages.
# Kept here so adding a new top-level frontend route is one-line update.
_RESERVED_OWNERS = frozenset({
    "upload",
    "privacy",
    "home",
    "t",
    "api",
    "sitemap.xml",
    "robots.txt",
})
```

- [ ] **Step 2: Run the full backend suite to confirm nothing broke**

Run from `webapp/backend`:
```bash
pytest -q
```
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add webapp/backend/app/api/spa_seo.py
git commit -m "feat: add reserved-owner slug set for SPA SEO dispatch"
```

---

## Task 3: SSR meta for `/<owner>` (user page)

**Files:**
- Modify: `webapp/backend/app/api/spa_seo.py`
- Test: `webapp/backend/tests/test_spa_seo.py`

- [ ] **Step 1: Write the failing tests for the user route**

Append to `webapp/backend/tests/test_spa_seo.py` (after the existing trace tests):

```python
# ---------------------------------------------------------------------------
# User route: /<owner>
# ---------------------------------------------------------------------------

class TestUserRouteSeo:
    @pytest.mark.asyncio
    async def test_public_traces_inject_meta(self, spa_client):
        SessionLocal = spa_client.app.state.session_maker
        async with SessionLocal() as session:
            session.add(_make_trace(short_id=SHORT_OK, owner_login="alice"))
            session.add(_make_trace(short_id=SHORT_OK_2, owner_login="alice"))
            await session.commit()

        resp = spa_client.get("/alice")
        assert resp.status_code == 200
        body = resp.text

        assert "@alice · vibeshub" in body
        assert "2 public Claude Code sessions from @alice" in body
        assert 'href="https://vibeshub.test/alice"' in body
        assert 'property="og:type" content="profile"' in body
        # Default landing title is gone.
        assert "vibeshub · share Claude Code sessions" not in body

    def test_zero_public_traces_falls_through(self, spa_client):
        # No traces seeded → count is 0 → template unchanged.
        resp = spa_client.get("/ghost")
        assert resp.status_code == 200
        assert "vibeshub · share Claude Code sessions" in resp.text

    @pytest.mark.asyncio
    async def test_private_only_owner_falls_through(self, spa_client):
        SessionLocal = spa_client.app.state.session_maker
        async with SessionLocal() as session:
            session.add(_make_trace(
                short_id=SHORT_OK, owner_login="bob", is_private=True,
            ))
            await session.commit()

        resp = spa_client.get("/bob")
        # Public count is 0 → fall through.
        assert "vibeshub · share Claude Code sessions" in resp.text

    @pytest.mark.parametrize(
        "slug", ["upload", "privacy", "home", "t", "api", "robots.txt"],
    )
    def test_reserved_owner_slugs_fall_through(self, spa_client, slug):
        resp = spa_client.get(f"/{slug}")
        assert resp.status_code == 200
        assert "vibeshub · share Claude Code sessions" in resp.text
```

- [ ] **Step 2: Run the new tests to confirm they fail**

Run from `webapp/backend`:
```bash
pytest tests/test_spa_seo.py::TestUserRouteSeo -v
```
Expected: all four tests fail (the user route doesn't exist yet, so they emit the default template — the assertions that look for `@alice · vibeshub` fail; the reserved/fall-through assertions may pass coincidentally — that's fine, they pin behavior we want to keep).

- [ ] **Step 3: Implement the user-route regex, lookup, render, and registration**

In `webapp/backend/app/api/spa_seo.py`:

1. Add the regex near the existing trace regexes:

```python
_USER_RE = re.compile(r"^(?P<owner>[^/]+)$")
```

2. Add the lookup helper. Place it after `_lookup_trace`:

```python
async def _lookup_user_stats(
    session: AsyncSession, owner: str
) -> tuple[int, str] | None:
    """Return (public_trace_count, owner) for `owner`, or None if zero.

    The owner is returned as-is so the caller can use the canonical
    casing it was queried with (URLs are case-sensitive here).
    """
    from sqlalchemy import func

    result = await session.execute(
        select(func.count(Trace.id))
        .where(Trace.owner_login == owner)
        .where(Trace.is_private.is_(False))
        .where(Trace.deleted_at.is_(None))
    )
    count = result.scalar_one()
    if count == 0:
        return None
    return count, owner
```

3. Add the render helper. Place it after `_render_trace_head`:

```python
def _render_user_head(owner: str, count: int, base_url: str) -> str:
    base = base_url.rstrip("/")
    title = f"@{owner} · vibeshub"
    description = (
        f"{count} public Claude Code session"
        f"{'' if count == 1 else 's'} from @{owner}."
    )
    canonical = f"{base}/{owner}"
    image = f"{base}/og-default.png"

    t = html_escape(title)
    d = html_escape(description, quote=True)
    c = html_escape(canonical, quote=True)
    i = html_escape(image, quote=True)

    return (
        f"<title>{t}</title>\n"
        f'    <meta name="description" content="{d}" />\n'
        f'    <link rel="canonical" href="{c}" />\n'
        '    <meta property="og:site_name" content="vibeshub" />\n'
        '    <meta property="og:type" content="profile" />\n'
        f'    <meta property="og:title" content="{t}" />\n'
        f'    <meta property="og:description" content="{d}" />\n'
        f'    <meta property="og:url" content="{c}" />\n'
        f'    <meta property="og:image" content="{i}" />\n'
        '    <meta name="twitter:card" content="summary_large_image" />\n'
        f'    <meta name="twitter:title" content="{t}" />\n'
        f'    <meta name="twitter:description" content="{d}" />\n'
        f'    <meta name="twitter:image" content="{i}" />'
    )
```

4. Add the handler. Place it after `_try_trace`:

```python
async def _try_user(
    path: str, session: AsyncSession, base_url: str
) -> str | None:
    m = _USER_RE.match(path)
    if m is None:
        return None
    owner = m.group("owner")
    if not owner or owner in _RESERVED_OWNERS:
        return None
    try:
        stats = await _lookup_user_stats(session, owner)
    except Exception:
        return None
    if stats is None:
        return None
    count, owner_out = stats
    return _render_user_head(owner_out, count, base_url)
```

5. Register the handler in `_HANDLERS`. Update the tuple to:

```python
_HANDLERS = (_try_trace, _try_user)
```

- [ ] **Step 4: Run the user-route tests to confirm they pass**

Run from `webapp/backend`:
```bash
pytest tests/test_spa_seo.py::TestUserRouteSeo -v
```
Expected: all four tests pass.

- [ ] **Step 5: Run the full SEO suite to confirm trace tests are still green**

Run from `webapp/backend`:
```bash
pytest tests/test_spa_seo.py -v
```
Expected: all tests pass (existing trace tests + new user tests).

- [ ] **Step 6: Commit**

```bash
git add webapp/backend/app/api/spa_seo.py webapp/backend/tests/test_spa_seo.py
git commit -m "feat: SSR meta for /<owner> user pages

One indexed count query per request. Falls through when the user has no
public traces or when the slug is a reserved top-level route."
```

---

## Task 4: SSR meta for `/<owner>/<repo>` (repo page)

**Files:**
- Modify: `webapp/backend/app/api/spa_seo.py`
- Test: `webapp/backend/tests/test_spa_seo.py`

- [ ] **Step 1: Write the failing tests for the repo route**

Append to `webapp/backend/tests/test_spa_seo.py`:

```python
# ---------------------------------------------------------------------------
# Repo route: /<owner>/<repo>
# ---------------------------------------------------------------------------

class TestRepoRouteSeo:
    @pytest.mark.asyncio
    async def test_public_traces_inject_meta(self, spa_client):
        SessionLocal = spa_client.app.state.session_maker
        async with SessionLocal() as session:
            session.add(_make_trace(
                short_id=SHORT_OK,
                owner_login="alice",
                repo_full_name="alice/widget",
                pr_number=7,
            ))
            session.add(_make_trace(
                short_id=SHORT_OK_2,
                owner_login="bob",
                repo_full_name="alice/widget",
                pr_number=8,
            ))
            await session.commit()

        resp = spa_client.get("/alice/widget")
        assert resp.status_code == 200
        body = resp.text

        assert "alice/widget · Claude Code traces · vibeshub" in body
        assert "2 Claude Code sessions on alice/widget" in body
        assert 'href="https://vibeshub.test/alice/widget"' in body
        assert 'property="og:type" content="website"' in body
        assert "vibeshub · share Claude Code sessions" not in body

    def test_unknown_repo_falls_through(self, spa_client):
        resp = spa_client.get("/nobody/nope")
        assert resp.status_code == 200
        assert "vibeshub · share Claude Code sessions" in resp.text

    @pytest.mark.asyncio
    async def test_private_only_repo_falls_through(self, spa_client):
        SessionLocal = spa_client.app.state.session_maker
        async with SessionLocal() as session:
            session.add(_make_trace(
                short_id=SHORT_OK,
                owner_login="alice",
                repo_full_name="alice/secret",
                pr_number=1,
                is_private=True,
            ))
            await session.commit()

        resp = spa_client.get("/alice/secret")
        assert "vibeshub · share Claude Code sessions" in resp.text
```

- [ ] **Step 2: Run the new tests to confirm they fail**

Run from `webapp/backend`:
```bash
pytest tests/test_spa_seo.py::TestRepoRouteSeo -v
```
Expected: `test_public_traces_inject_meta` fails (route not implemented). The two fall-through tests may pass coincidentally — that's fine.

- [ ] **Step 3: Implement the repo-route regex, lookup, render, and registration**

In `webapp/backend/app/api/spa_seo.py`:

1. Add the regex near the others:

```python
_REPO_RE = re.compile(r"^(?P<owner>[^/]+)/(?P<repo>[^/]+)$")
```

2. Add the lookup helper after `_lookup_user_stats`:

```python
async def _lookup_repo_stats(
    session: AsyncSession, repo_full_name: str
) -> int | None:
    """Return public trace count for `repo_full_name`, or None if zero."""
    from sqlalchemy import func

    result = await session.execute(
        select(func.count(Trace.id))
        .where(Trace.repo_full_name == repo_full_name)
        .where(Trace.is_private.is_(False))
        .where(Trace.deleted_at.is_(None))
    )
    count = result.scalar_one()
    if count == 0:
        return None
    return count
```

3. Add the render helper after `_render_user_head`:

```python
def _render_repo_head(
    repo_full_name: str, count: int, base_url: str
) -> str:
    base = base_url.rstrip("/")
    title = f"{repo_full_name} · Claude Code traces · vibeshub"
    description = (
        f"{count} Claude Code session"
        f"{'' if count == 1 else 's'} on {repo_full_name}."
    )
    canonical = f"{base}/{repo_full_name}"
    image = f"{base}/og-default.png"

    t = html_escape(title)
    d = html_escape(description, quote=True)
    c = html_escape(canonical, quote=True)
    i = html_escape(image, quote=True)

    return (
        f"<title>{t}</title>\n"
        f'    <meta name="description" content="{d}" />\n'
        f'    <link rel="canonical" href="{c}" />\n'
        '    <meta property="og:site_name" content="vibeshub" />\n'
        '    <meta property="og:type" content="website" />\n'
        f'    <meta property="og:title" content="{t}" />\n'
        f'    <meta property="og:description" content="{d}" />\n'
        f'    <meta property="og:url" content="{c}" />\n'
        f'    <meta property="og:image" content="{i}" />\n'
        '    <meta name="twitter:card" content="summary_large_image" />\n'
        f'    <meta name="twitter:title" content="{t}" />\n'
        f'    <meta name="twitter:description" content="{d}" />\n'
        f'    <meta name="twitter:image" content="{i}" />'
    )
```

4. Add the handler after `_try_user`:

```python
async def _try_repo(
    path: str, session: AsyncSession, base_url: str
) -> str | None:
    m = _REPO_RE.match(path)
    if m is None:
        return None
    owner = m.group("owner")
    repo = m.group("repo")
    if not owner or not repo or owner in _RESERVED_OWNERS:
        return None
    try:
        count = await _lookup_repo_stats(session, f"{owner}/{repo}")
    except Exception:
        return None
    if count is None:
        return None
    return _render_repo_head(f"{owner}/{repo}", count, base_url)
```

5. Update `_HANDLERS`. **Repo must come before user** so the dispatcher matches `/alice/widget` as a repo, not as `/alice` somehow (it can't, but ordering by specificity is the discipline). Update to:

```python
_HANDLERS = (_try_trace, _try_repo, _try_user)
```

- [ ] **Step 4: Run the repo-route tests to confirm they pass**

Run from `webapp/backend`:
```bash
pytest tests/test_spa_seo.py::TestRepoRouteSeo -v
```
Expected: all three tests pass.

- [ ] **Step 5: Run the full SEO suite**

Run from `webapp/backend`:
```bash
pytest tests/test_spa_seo.py -v
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add webapp/backend/app/api/spa_seo.py webapp/backend/tests/test_spa_seo.py
git commit -m "feat: SSR meta for /<owner>/<repo> repo pages

One indexed count query per request. Falls through when the repo has no
public traces."
```

---

## Task 5: SSR meta for `/<owner>/<repo>/pull/<n>` (PR-list page)

**Files:**
- Modify: `webapp/backend/app/api/spa_seo.py`
- Test: `webapp/backend/tests/test_spa_seo.py`

- [ ] **Step 1: Write the failing tests for the PR-list route**

Append to `webapp/backend/tests/test_spa_seo.py`:

```python
# ---------------------------------------------------------------------------
# PR-list route: /<owner>/<repo>/pull/<n>
# ---------------------------------------------------------------------------

class TestPrListRouteSeo:
    @pytest.mark.asyncio
    async def test_public_traces_with_pr_title(self, spa_client):
        SessionLocal = spa_client.app.state.session_maker
        async with SessionLocal() as session:
            session.add(_make_trace(
                short_id=SHORT_OK,
                owner_login="alice",
                repo_full_name="alice/widget",
                pr_number=7,
                pr_title="Tighten landing copy",
            ))
            session.add(_make_trace(
                short_id=SHORT_OK_2,
                owner_login="bob",
                repo_full_name="alice/widget",
                pr_number=7,
                pr_title="Tighten landing copy",
            ))
            await session.commit()

        resp = spa_client.get("/alice/widget/pull/7")
        assert resp.status_code == 200
        body = resp.text

        assert "alice/widget#7 · Tighten landing copy · vibeshub" in body
        assert "2 Claude Code sessions for alice/widget#7" in body
        assert 'href="https://vibeshub.test/alice/widget/pull/7"' in body

    @pytest.mark.asyncio
    async def test_public_traces_without_pr_title_falls_back(self, spa_client):
        SessionLocal = spa_client.app.state.session_maker
        async with SessionLocal() as session:
            session.add(_make_trace(
                short_id=SHORT_OK,
                owner_login="alice",
                repo_full_name="alice/widget",
                pr_number=9,
                pr_title=None,
            ))
            await session.commit()

        resp = spa_client.get("/alice/widget/pull/9")
        body = resp.text
        assert "alice/widget#9 · PR #9 · vibeshub" in body

    @pytest.mark.asyncio
    async def test_private_only_pr_falls_through(self, spa_client):
        SessionLocal = spa_client.app.state.session_maker
        async with SessionLocal() as session:
            session.add(_make_trace(
                short_id=SHORT_OK,
                owner_login="alice",
                repo_full_name="alice/widget",
                pr_number=11,
                pr_title="Secret",
                is_private=True,
            ))
            await session.commit()

        resp = spa_client.get("/alice/widget/pull/11")
        assert "vibeshub · share Claude Code sessions" in resp.text


# ---------------------------------------------------------------------------
# Precedence
# ---------------------------------------------------------------------------

class TestSeoHandlerPrecedence:
    @pytest.mark.asyncio
    async def test_trace_url_is_handled_by_trace_path_not_pr_list(
        self, spa_client,
    ):
        # /alice/widget/pull/7/<short> matches the trace shape AND would
        # NOT match the PR-list regex (it has trailing /<short>), but
        # this test pins the contract that trace handling takes
        # precedence over any future shorter handler.
        SessionLocal = spa_client.app.state.session_maker
        async with SessionLocal() as session:
            session.add(_make_trace(
                short_id=SHORT_OK,
                owner_login="alice",
                repo_full_name="alice/widget",
                pr_number=7,
                pr_title="A trace title",
            ))
            await session.commit()

        resp = spa_client.get(f"/alice/widget/pull/7/{SHORT_OK}")
        body = resp.text
        # Trace render is used — uses "Claude Code session by @alice".
        assert "Claude Code session by @alice" in body
        # PR-list render would say "Claude Code sessions for alice/widget#7".
        assert "Claude Code sessions for alice/widget#7" not in body
```

- [ ] **Step 2: Run the new tests to confirm they fail**

Run from `webapp/backend`:
```bash
pytest tests/test_spa_seo.py::TestPrListRouteSeo tests/test_spa_seo.py::TestSeoHandlerPrecedence -v
```
Expected: PR-list tests fail (route not implemented). Precedence test passes (trace handler is already first).

- [ ] **Step 3: Implement the PR-list regex, lookup, render, and registration**

In `webapp/backend/app/api/spa_seo.py`:

1. Add the regex:

```python
_PR_RE = re.compile(
    r"^(?P<owner>[^/]+)/(?P<repo>[^/]+)/pull/(?P<n>\d+)$"
)
```

2. Add the lookup helper after `_lookup_repo_stats`:

```python
async def _lookup_pr_stats(
    session: AsyncSession,
    repo_full_name: str,
    pr_number: int,
) -> tuple[int, str | None] | None:
    """Return (count, pr_title) for the public traces on (repo, PR).

    pr_title is whichever non-null value comes first; if all rows have
    null titles the second element is None. Returns None when count is 0.
    """
    from sqlalchemy import func

    result = await session.execute(
        select(func.count(Trace.id), func.max(Trace.pr_title))
        .where(Trace.repo_full_name == repo_full_name)
        .where(Trace.pr_number == pr_number)
        .where(Trace.is_private.is_(False))
        .where(Trace.deleted_at.is_(None))
    )
    row = result.one()
    count, pr_title = row[0], row[1]
    if count == 0:
        return None
    return count, pr_title
```

3. Add the render helper after `_render_repo_head`:

```python
def _render_pr_head(
    repo_full_name: str,
    pr_number: int,
    pr_title: str | None,
    count: int,
    base_url: str,
) -> str:
    base = base_url.rstrip("/")
    subject = pr_title if pr_title else f"PR #{pr_number}"
    title = f"{repo_full_name}#{pr_number} · {subject} · vibeshub"
    description = (
        f"{count} Claude Code session"
        f"{'' if count == 1 else 's'} for {repo_full_name}#{pr_number}."
    )
    canonical = f"{base}/{repo_full_name}/pull/{pr_number}"
    image = f"{base}/og-default.png"

    t = html_escape(title)
    d = html_escape(description, quote=True)
    c = html_escape(canonical, quote=True)
    i = html_escape(image, quote=True)

    return (
        f"<title>{t}</title>\n"
        f'    <meta name="description" content="{d}" />\n'
        f'    <link rel="canonical" href="{c}" />\n'
        '    <meta property="og:site_name" content="vibeshub" />\n'
        '    <meta property="og:type" content="website" />\n'
        f'    <meta property="og:title" content="{t}" />\n'
        f'    <meta property="og:description" content="{d}" />\n'
        f'    <meta property="og:url" content="{c}" />\n'
        f'    <meta property="og:image" content="{i}" />\n'
        '    <meta name="twitter:card" content="summary_large_image" />\n'
        f'    <meta name="twitter:title" content="{t}" />\n'
        f'    <meta name="twitter:description" content="{d}" />\n'
        f'    <meta name="twitter:image" content="{i}" />'
    )
```

4. Add the handler after `_try_repo`:

```python
async def _try_pr_list(
    path: str, session: AsyncSession, base_url: str
) -> str | None:
    m = _PR_RE.match(path)
    if m is None:
        return None
    owner = m.group("owner")
    repo = m.group("repo")
    if not owner or not repo or owner in _RESERVED_OWNERS:
        return None
    try:
        n = int(m.group("n"))
    except ValueError:
        return None
    try:
        stats = await _lookup_pr_stats(session, f"{owner}/{repo}", n)
    except Exception:
        return None
    if stats is None:
        return None
    count, pr_title = stats
    return _render_pr_head(
        f"{owner}/{repo}", n, pr_title, count, base_url,
    )
```

5. Update `_HANDLERS`. **PR-list must come before repo** (it's more specific) and both must come before user. Final order:

```python
_HANDLERS = (_try_trace, _try_pr_list, _try_repo, _try_user)
```

- [ ] **Step 4: Run the PR-list and precedence tests**

Run from `webapp/backend`:
```bash
pytest tests/test_spa_seo.py::TestPrListRouteSeo tests/test_spa_seo.py::TestSeoHandlerPrecedence -v
```
Expected: all four tests pass.

- [ ] **Step 5: Run the full backend suite**

Run from `webapp/backend`:
```bash
pytest -q
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add webapp/backend/app/api/spa_seo.py webapp/backend/tests/test_spa_seo.py
git commit -m "feat: SSR meta for /<owner>/<repo>/pull/<n> PR-list pages

One indexed count query per request. Uses pr_title when present, falls
back to 'PR #<n>'."
```

---

## Task 6: Strip-on-mount in `SeoHead`

**Files:**
- Modify: `webapp/frontend/src/components/SeoHead.tsx`
- Create: `webapp/frontend/src/tests/components/SeoHead.test.tsx`

- [ ] **Step 1: Write the failing tests for SeoHead strip-on-mount**

Create `webapp/frontend/src/tests/components/SeoHead.test.tsx`:

```tsx
import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { SeoHead } from "../../components/SeoHead";

afterEach(() => {
  cleanup();
  // Wipe head between tests so leftover tags don't bleed across cases.
  document.head.innerHTML = "";
});

function seedHeadWithMarkers(staleInner: string) {
  document.head.innerHTML = `
    <meta charset="UTF-8" />
    <!--SEO_HEAD_START-->
    ${staleInner}
    <!--SEO_HEAD_END-->
  `;
}

function tagsBetweenMarkers(): Element[] {
  const walker = document.createNodeIterator(
    document.head,
    NodeFilter.SHOW_COMMENT,
  );
  let start: Comment | null = null;
  let end: Comment | null = null;
  let n: Node | null = walker.nextNode();
  while (n) {
    const c = n as Comment;
    if (c.data === "SEO_HEAD_START") start = c;
    else if (c.data === "SEO_HEAD_END") {
      end = c;
      break;
    }
    n = walker.nextNode();
  }
  if (!start || !end) return [];
  const out: Element[] = [];
  for (let s = start.nextSibling; s && s !== end; s = s.nextSibling) {
    if (s.nodeType === Node.ELEMENT_NODE) out.push(s as Element);
  }
  return out;
}

describe("SeoHead", () => {
  it("removes stale SSR tags between the SEO marker comments on mount", () => {
    seedHeadWithMarkers(
      `<title>stale title</title>
       <meta name="description" content="stale description" />`,
    );

    render(<SeoHead title="Fresh" description="Fresh description" />);

    const between = tagsBetweenMarkers();
    // Whatever is between the markers must be only what React rendered.
    // We don't assert React placed tags between the markers — React 19
    // hoists to <head> in document order — but the stale ones must be gone.
    const stale = between.filter(
      (el) =>
        (el.tagName === "TITLE" && el.textContent === "stale title") ||
        (el.tagName === "META" &&
          el.getAttribute("content") === "stale description"),
    );
    expect(stale).toEqual([]);
  });

  it("no-ops when the head has no SEO marker comments", () => {
    document.head.innerHTML = `<meta charset="UTF-8" />`;
    // Should not throw.
    render(<SeoHead title="A" description="B" />);
    // <head> still has the charset meta.
    expect(document.head.querySelector('meta[charset="UTF-8"]'))
      .not.toBeNull();
  });

  it("is idempotent across mount / unmount / remount", () => {
    seedHeadWithMarkers(`<title>stale</title>`);
    const { unmount } = render(
      <SeoHead title="One" description="d" />,
    );
    unmount();
    // Second mount: nothing left to strip; should still not throw.
    render(<SeoHead title="Two" description="d" />);
    const stale = tagsBetweenMarkers().filter(
      (el) => el.tagName === "TITLE" && el.textContent === "stale",
    );
    expect(stale).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run from `webapp/frontend`:
```bash
npm test -- src/tests/components/SeoHead.test.tsx
```
Expected: the "removes stale SSR tags" test fails (current `SeoHead` doesn't strip the marker block). The other two may pass — that pins behavior we want to preserve.

- [ ] **Step 3: Add the strip-on-mount useEffect to SeoHead**

In `webapp/frontend/src/components/SeoHead.tsx`:

1. Update the top-of-file imports — `useEffect` from React:

```tsx
import { useEffect } from "react";
```

2. Inside `SeoHead` (just above the `return`), add:

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
    else if (node.data === "SEO_HEAD_END") {
      end = node;
      break;
    }
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

- [ ] **Step 4: Run the SeoHead tests to confirm they pass**

Run from `webapp/frontend`:
```bash
npm test -- src/tests/components/SeoHead.test.tsx
```
Expected: all three tests pass.

- [ ] **Step 5: Run the full frontend suite and typecheck**

Run from `webapp/frontend`:
```bash
npm test && npx tsc -b
```
Expected: all tests pass, typecheck is clean.

- [ ] **Step 6: Commit**

```bash
git add webapp/frontend/src/components/SeoHead.tsx \
        webapp/frontend/src/tests/components/SeoHead.test.tsx
git commit -m "feat: SeoHead strips SSR marker block on mount

React 19 hoists tags into <head> but never removes the static SSR-injected
tags that sit there from index.html. SeoHead now walks the marker pair
on first mount and clears the range, so the live DOM is left with only
React-rendered head tags. Works the same on SSR and non-SSR routes."
```

---

## Task 7: End-to-end verification and PR

**Files:** none — verification and handoff.

- [ ] **Step 1: Run the full backend suite from scratch**

Run from `webapp/backend`:
```bash
pytest -q
```
Expected: all tests pass.

- [ ] **Step 2: Run the full frontend suite + typecheck + build**

Run from `webapp/frontend`:
```bash
npm test && npx tsc -b && npm run build
```
Expected: tests pass, typecheck clean, build succeeds.

- [ ] **Step 3: Manual smoke test of the new SSR routes**

Start the backend with the built frontend pointed at it (use whatever local-dev command the project uses; commonly `uvicorn app.main:app` after `npm run build` in the frontend, depending on how `frontend_dist` is wired). Then with `curl`:

```bash
curl -s http://localhost:8000/alice | grep -E '<title>|og:type|description"'
curl -s http://localhost:8000/alice/widget | grep -E '<title>|og:type|description"'
curl -s http://localhost:8000/alice/widget/pull/7 | grep -E '<title>|og:type|description"'
curl -s http://localhost:8000/upload | grep -E '<title>'
```

Expected:
- `/alice` → `@alice · vibeshub`, `og:type content="profile"`, count in description.
- `/alice/widget` → `alice/widget · Claude Code traces · vibeshub`, `og:type content="website"`.
- `/alice/widget/pull/7` → `alice/widget#7 · <pr_title> · vibeshub`.
- `/upload` → default landing title (reserved-owner guard).

If `alice` doesn't exist locally, substitute any owner with at least one public trace, or skip this step and rely on post-deploy verification.

- [ ] **Step 4: Manual smoke test of the strip-on-mount fix**

With the dev server running, open `http://localhost:5173/t/<a public short_id>` in a browser. In DevTools:

```javascript
document.querySelectorAll('head title').length
document.querySelectorAll('head meta[property="og:title"]').length
```

Expected: each returns `1`. Repeat on `/`, `/privacy`, `/<owner>` — same result on each.

- [ ] **Step 5: Push the branch and open the PR**

```bash
git push -u origin seo-ssr-followups
gh pr create --title "SEO SSR follow-ups: repo/user/PR-list meta + dedupe tags" --body "$(cat <<'EOF'
## Summary

Two of the three follow-ups from #73:

- **Server-side meta on `/<owner>`, `/<owner>/<repo>`, and `/<owner>/<repo>/pull/<n>`.** One indexed count query per matching request; falls through to the default landing meta when the entity has no public traces. Reserved top-level slugs (`/upload`, `/privacy`, `/home`, `/t`, `/api`, `/sitemap.xml`, `/robots.txt`) are guarded so the greedy `/<owner>` regex doesn't claim them.
- **`SeoHead` strips the SSR marker block on mount.** React 19 hoists tags into `<head>` but never removes the static tags shipped in `index.html`. A one-`useEffect` strip leaves the live DOM with only React-rendered head tags. Works the same on SSR-served and non-SSR routes.

Per-trace OG image generation is still out of scope.

Spec: `docs/superpowers/specs/2026-05-23-seo-ssr-followups-design.md`
Plan: `docs/superpowers/plans/2026-05-23-seo-ssr-followups.md`

## Test plan

- [ ] Backend: `pytest -q` clean.
- [ ] Frontend: `npm test` clean, `tsc -b` clean, `vite build` clean.
- [ ] After deploy: paste `https://vibeshub.ai/<owner>` and `https://vibeshub.ai/<owner>/<repo>` into Slack — preview shows entity-specific title.
- [ ] In a browser, inspect `<head>` on a trace page — exactly one `<title>`, no duplicate `og:*` tags.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Risk and rollback

- All new SSR queries are wrapped in `try/except → None` and the dispatcher falls through to the unmodified template on any failure. A DB hiccup never breaks the page.
- The strip-on-mount runs once per `SeoHead`. If the markers are missing (older build), it no-ops.
- Indexes used (`traces.owner_login`, `traces.repo_full_name`, `traces.pr_number`) all exist as single-column indexes (`webapp/backend/app/storage/models.py`). The queries use them via the leading column; the additional `is_private` and `deleted_at` predicates filter in-memory after the index seek, which is fine for current row counts. Compound indexes can be added later if these queries become hot.
- Rollback: revert this PR; the SPA falls back to the previous SSR behavior (trace URLs only) and `SeoHead` reverts to the duplicate-tag behavior. No data shape changes.
