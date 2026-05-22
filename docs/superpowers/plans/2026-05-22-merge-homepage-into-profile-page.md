# Merge Homepage Into Profile Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the signed-in workspace homepage the user's own profile page — `/home` redirects to `/{login}`, and the `Dashboard`'s worthwhile pieces are folded into `UserPage` before `Dashboard` is deleted.

**Architecture:** `Home.tsx` becomes a pure redirect. `UserPage.tsx` (the public profile at `/:owner`) gains: a merged vibeshub/GitHub stat strip, a GitHub contribution heatmap (shown on every profile), and owner-only affordances (personalized greeting, copy-link button, zero-trace onboarding card, capture-tip card, private-repo nudge) gated by an `isOwner` check against the authenticated user. Ported components live as local function components inside `UserPage.tsx`, matching how `Dashboard.tsx` and `UserPage`'s existing `RepoList` are structured. The shared stylesheet `Dashboard.module.css` is renamed to `UserPage.module.css`.

**Tech Stack:** React 19 + TypeScript, React Router, Vite, Vitest + Testing Library, CSS Modules.

**Reference spec:** `docs/superpowers/specs/2026-05-22-merge-homepage-into-profile-page-design.md`

**Working directory for all paths below:** `/Users/bhavya/git/vibeshub` (frontend root: `webapp/frontend`).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `webapp/frontend/src/routes/Home.tsx` | Modify | Redirect `/home` → `/{login}` (signed-in) or `/` (anonymous). |
| `webapp/frontend/src/routes/UserPage.tsx` | Modify | Profile page; gains merged stat strip, heatmap, owner affordances. Hosts ported components as local functions. |
| `webapp/frontend/src/routes/Dashboard.module.css` | Rename → `UserPage.module.css` | Stylesheet for ported pieces. |
| `webapp/frontend/src/routes/Dashboard.tsx` | Delete (final task) | Superseded by `UserPage`. |
| `webapp/frontend/src/tests/routes/Home.test.tsx` | Create | Redirect behavior. |
| `webapp/frontend/src/tests/routes/UserPage.test.tsx` | Create | Owner vs. visitor rendering. |

Ported code is copied verbatim from `Dashboard.tsx`, which stays in the repo and readable until the final task. Exact line ranges are given in each task.

---

## Task 1: Redirect `/home` to the profile page

**Files:**
- Modify: `webapp/frontend/src/routes/Home.tsx`
- Test: `webapp/frontend/src/tests/routes/Home.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `webapp/frontend/src/tests/routes/Home.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Home } from "../../routes/Home";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../../auth/AuthContext";

const mockUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/home"]}>
      <Routes>
        <Route path="/home" element={<Home />} />
        <Route path="/" element={<div>landing page</div>} />
        <Route path=":owner" element={<div>profile page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Home", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("redirects a signed-in user to their profile page", () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: {
        id: "u-1",
        login: "alice",
        name: "Alice",
        avatar_url: null,
        has_private_access: false,
      },
      refresh: vi.fn(),
      signOut: vi.fn(),
    });
    renderHome();
    expect(screen.getByText("profile page")).toBeInTheDocument();
  });

  it("redirects an anonymous visitor to the landing page", () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: null,
      refresh: vi.fn(),
      signOut: vi.fn(),
    });
    renderHome();
    expect(screen.getByText("landing page")).toBeInTheDocument();
  });

  it("renders an empty shell while the session is resolving", () => {
    mockUseAuth.mockReturnValue({
      loading: true,
      user: null,
      refresh: vi.fn(),
      signOut: vi.fn(),
    });
    const { container } = renderHome();
    expect(container.querySelector(".page-shell")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd webapp/frontend && npx vitest run src/tests/routes/Home.test.tsx`
Expected: the "signed-in user" test FAILS — current `Home` renders `<Dashboard>`, not the profile route, so "profile page" is not found.

- [ ] **Step 3: Rewrite `Home.tsx`**

Replace the entire contents of `webapp/frontend/src/routes/Home.tsx` with:

```tsx
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

/**
 * The "/home" route. A signed-in visitor is sent to their own profile
 * page, which doubles as their workspace. Anonymous visitors have no
 * profile, so they go back to the shared landing page at "/".
 *
 * While the session is still resolving we render an empty shell rather
 * than redirecting prematurely and bouncing a signed-in user away.
 */
export function Home() {
  const { loading, user } = useAuth();

  if (loading) {
    return <div className="page-shell" style={{ minHeight: "100vh" }} />;
  }

  return user ? (
    <Navigate to={`/${user.login}`} replace />
  ) : (
    <Navigate to="/" replace />
  );
}
```

This drops the `Dashboard` import — `Dashboard.tsx` now has no importers (verified in Task 8).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd webapp/frontend && npx vitest run src/tests/routes/Home.test.tsx`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/routes/Home.tsx webapp/frontend/src/tests/routes/Home.test.tsx
git commit -m "Redirect /home to the signed-in user's profile page"
```

---

## Task 2: Rename the stylesheet

`Dashboard.module.css` will be the profile page's stylesheet. Rename it now so later tasks import a stably-named file. `Dashboard.tsx` is updated to keep building until it is deleted in Task 8.

**Files:**
- Rename: `webapp/frontend/src/routes/Dashboard.module.css` → `webapp/frontend/src/routes/UserPage.module.css`
- Modify: `webapp/frontend/src/routes/Dashboard.tsx` (one import line)

- [ ] **Step 1: Rename the file via git**

```bash
git mv webapp/frontend/src/routes/Dashboard.module.css webapp/frontend/src/routes/UserPage.module.css
```

- [ ] **Step 2: Update the import in `Dashboard.tsx`**

In `webapp/frontend/src/routes/Dashboard.tsx`, change line 13:

```tsx
import styles from "./Dashboard.module.css";
```

to:

```tsx
import styles from "./UserPage.module.css";
```

- [ ] **Step 3: Verify the build still type-checks**

Run: `cd webapp/frontend && npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add webapp/frontend/src/routes/UserPage.module.css webapp/frontend/src/routes/Dashboard.tsx
git commit -m "Rename Dashboard.module.css to UserPage.module.css"
```

---

## Task 3: UserPage — auth wiring, owner detection, greeting line

Add the authenticated-user context, compute `isOwner`, and render a personalized greeting line above the `entity-head` for the owner.

**Files:**
- Modify: `webapp/frontend/src/routes/UserPage.tsx`

- [ ] **Step 1: Add imports**

In `webapp/frontend/src/routes/UserPage.tsx`, add to the import block at the top (after the existing `../components/TraceListRow` import on line 8):

```tsx
import { useAuth } from "../auth/AuthContext";
import styles from "./UserPage.module.css";
```

Do **not** add the heatmap-related imports here — `tsconfig.json` sets `noUnusedLocals: true`, so an import unused within a task breaks `tsc`. The `fetchGithubContributions` / `GithubContributions` / `GithubContributionDay` imports are added in Task 5, where they are consumed.

- [ ] **Step 2: Add the `greetingFor` helper**

Copy the `greetingFor` function from `Dashboard.tsx` lines 48-54 verbatim, placing it next to the other helpers in `UserPage.tsx` (after `relativeFrom`, before `type UserTab`):

```tsx
function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 5) return "Burning the midnight oil";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
```

- [ ] **Step 3: Compute `isOwner` and the first name inside the component**

In the `UserPage` function body, after the existing hooks and before `if (!owner) return null;` (currently line 59), add:

```tsx
  const { user } = useAuth();
  const isOwner =
    !!user && !!owner && user.login.toLowerCase() === owner.toLowerCase();
  const firstName = user
    ? (user.name?.trim().split(/\s+/)[0] || user.login).trim()
    : "";
```

- [ ] **Step 4: Render the owner greeting line**

In the returned JSX, inside `<main className="page">`, immediately before `<section className="entity-head">` (currently line 72), add:

```tsx
        {isOwner && (
          <div className={styles.greetingLine}>
            {greetingFor(new Date())}, <strong>{firstName}</strong>.
          </div>
        )}
```

- [ ] **Step 5: Add the `.greetingLine` style**

Append to `webapp/frontend/src/routes/UserPage.module.css`:

```css
/* ===================================================================
   OWNER GREETING — a single line above the entity-head, owner only
   ================================================================ */
.greetingLine {
  margin: 0 0 18px;
  font-size: 18px;
  line-height: 1.3;
  letter-spacing: -0.02em;
  color: var(--text-muted);
}
.greetingLine strong {
  color: var(--text-strong);
  font-weight: 600;
}
```

- [ ] **Step 6: Verify type-check passes**

Run: `cd webapp/frontend && npx tsc -b`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add webapp/frontend/src/routes/UserPage.tsx webapp/frontend/src/routes/UserPage.module.css
git commit -m "Add owner detection and personalized greeting to the profile page"
```

---

## Task 4: UserPage — merged stat strip

Replace the GitHub-derived stat strip (Public repos / Stars / Followers / Top languages) with a 4-cell strip: Traces / Repositories / Messages / Followers.

**Files:**
- Modify: `webapp/frontend/src/routes/UserPage.tsx`

- [ ] **Step 1: Replace the stat strip JSX**

In `webapp/frontend/src/routes/UserPage.tsx`, replace the entire `<div className="stat-strip">…</div>` block (currently lines 103-154 — the block that branches on `ghError || !ghUser` and renders Public repos / Stars / Followers / Top languages) with:

```tsx
        <div className="stat-strip">
          <div className="stat-cell">
            <div className="stat-label">Traces</div>
            <div className="stat-value">{data.stats.trace_count}</div>
            <div className="stat-sub">
              last upload {relativeFrom(data.stats.last_trace_at)}
            </div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Repositories</div>
            <div className="stat-value">{data.stats.repo_count}</div>
            <div className="stat-sub">with captured sessions</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Messages</div>
            <div className="stat-value">
              {compactCount(data.stats.message_count)}
            </div>
            <div className="stat-sub">across every session</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Followers</div>
            <div className="stat-value">
              {ghError || !ghUser ? "—" : compactCount(ghUser.followers)}
            </div>
            <div className="stat-sub">
              {ghError
                ? "GitHub stats unavailable"
                : !ghUser
                  ? "loading…"
                  : `following ${compactCount(ghUser.following)}`}
            </div>
          </div>
        </div>
```

`data` is guaranteed non-null here — the component already returns `<LoadingState>` earlier when `!data` (line 61). `compactCount` and `relativeFrom` already exist in `UserPage.tsx`. `ghUser`/`ghError` state and the `fetchGithubUser` effect already exist and are unchanged — only the Followers cell now depends on them.

- [ ] **Step 2: Verify type-check passes**

Run: `cd webapp/frontend && npx tsc -b`
Expected: no errors. The `compactCount` import for `GithubUser` type is still used by the `ghUser` state.

- [ ] **Step 3: Commit**

```bash
git add webapp/frontend/src/routes/UserPage.tsx
git commit -m "Replace the profile GitHub stat strip with a merged vibeshub strip"
```

---

## Task 5: UserPage — GitHub contribution heatmap

Port the contribution heatmap from `Dashboard.tsx` as a self-fetching local component and render it between the stat strip and the tabs.

**Files:**
- Modify: `webapp/frontend/src/routes/UserPage.tsx`

- [ ] **Step 1: Add the heatmap imports**

In `webapp/frontend/src/routes/UserPage.tsx`, extend the existing `../api` import (currently `import { fetchGithubUser, fetchUserOverview } from "../api";`) to:

```tsx
import {
  fetchGithubContributions,
  fetchGithubUser,
  fetchUserOverview,
} from "../api";
```

And extend the existing `../types` import (currently `import type { GithubUser, UserOverview, UserRepoEntry } from "../types";`) to:

```tsx
import type {
  GithubContributionDay,
  GithubContributions,
  GithubUser,
  UserOverview,
  UserRepoEntry,
} from "../types";
```

(These are consumed by the heatmap code added in the steps below within this same task, so `noUnusedLocals` stays satisfied.)

- [ ] **Step 2: Port the heatmap helpers and constants**

Copy verbatim from `Dashboard.tsx` into `UserPage.tsx` (place this block after the `greetingFor` helper, before `type UserTab`):

- Lines 62-102: the constants and interfaces (`WEEKS`, `WEEKDAY_LABELS`, `WEEKDAY_NAMES`, `MONTHS`, `interface HeatCell`, `interface HeatModel`).
- Lines 104-109: the `isoDay` function.
- Lines 111-176: the `buildHeatmap` function.

Copy these exactly as they appear in `Dashboard.tsx` — no changes.

- [ ] **Step 3: Port `Figure`, `ActivityLoading`, and `GithubActivitySection`**

Copy verbatim from `Dashboard.tsx` into `UserPage.tsx` (place after the `RepoList` function at the end of the file):

- Lines 495-516: the `Figure` component.
- Lines 476-493: the `ActivityLoading` component.
- Lines 354-474: the `GithubActivitySection` component.

These reference `styles.*` — which now resolves against the `UserPage.module.css` import added in Task 3 — and the `IconArrow` / `IconGithub` icons added in Step 4 below. `useMemo` is already imported in `UserPage.tsx` (line 1).

- [ ] **Step 4: Port the `IconArrow` and `IconGithub` icons**

Copy verbatim from `Dashboard.tsx` into `UserPage.tsx` (place at the end of the file, after the ported components):

- Lines 812-827: `IconArrow`.
- Lines 862-868: `IconGithub`.

- [ ] **Step 5: Add the self-fetching `GithubActivity` wrapper**

Add this new component to `UserPage.tsx` (place it just before `GithubActivitySection`):

```tsx
/**
 * Self-contained contribution heatmap: fetches GitHub's contribution
 * calendar for `login` and renders the heatmap card. Shown on every
 * profile — this is public GitHub data. While the fetch is in flight it
 * shows a loading placeholder; on error it renders nothing.
 */
function GithubActivity({ login }: { login: string }) {
  const [contrib, setContrib] = useState<GithubContributions | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    setContrib(null);
    fetchGithubContributions(login)
      .then(setContrib)
      .catch(() => setFailed(true));
  }, [login]);

  if (failed) return null;
  if (!contrib) return <ActivityLoading />;
  return <GithubActivitySection login={login} contrib={contrib} />;
}
```

`useState` and `useEffect` are already imported in `UserPage.tsx` (line 1).

- [ ] **Step 6: Render the heatmap in the page**

In the returned JSX of `UserPage`, between the `<div className="stat-strip">…</div>` block and the `<div className="tabs">…</div>` block, add:

```tsx
        <div style={{ margin: "24px 0" }}>
          <GithubActivity login={owner} />
        </div>
```

- [ ] **Step 7: Verify type-check passes**

Run: `cd webapp/frontend && npx tsc -b`
Expected: no errors. All of `fetchGithubContributions`, `GithubContributions`, and `GithubContributionDay` are now used.

- [ ] **Step 8: Commit**

```bash
git add webapp/frontend/src/routes/UserPage.tsx
git commit -m "Add the GitHub contribution heatmap to the profile page"
```

---

## Task 6: UserPage — owner affordances

Add the four owner-only pieces: copy-profile-link button, zero-trace onboarding card, capture-tip card, and private-repo nudge. All gated by `isOwner`.

**Files:**
- Modify: `webapp/frontend/src/routes/UserPage.tsx`

- [ ] **Step 1: Add the `CopyLinkButton` component**

Add this to `UserPage.tsx` (place after the `RepoList` function). This is adapted from `Dashboard.tsx` lines 784-808 — the className is changed from the Dashboard's local `styles.btn` to the global `iconbtn` class so it matches the existing "View on GitHub ↗" button in the `entity-actions` area:

```tsx
function CopyLinkButton({ login }: { login: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const url = `${window.location.origin}/${login}`;
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };
  return (
    <button type="button" className="iconbtn" onClick={copy}>
      {copied ? "Link copied" : "Copy profile link"}
    </button>
  );
}
```

- [ ] **Step 2: Render the copy-link button in `entity-actions`**

In the returned JSX, inside `<div className="entity-actions">`, add the button before the existing "View on GitHub ↗" anchor:

```tsx
          <div className="entity-actions">
            {isOwner && <CopyLinkButton login={owner} />}
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="iconbtn primary"
            >
              View on GitHub ↗
            </a>
          </div>
```

- [ ] **Step 3: Port the `Onboarding` component and `INSTALL_COPY`**

Copy verbatim from `Dashboard.tsx` into `UserPage.tsx`:

- Lines 182-186: the `INSTALL_COPY` constant (place near the top, after the imports).
- Lines 673-759: the `Onboarding` component (place after `CopyLinkButton`).

No changes — it references `styles.*` (resolves against `UserPage.module.css`) and `INSTALL_COPY`.

- [ ] **Step 4: Show the onboarding card for the owner with zero traces**

In the returned JSX, the Traces tab currently renders (around lines 175-195):

```tsx
            {tab === "traces" && (
              <>
                {data.traces.length === 0 ? (
                  <div className="trace-list">
                    <div className="empty">No traces yet.</div>
                  </div>
                ) : (
                  <div className="trace-list">
                    {data.traces.map((t) => (
                      <TraceListRow key={t.short_id} trace={t} showRepoChip />
                    ))}
                  </div>
                )}

                <div className="list-footer">
                  <span>
                    Showing {data.traces.length} of {data.stats.trace_count} traces
                  </span>
                </div>
              </>
            )}
```

Replace that whole `{tab === "traces" && (…)}` block with:

```tsx
            {tab === "traces" && (
              <>
                {data.traces.length === 0 ? (
                  isOwner ? (
                    <Onboarding />
                  ) : (
                    <div className="trace-list">
                      <div className="empty">No traces yet.</div>
                    </div>
                  )
                ) : (
                  <>
                    <div className="trace-list">
                      {data.traces.map((t) => (
                        <TraceListRow
                          key={t.short_id}
                          trace={t}
                          showRepoChip
                        />
                      ))}
                    </div>
                    <div className="list-footer">
                      <span>
                        Showing {data.traces.length} of{" "}
                        {data.stats.trace_count} traces
                      </span>
                    </div>
                  </>
                )}
              </>
            )}
```

The `list-footer` now renders only when traces exist — it would otherwise read "Showing 0 of 0 traces" beneath the onboarding card.

- [ ] **Step 5: Port the `IconShield` icon**

Copy verbatim from `Dashboard.tsx` lines 870-885 (`IconShield`) into `UserPage.tsx`, alongside the other ported icons.

- [ ] **Step 6: Render the owner aside cards**

In the returned JSX, inside `<aside>`, after the existing `<div className="side-card">…</div>` (the "Top repositories" card, currently lines 201-233), add the capture-tip and private-repo cards. The JSX is ported from `Dashboard.tsx` lines 624-662, wrapped in an `isOwner` guard. The first card gets an explicit `marginTop` because the global `.side-card` and the module `.card` are not adjacency-related:

```tsx
            {isOwner && (
              <>
                <div className={styles.card} style={{ marginTop: 18 }}>
                  <div className={styles.cardHead}>
                    <h4>Capturing more</h4>
                  </div>
                  <div className={styles.tip}>
                    <p className={styles.tipText}>
                      Every time Claude Code runs <code>gh pr create</code>,
                      the plugin attaches a fresh trace automatically.
                    </p>
                    <div className={styles.term}>
                      <span className={styles.prompt}>$ </span>
                      <span className={styles.cmd}>gh pr create</span> --fill
                      {"\n"}
                      <span className={styles.echo}>
                        ↳ vibeshub: redacted · uploaded ✓
                      </span>
                    </div>
                  </div>
                </div>

                {user && !user.has_private_access && (
                  <div className={styles.card}>
                    <div className={styles.privCard}>
                      <h4>Working in private repos?</h4>
                      <p>
                        Grant private access so traces from private
                        repositories open for teammates with repo access.
                      </p>
                      <a
                        className={styles.privLink}
                        href="/api/auth/github/login?scope=private&next=%2Fhome"
                      >
                        <IconShield />
                        Enable private repositories
                      </a>
                    </div>
                  </div>
                )}
              </>
            )}
```

- [ ] **Step 7: Verify type-check passes**

Run: `cd webapp/frontend && npx tsc -b`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add webapp/frontend/src/routes/UserPage.tsx
git commit -m "Add owner-only affordances to the profile page"
```

---

## Task 7: UserPage tests — owner vs. visitor

Add a test file covering the new behavior. These are integration tests rendering the full page with mocked auth and API.

**Files:**
- Test: `webapp/frontend/src/tests/routes/UserPage.test.tsx` (create)

- [ ] **Step 1: Write the test file**

Create `webapp/frontend/src/tests/routes/UserPage.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { UserPage } from "../../routes/UserPage";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../../auth/AuthContext";

const mockUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

const overview = (traceCount: number) => ({
  login: "alice",
  stats: {
    trace_count: traceCount,
    repo_count: traceCount > 0 ? 2 : 0,
    message_count: 1234,
    byte_size: 4096,
    last_trace_at: traceCount > 0 ? "2026-05-20T00:00:00Z" : null,
  },
  repos:
    traceCount > 0
      ? [{ repo_full_name: "alice/repo", repo_name: "repo", trace_count: 3 }]
      : [],
  traces:
    traceCount > 0
      ? [
          {
            trace_id: "id-1",
            short_id: "abc1234567",
            owner_login: "alice",
            repo_full_name: "alice/repo",
            pr_number: 3,
            pr_url: "https://github.com/alice/repo/pull/3",
            pr_title: "Add the thing",
            platform: "claude-code",
            byte_size: 4096,
            message_count: 12,
            created_at: "2026-05-20T00:00:00Z",
          },
        ]
      : [],
});

const githubUser = {
  login: "alice",
  name: "Alice",
  bio: null,
  avatar_url: null,
  html_url: "https://github.com/alice",
  followers: 42,
  following: 7,
  public_repos: 10,
  total_public_stars: 99,
  top_languages: ["TypeScript"],
  created_at: "2020-01-01T00:00:00Z",
  stars_truncated: false,
};

const contributions = {
  login: "alice",
  total: 0,
  days: [],
};

/** Routes a mocked fetch by URL path to the right JSON payload. */
function mockFetch(traceCount: number) {
  vi.spyOn(global, "fetch").mockImplementation((input) => {
    const url = String(input);
    let body: unknown = {};
    if (url.includes("/api/users/")) body = overview(traceCount);
    else if (url.includes("/contributions")) body = contributions;
    else if (url.includes("/api/github/users/")) body = githubUser;
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
}

function renderUserPage() {
  return render(
    <MemoryRouter initialEntries={["/alice"]}>
      <Routes>
        <Route path=":owner" element={<UserPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const ownerAuth = {
  loading: false,
  user: {
    id: "u-1",
    login: "alice",
    name: "Alice",
    avatar_url: null,
    has_private_access: false,
  },
  refresh: vi.fn(),
  signOut: vi.fn(),
};

const visitorAuth = {
  loading: false,
  user: null,
  refresh: vi.fn(),
  signOut: vi.fn(),
};

describe("UserPage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders the merged stat strip", async () => {
    mockUseAuth.mockReturnValue(visitorAuth);
    mockFetch(1);
    renderUserPage();
    // "42" is the GitHub follower count — waiting on it confirms both
    // the overview and the GitHub-user fetch have resolved.
    await waitFor(() =>
      expect(screen.getByText("42")).toBeInTheDocument(),
    );
    // "Messages" / "Followers" are unique to the stat strip. ("Traces"
    // and "Repositories" are deliberately not asserted — those strings
    // also appear on the tab buttons.)
    expect(screen.getByText("Messages")).toBeInTheDocument();
    expect(screen.getByText("Followers")).toBeInTheDocument();
    expect(screen.getByText("1.2k")).toBeInTheDocument(); // 1234 messages
  });

  it("shows owner affordances when viewing your own profile", async () => {
    mockUseAuth.mockReturnValue(ownerAuth);
    mockFetch(1);
    renderUserPage();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /copy profile link/i }),
      ).toBeInTheDocument(),
    );
    // The greeting line renders the owner's bold first name, "Alice".
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText(/Capturing more/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Working in private repos\?/i),
    ).toBeInTheDocument();
  });

  it("hides owner affordances from other visitors", async () => {
    mockUseAuth.mockReturnValue(visitorAuth);
    mockFetch(1);
    renderUserPage();
    await waitFor(() =>
      expect(screen.getByText("Followers")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /copy profile link/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(screen.queryByText(/Capturing more/i)).not.toBeInTheDocument();
  });

  it("shows the onboarding card for the owner with zero traces", async () => {
    mockUseAuth.mockReturnValue(ownerAuth);
    mockFetch(0);
    renderUserPage();
    await waitFor(() =>
      expect(
        screen.getByText(/Capture your first Claude Code session/i),
      ).toBeInTheDocument(),
    );
  });

  it("shows a plain empty state for a visitor on an empty profile", async () => {
    mockUseAuth.mockReturnValue(visitorAuth);
    mockFetch(0);
    renderUserPage();
    await waitFor(() =>
      expect(screen.getByText(/No traces yet/i)).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(/Capture your first Claude Code session/i),
    ).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test file**

Run: `cd webapp/frontend && npx vitest run src/tests/routes/UserPage.test.tsx`
Expected: all 5 tests PASS. (The `getByText("Alice")` assertion relies on the greeting line in Task 3 Step 4 wrapping the first name in `<strong>{firstName}</strong>` — "Alice" must be its own text node. If `firstName` were rendered as bare text inside other words, the matcher would need adjusting.)

- [ ] **Step 3: Commit**

```bash
git add webapp/frontend/src/tests/routes/UserPage.test.tsx
git commit -m "Test owner vs. visitor rendering on the profile page"
```

---

## Task 8: Delete `Dashboard.tsx`, prune unused CSS, full verification

**Files:**
- Delete: `webapp/frontend/src/routes/Dashboard.tsx`
- Modify: `webapp/frontend/src/routes/UserPage.module.css`

- [ ] **Step 1: Confirm `Dashboard.tsx` has no importers**

Run: `cd webapp/frontend && grep -rn "Dashboard" src --include='*.tsx' --include='*.ts'`
(Quote the globs — zsh expands bare `*.tsx` before `grep` sees it.)
Expected: matches appear only inside `src/routes/Dashboard.tsx` itself. If any other file imports it, stop and fix that file first.

- [ ] **Step 2: Delete `Dashboard.tsx`**

```bash
git rm webapp/frontend/src/routes/Dashboard.tsx
```

- [ ] **Step 3: Prune unused classes from `UserPage.module.css`**

The following selectors were used only by the deleted Dashboard chrome and are now dead. Delete each rule (and its `:hover` / `:active` / nested / `:global` / `@keyframes` companions) from `webapp/frontend/src/routes/UserPage.module.css`:

`.shell`, `.wrap`, `.rise` is **kept** (used by the heatmap section), `.hero` (incl. `.hero::before` and the `:global([data-theme="dark"]) .hero::before` rule), `.heroRow`, `.heroLeft`, `.eyebrow` (incl. `.eyebrow .pulse` and `@keyframes pulse` and its `prefers-reduced-motion` block), `.greeting` (incl. `.greeting .name` — the Dashboard hero `.greeting`, **not** the new `.greetingLine`), `.lede` (incl. `.lede strong`), `.heroActions`, `.btn` (incl. `.btn:hover`, `.btn:active`, `.btn svg`, `.btnPrimary`, `.btnPrimary:hover`, `.btnGhost`, `.btnGhost:hover`, `.btnGhost.ok`), `.idCard`, `.avatar`, `.idName`, `.idHandle`, `.idStatus` (incl. `.idStatus svg`, `.idStatus.priv`), `.body` (incl. `.body > .rise + .rise`), `.split` (the module one — `UserPage` uses the global `.split`), `.repoRow` (incl. `:hover`), `.repoMark`, `.repoName`, `.repoCount`, `.inlineError` (incl. `.inlineError strong`), `.foot`, `.footInner` (incl. `.footInner a`, `.footInner a:hover`), `.signOut` (incl. `.signOut:hover`).

In the `@media (max-width: 900px)` block, delete the `.heroRow` and `.idCard` rules and the `.split` rule. In the `@media (max-width: 600px)` block, delete the `.wrap` and `.hero` rules.

**Keep** everything else: `.rise` and `@keyframes rise` and its reduced-motion block, `.blockHead`, `.blockTitle` (+ `.ct`), `.blockLink`, `.activity*`, `.heatWrap`, `.months`/`.month`, `.heatBody`, `.weekdays`/`.weekday`, `.weeks`/`.week`, `.cell`, `.lvl[...]`, `.legend`/`.sq`, `.activityStats`, `.figure*`, `.card*`, `.tip*`, `.term*`, `.privCard`/`.privLink`, `.onboard*`, `.steps`/`.step*`, `.code*`, `.loading`/`.blink`/`@keyframes blink`, `.greetingLine`, and the kept `@media` rules for `.activityGrid`, `.activityStats`, `.figure`, `.onboard`, `.onboardRight`, `.onboardLeft`.

Verification after editing: for each class name still defined in `UserPage.module.css`, it must appear either as `styles.<name>` in `UserPage.tsx` or be a data-attribute / pseudo companion of one that does. If unsure about a class, leaving it in place is harmless (dead CSS in a module has no runtime effect) — prefer keeping over wrongly deleting.

- [ ] **Step 4: Type-check**

Run: `cd webapp/frontend && npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `cd webapp/frontend && npm test`
Expected: all test files PASS, including `Home.test.tsx` and `UserPage.test.tsx`.

- [ ] **Step 6: Production build**

Run: `cd webapp/frontend && npm run build`
Expected: `tsc -b` then `vite build` complete with no errors.

- [ ] **Step 7: Commit**

```bash
git add webapp/frontend/src/routes/Dashboard.tsx webapp/frontend/src/routes/UserPage.module.css
git commit -m "Delete the Dashboard component and prune its unused styles"
```

---

## Verification Summary

After Task 8, confirm against the spec:

- `/home` redirects: signed-in → `/{login}`, anonymous → `/` (Task 1, `Home.test.tsx`).
- Profile page shows the merged stat strip Traces / Repositories / Messages / Followers (Task 4, `UserPage.test.tsx`).
- GitHub contribution heatmap renders on every profile (Task 5).
- Owner-only: greeting line, copy-link button, capture-tip card, private-repo nudge, and onboarding card on a zero-trace profile (Tasks 3 & 6, `UserPage.test.tsx`).
- Visitors see none of the owner affordances and get the plain "No traces yet." empty state (Task 7).
- `Dashboard.tsx` deleted; `Dashboard.module.css` renamed to `UserPage.module.css` and pruned (Tasks 2 & 8).
- Trace visibility is unchanged — `UserPage` calls the same `/api/users/{login}` endpoint, which already filters per-viewer (no code change needed; spec "Trace visibility & GitHub privacy" section).
