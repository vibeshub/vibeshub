# Refocus Messaging (Teams on `/`, Solo Show-off on `/vibeviewer`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-slant the front page to pitch vibeshub as a collaboration tool for vibe coding teams, and re-slant `/vibeviewer` to the individual developer showing off how they built their work, with one subtle cross-link each way and no audience-mixing on either page.

**Architecture:** Copy and section changes only. The front page keeps its existing layout and the PR-comment mock card, swapping the solo "Show it off" section for a team "Collaborate" section. `/vibeviewer` keeps its dropzone/how-to/claim flow and gains a "Made to be shared" band plus a team pointer. New CSS reuses existing classes and design tokens; only two small style blocks are added.

**Tech Stack:** React + TypeScript, react-router-dom, Vitest + @testing-library/react, CSS modules (Landing) and a global stylesheet (vibeviewer).

**Working directory for all commands:** `webapp/frontend` (run `cd webapp/frontend` first; paths below are relative to it).

---

### Task 1: Front page — team collaboration messaging

**Files:**
- Create: `src/tests/routes/Landing.test.tsx`
- Modify: `src/routes/Landing.tsx` (hero eyebrow ~149, hero subhead ~156-160, nav ~116-121, the `showoff` section ~346-444)
- Modify: `src/routes/Landing.module.css` (add `.showoffCross`)

- [ ] **Step 1: Write the failing test**

Create `src/tests/routes/Landing.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Landing } from "../../routes/Landing";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../api", () => ({
  fetchRepoOverview: vi.fn(),
}));

import { useAuth } from "../../auth/AuthContext";
import { fetchRepoOverview } from "../../api";

const mockUseAuth = useAuth as unknown as Mock;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="vibeviewer" element={<div>vibeviewer sentinel</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Landing", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockUseAuth.mockReturnValue({ loading: false, user: null });
    (fetchRepoOverview as Mock).mockReset();
    // Degrade to skeleton; no state update fires on rejection.
    (fetchRepoOverview as Mock).mockRejectedValue(new Error("no network in test"));
  });

  it("leads with team-collaboration messaging", () => {
    renderPage();
    expect(
      screen.getByText(/Your team's work, finally legible/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Faster, deeper review/i)).toBeInTheDocument();
    expect(screen.getByText(/Searchable team history/i)).toBeInTheDocument();
  });

  it("drops the solo brag-post framing from the front page", () => {
    renderPage();
    expect(screen.queryByText(/Brag posts/i)).not.toBeInTheDocument();
  });

  it("offers solo visitors a subtle pointer to the vibeviewer", () => {
    renderPage();
    expect(
      screen.getByText(/just want to show off a session/i),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd webapp/frontend && npx vitest run src/tests/routes/Landing.test.tsx`
Expected: FAIL — "Your team's work, finally legible" / "Faster, deeper review" / "just want to show off a session" not found (the page still shows the old "Show it off" / "Brag posts" copy).

- [ ] **Step 3: Re-slant the hero eyebrow**

In `src/routes/Landing.tsx`, in the hero eyebrow (around line 149), change:

```tsx
                <span>public &amp; private &middot; for Claude Code</span>
```

to:

```tsx
                <span>public &amp; private &middot; for vibe coding teams</span>
```

- [ ] **Step 4: Re-slant the hero subhead**

In `src/routes/Landing.tsx`, replace the hero `<p className={styles.heroSub}>` block (around lines 156-160):

```tsx
              <p className={styles.heroSub}>
                Your Claude Code sessions, including every subagent they spawn,
                become shareable, replayable traces. Show teammates how you
                actually shipped it, or revisit your own reasoning weeks later.
              </p>
```

with:

```tsx
              <p className={styles.heroSub}>
                Your Claude Code sessions, including every subagent they spawn,
                become shareable, replayable traces your whole team can read.
                Reviewers and teammates see how you actually shipped it, not
                just the final diff.
              </p>
```

- [ ] **Step 5: Add a `Teams` nav link**

In `src/routes/Landing.tsx`, in the `<nav>` block (around lines 116-121), change:

```tsx
          <nav className={`${styles.navLinks} ${styles.hideSm}`}>
            <a href="#browse">Browse</a>
            <Link to="/vibeviewer">Viewer</Link>
            <a href="#privacy">Privacy</a>
            <a href="#install">Install</a>
          </nav>
```

to:

```tsx
          <nav className={`${styles.navLinks} ${styles.hideSm}`}>
            <a href="#teams">Teams</a>
            <a href="#browse">Browse</a>
            <Link to="/vibeviewer">Viewer</Link>
            <a href="#privacy">Privacy</a>
            <a href="#install">Install</a>
          </nav>
```

- [ ] **Step 6: Replace the "Show it off" section with the team "Collaborate" section**

In `src/routes/Landing.tsx`, replace the entire section that starts with the `{/* ====================== show it off ====================== */}` comment and the `<section className={styles.showoff} id="showoff">` element (lines ~346-444), keeping the left `shareCard` (PR-comment mock) exactly as-is. Replace from the opening comment through the closing `</section>` with:

```tsx
        {/* ====================== collaborate (teams) ====================== */}
        <section className={styles.showoff} id="teams">
          <div className={`${styles.container} ${styles.showoffGrid}`}>
            <div className={styles.shareCard}>
              <div className={styles.prCommentHead}>
                <span className={styles.prAvatar}>v</span>
                <span className={styles.prAuthor}>vibeshub-bot</span>
                <span className={styles.prBotTag}>bot</span>
                <span className={styles.prTime}>commented just now</span>
              </div>
              <div className={styles.prBody}>
                <div className={styles.prTitle}>
                  Claude Code session for this PR
                </div>
                <div className={styles.prStats}>
                  <span>
                    <strong>257</strong> messages
                  </span>
                  <span className={styles.prSep}>·</span>
                  <span>
                    <strong>12</strong> file edits
                  </span>
                  <span className={styles.prSep}>·</span>
                  <span>
                    <strong>4</strong> subagents
                  </span>
                </div>
                <a
                  className={styles.prLink}
                  href={`https://vibeshub.ai/${BROWSE_FULL}/pull/69/7ntgpt45el`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className={styles.prLinkHost}>vibeshub.ai/</span>
                  <span>{BROWSE_FULL}/pull/69/7ntgpt45el</span>
                  <span className={styles.prLinkArrow}>&#x2197;</span>
                </a>
              </div>
            </div>

            <div>
              <div className={styles.eyebrow}>
                <span className={styles.dot} /> Collaborate
              </div>
              <h2 className={styles.sectionTitle}>
                Your team&rsquo;s work, finally legible.
              </h2>
              <p className={styles.sectionLede} style={{ marginBottom: 0 }}>
                Every PR your team ships can carry the session that produced it.
                The whole team reads how it was built, not just what changed.
              </p>

              <ul className={styles.showoffUses}>
                <li>
                  <span className={styles.mk}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>Faster, deeper review.</strong> Reviewers open the
                    actual run, the prompts, tool calls, and reasoning, before
                    they read the diff. Less guessing, fewer round-trips.
                  </span>
                </li>
                <li>
                  <span className={styles.mk}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>Onboarding without the shoulder-tap.</strong> New
                    teammates see how tricky changes were really built, with the
                    full session as context.
                  </span>
                </li>
                <li>
                  <span className={styles.mk}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>Searchable team history.</strong> Every shipped PR
                    keeps its session attached, so each repo becomes a browsable
                    archive of how the team works.
                  </span>
                </li>
                <li>
                  <span className={styles.mk}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>Shared permissions, zero setup.</strong> Access
                    mirrors GitHub, so the right people already have visibility,
                    with no separate ACLs or accounts.
                  </span>
                </li>
              </ul>

              <p className={styles.showoffCross}>
                Working solo and just want to show off a session?{" "}
                <Link to="/vibeviewer" className={styles.ghLink}>
                  Try the vibeviewer &rarr;
                </Link>
              </p>
            </div>
          </div>
        </section>
```

- [ ] **Step 7: Add the `.showoffCross` style**

In `src/routes/Landing.module.css`, append:

```css
.showoffCross {
  margin: 20px 0 0;
  font-size: 13.5px;
  color: var(--text-faint);
}
```

- [ ] **Step 8: Run the Landing test to verify it passes**

Run: `cd webapp/frontend && npx vitest run src/tests/routes/Landing.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
cd webapp/frontend
git add src/tests/routes/Landing.test.tsx src/routes/Landing.tsx src/routes/Landing.module.css
git commit -m "Refocus front page on team collaboration"
```

---

### Task 2: `/vibeviewer` — individual show-off messaging

**Files:**
- Modify: `src/tests/routes/VibeViewer.test.tsx` (add one test)
- Modify: `src/routes/VibeViewer.tsx` (H1 ~331-333, subhead ~334-338, new section after the `vv-trust` div ~681-689, team cross-link before `vv-foot` ~693)
- Modify: `src/styles/vibeviewer.css` (add `.vv-share*` and `.vv-cross` blocks)

- [ ] **Step 1: Write the failing test**

In `src/tests/routes/VibeViewer.test.tsx`, add this test inside the existing `describe("VibeViewer", ...)` block (after the first `it(...)` is fine). It reuses the file's existing `anon` constant and `renderPage` helper:

```tsx
  it("pitches the solo show-off angle and points teams back to the main page", () => {
    mockUseAuth.mockReturnValue(anon);
    renderPage();
    // H1 text node before the highlighted span.
    expect(
      screen.getByText(/Show off how you actually/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/A link worth showing off/i)).toBeInTheDocument();
    expect(
      screen.getByText(/auto-posts these on every PR/i),
    ).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd webapp/frontend && npx vitest run src/tests/routes/VibeViewer.test.tsx -t "pitches the solo show-off angle"`
Expected: FAIL — the new H1, "A link worth showing off", and the team cross-link don't exist yet.

- [ ] **Step 3: Re-slant the vibeviewer H1**

In `src/routes/VibeViewer.tsx`, replace the `<h1 className="vv-title">` block (around lines 331-333):

```tsx
        <h1 className="vv-title">
          Your vibe coding sessions, <span className="hl">visualized</span>.
        </h1>
```

with:

```tsx
        <h1 className="vv-title">
          Show off how you actually <span className="hl">built it</span>.
        </h1>
```

- [ ] **Step 4: Re-slant the vibeviewer subhead**

In `src/routes/VibeViewer.tsx`, replace the `<p className="vv-sub">` block (around lines 334-338):

```tsx
        <p className="vv-sub">
          Your hard work deserves a better look. Drop a Claude Code transcript
          and get a clean, replayable, shareable trace in seconds, no login
          required.
        </p>
```

with:

```tsx
        <p className="vv-sub">
          Your hard work deserves a better look. Drop a Claude Code transcript
          and get a clean, replayable trace you can share anywhere, in seconds.
          No login required.
        </p>
```

- [ ] **Step 5: Add the "Made to be shared" section**

In `src/routes/VibeViewer.tsx`, find the `vv-trust` block (around lines 681-689):

```tsx
        <div className="vv-trust">
          <span className="pt">
            <TrustCheck /> No account required
          </span>
          <span className="sep">·</span>
          <span className="pt">
            <TrustCheck /> Secrets redacted on upload
          </span>
        </div>
```

Immediately AFTER that closing `</div>` and BEFORE `<HowToSection flashCard={flashCard} />`, insert:

```tsx
        <section className="vv-share">
          <div className="vv-how-head">
            <div className="vv-how-eyebrow">Made to be shared</div>
            <h2 className="vv-how-title">A link worth showing off.</h2>
            <p className="vv-how-sub">
              Every trace gets a stable URL built for sharing, so your work is
              legible to other people, not just your future self.
            </p>
          </div>
          <ul className="vv-share-uses">
            <li>
              <span className="mk">
                <TrustCheck />
              </span>
              <span>
                <strong>A social card that lands.</strong> Drop the link on X or
                LinkedIn and it renders with the title and tool mix, cleaner than
                a screenshot of your terminal.
              </span>
            </li>
            <li>
              <span className="mk">
                <TrustCheck />
              </span>
              <span>
                <strong>On your profile.</strong> Sign in and every trace you
                share shows up at <code>vibeshub.ai/@you</code>, a running
                portfolio of how you build.
              </span>
            </li>
            <li>
              <span className="mk">
                <TrustCheck />
              </span>
              <span>
                <strong>Replayable, not a static dump.</strong> Anyone you share
                with can step through the prompts, tool calls, and reasoning at
                their own pace.
              </span>
            </li>
            <li>
              <span className="mk">
                <TrustCheck />
              </span>
              <span>
                <strong>Subagents included.</strong> When your session spawns
                subagents, every one is captured and replayable too, not just the
                top-level transcript.
              </span>
            </li>
          </ul>
        </section>
```

- [ ] **Step 6: Add the team cross-link near the foot**

In `src/routes/VibeViewer.tsx`, find the foot line (around line 693):

```tsx
        <div className="vv-foot">vibeshub · vibeviewer</div>
```

Insert immediately BEFORE it:

```tsx
        <p className="vv-cross">
          Shipping with a team?{" "}
          <Link to="/" className="bridge-link">
            vibeshub auto-posts these on every PR &rarr;
          </Link>
        </p>
```

(`Link` is already imported in this file.)

- [ ] **Step 7: Add the vibeviewer styles**

In `src/styles/vibeviewer.css`, append:

```css
/* ---- made-to-be-shared band ---- */
.vv-page .vv-share {
  width: 100%;
  max-width: 980px;
  margin: 88px auto 0;
}
.vv-page .vv-share-uses {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px 30px;
  margin: 30px 0 0;
  padding: 0;
  list-style: none;
  text-align: left;
}
.vv-page .vv-share-uses li {
  display: flex;
  gap: 11px;
  font-size: 14.5px;
  line-height: 1.55;
  color: var(--text-muted);
}
.vv-page .vv-share-uses .mk {
  flex: none;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: var(--accent-soft);
  color: var(--accent-strong);
}
.vv-page .vv-share-uses .mk svg {
  width: 13px;
  height: 13px;
}
.vv-page .vv-share-uses strong {
  color: var(--text-strong);
  font-weight: 600;
}
.vv-page .vv-share-uses code {
  font: 500 13px var(--font-mono);
  color: var(--text-strong);
}
.vv-page .vv-cross {
  margin-top: 22px;
  font-size: 13.5px;
  color: var(--text-faint);
}
@media (max-width: 640px) {
  .vv-page .vv-share-uses {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 8: Run the vibeviewer tests to verify they pass**

Run: `cd webapp/frontend && npx vitest run src/tests/routes/VibeViewer.test.tsx src/tests/routes/VibeViewerBridge.test.tsx`
Expected: PASS — the new test passes and the existing pinned-string tests (Drop your transcript here, Three ways to get your transcript, Local session files, vibeshub plugin, show it on your profile, the success/copy/claim flow, the bridge jump-links) still pass.

- [ ] **Step 9: Commit**

```bash
cd webapp/frontend
git add src/tests/routes/VibeViewer.test.tsx src/routes/VibeViewer.tsx src/styles/vibeviewer.css
git commit -m "Refocus vibeviewer on solo show-off"
```

---

### Task 3: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the entire frontend test suite**

Run: `cd webapp/frontend && npm run test`
Expected: PASS — all suites green, including `Landing.test`, `VibeViewer.test`, `VibeViewerBridge.test`, `Home.test`.

- [ ] **Step 2: Typecheck and production build**

Run: `cd webapp/frontend && npm run build`
Expected: `tsc -b` reports no errors and `vite build` completes (no unused-import or type errors from the edits).

- [ ] **Step 3: Em-dash guard**

Run: `cd webapp/frontend && grep -n "—" src/routes/Landing.tsx src/routes/VibeViewer.tsx src/styles/vibeviewer.css src/routes/Landing.module.css`
Expected: no matches (standing rule: no em-dashes in user-facing copy).

- [ ] **Step 4: Manual eyeball (optional but recommended)**

Run `npm run dev`, open `/` and `/vibeviewer` in light and dark themes. Confirm:
- Front page hero reads team-first; the `Collaborate` section shows the PR-comment card plus the four team bullets and the subtle "Try the vibeviewer" link; `Teams` appears in the nav and jumps to the section.
- `/vibeviewer` H1 is "Show off how you actually built it.", the "Made to be shared" band renders as a tidy 2-column list (1 column on narrow widths), and the "vibeshub auto-posts these on every PR" pointer sits above the foot.
- No solo brag/profile/social copy remains on `/`; no team/PR-automation pitch is mixed into `/vibeviewer` beyond the single cross-link.

---

## Self-Review Notes

- **Spec coverage:** Hero re-slant (Task 1 Steps 3-4); replace solo block with team section using all four value props + keep PR card (Task 1 Step 6); Browse/Privacy/Install untouched (unchanged by design); solo cross-link on `/` (Task 1 Step 6) and team cross-link on `/vibeviewer` (Task 2 Step 6); vibeviewer H1/subhead re-slant (Task 2 Steps 3-4); "Made to be shared" section carrying the moved solo content — social card, profile, replayable, subagents (Task 2 Step 5). All spec sections map to a task.
- **No placeholders:** every code and CSS step shows the full content; commands include expected output.
- **Type/name consistency:** reuses existing components/classes only — `IconCheck`, `Link`, `TrustCheck`, `styles.showoff/showoffGrid/shareCard/eyebrow/dot/sectionTitle/sectionLede/showoffUses/mk/ghLink`, and global `vv-how-head/vv-how-eyebrow/vv-how-title/vv-how-sub/bridge-link`. New names introduced and used consistently: `styles.showoffCross` (Landing.module.css), `.vv-share` / `.vv-share-uses` / `.vv-cross` (vibeviewer.css).
- **Test-matcher caveat captured:** the vibeviewer H1 is asserted as `/Show off how you actually/i` (the text node before the highlighted `<span>`), because @testing-library `getNodeText` concatenates only direct text-node children and excludes the span's "built it".
