# Privacy Policy Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated `/privacy` page to the vibeshub SPA presenting a plain-language privacy policy derived from what the codebase actually collects, and repoint the landing page's existing "Privacy" links to the new route.

**Architecture:** A new React Router route `<Route path="privacy" element={<Privacy />} />` renders a self-contained `Privacy.tsx` page that follows the existing `page-shell` + `PageTopbar` + footer pattern used by `RepoPage`/`UserPage`. Content is structured JSX (semantic `<h2>` sections in an `<article>`). Styling lives in a new `Privacy.module.css` reusing the project's CSS tokens. Tests follow the existing route-test pattern (Vitest + React Testing Library + `MemoryRouter`).

**Tech Stack:** React 19 + TypeScript, React Router 7, Vite, Vitest, @testing-library/react, CSS Modules.

**Spec:** `docs/superpowers/specs/2026-05-22-privacy-policy-page-design.md`

---

## File Structure

- **Create**: `webapp/frontend/src/routes/Privacy.tsx` — the page component.
- **Create**: `webapp/frontend/src/routes/Privacy.module.css` — page styling (prose layout, header, spacing).
- **Create**: `webapp/frontend/src/tests/routes/Privacy.test.tsx` — route tests.
- **Modify**: `webapp/frontend/src/App.tsx` — register the new route.
- **Modify**: `webapp/frontend/src/routes/Landing.tsx` — repoint the hero "Privacy & redaction" button and the footer "Privacy" link to `/privacy`; add a "Read the full policy" link inside the existing `#privacy` teaser section.

All work happens in `webapp/frontend/`. Run commands from that directory unless noted.

---

## Task 1: Failing route test + minimal Privacy component + route registration

**Files:**
- Create: `webapp/frontend/src/tests/routes/Privacy.test.tsx`
- Create: `webapp/frontend/src/routes/Privacy.tsx`
- Modify: `webapp/frontend/src/App.tsx`

This task establishes the route and the test harness end-to-end with the smallest viable component. Subsequent tasks flesh out content and styling.

- [ ] **Step 1: Write the failing route test**

Create `webapp/frontend/src/tests/routes/Privacy.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Privacy } from "../../routes/Privacy";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: vi.fn(() => ({
    loading: false,
    user: null,
    refresh: vi.fn(),
    signOut: vi.fn(),
  })),
}));

function renderPrivacy() {
  return render(
    <MemoryRouter initialEntries={["/privacy"]}>
      <Routes>
        <Route path="/privacy" element={<Privacy />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Privacy", () => {
  it("renders the page shell with a Privacy heading", () => {
    renderPrivacy();
    expect(
      screen.getByRole("heading", { level: 1, name: /privacy policy/i }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/tests/routes/Privacy.test.tsx`

Expected: FAIL — module `../../routes/Privacy` cannot be resolved.

- [ ] **Step 3: Create the minimal Privacy component**

Create `webapp/frontend/src/routes/Privacy.tsx`:

```tsx
import { PageTopbar } from "../components/PageTopbar";

export function Privacy() {
  return (
    <div className="page-shell">
      <PageTopbar crumbs={[{ label: "Privacy", current: true }]} />
      <main className="page">
        <h1>Privacy policy</h1>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/tests/routes/Privacy.test.tsx`

Expected: PASS (1 test).

- [ ] **Step 5: Register the route in `App.tsx`**

In `webapp/frontend/src/App.tsx`, add the import alongside the other route imports:

```tsx
import { Privacy } from "./routes/Privacy";
```

And add the route inside `<Routes>`, immediately after the `upload` route:

```tsx
<Route path="upload" element={<UploadPage />} />
<Route path="privacy" element={<Privacy />} />
```

- [ ] **Step 6: Type-check and run the full suite**

Run: `npx tsc -b --noEmit` then `npm test`

Expected: type-check clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add webapp/frontend/src/routes/Privacy.tsx \
        webapp/frontend/src/tests/routes/Privacy.test.tsx \
        webapp/frontend/src/App.tsx
git commit -m "Add /privacy route with a minimal Privacy page"
```

---

## Task 2: Fill in the full policy content

**Files:**
- Modify: `webapp/frontend/src/routes/Privacy.tsx`
- Modify: `webapp/frontend/src/tests/routes/Privacy.test.tsx`

Replace the minimal body with the comprehensive plain-language policy. Tests assert each major section heading exists plus the contact email — this both verifies the page and guards against accidental section removal.

- [ ] **Step 1: Extend the test to assert section coverage and contact**

Replace `webapp/frontend/src/tests/routes/Privacy.test.tsx` with:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Privacy } from "../../routes/Privacy";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: vi.fn(() => ({
    loading: false,
    user: null,
    refresh: vi.fn(),
    signOut: vi.fn(),
  })),
}));

function renderPrivacy() {
  return render(
    <MemoryRouter initialEntries={["/privacy"]}>
      <Routes>
        <Route path="/privacy" element={<Privacy />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Privacy", () => {
  it("renders the page shell with a Privacy heading", () => {
    renderPrivacy();
    expect(
      screen.getByRole("heading", { level: 1, name: /privacy policy/i }),
    ).toBeInTheDocument();
  });

  it("renders each major policy section", () => {
    renderPrivacy();
    const sections = [
      /what we collect/i,
      /redaction/i,
      /how we use/i,
      /visibility & sharing/i,
      /third parties/i,
      /retention & deletion/i,
      /your rights & contact/i,
      /changes to this policy/i,
    ];
    for (const name of sections) {
      expect(
        screen.getByRole("heading", { level: 2, name }),
      ).toBeInTheDocument();
    }
  });

  it("shows the contact email as a mailto link", () => {
    renderPrivacy();
    const link = screen.getByRole("link", { name: /bhavya@vibeshub\.ai/i });
    expect(link).toHaveAttribute("href", "mailto:bhavya@vibeshub.ai");
  });

  it("states an effective date", () => {
    renderPrivacy();
    expect(screen.getByText(/effective .*2026/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify the new assertions fail**

Run: `npm test -- src/tests/routes/Privacy.test.tsx`

Expected: FAIL — the three new tests fail because the minimal page lacks section headings, the contact link, and the effective-date line.

- [ ] **Step 3: Create an empty `Privacy.module.css` placeholder**

Create the file so the CSS Module import in the next step resolves. Task 3 fills it in.

```bash
: > webapp/frontend/src/routes/Privacy.module.css
```

- [ ] **Step 4: Replace `Privacy.tsx` with the full policy content**

Replace `webapp/frontend/src/routes/Privacy.tsx` with:

```tsx
import { PageTopbar } from "../components/PageTopbar";
import styles from "./Privacy.module.css";

export function Privacy() {
  return (
    <div className="page-shell">
      <PageTopbar crumbs={[{ label: "Privacy", current: true }]} />

      <main className={`page ${styles.privacy}`}>
        <header className={styles.header}>
          <div className={styles.eyebrow}>
            <span className="dot" />
            <span>POLICY</span>
          </div>
          <h1 className={styles.title}>Privacy policy</h1>
          <p className={styles.effective}>Effective 22 May 2026</p>
        </header>

        <article className={styles.prose}>
          <p>
            vibeshub hosts Claude Code conversation traces and links them to
            the pull requests they produced. This policy describes, in plain
            language, what we collect when you sign in and upload a trace,
            what we do with it, who can see it, and how to delete it.
          </p>

          <h2>What we collect</h2>
          <p>Three categories of data, all tied to actions you take:</p>
          <ul>
            <li>
              <strong>GitHub account data</strong> — when you sign in with
              GitHub we store your GitHub user ID, login, display name,
              avatar URL, and email (if your GitHub profile exposes one). We
              identify you by your immutable GitHub ID, so renaming your
              GitHub login does not lose your history.
            </li>
            <li>
              <strong>A GitHub OAuth access token</strong> — stored encrypted
              at rest (Fernet ciphertext). We request the minimum scopes
              needed to sign you in. The <code>repo</code> scope, which
              grants read access to your private repositories, is requested
              only if you explicitly opt into the "Enable private
              repositories" sign-in so we can check your access to
              private-repo traces on your behalf.
            </li>
            <li>
              <strong>A session cookie</strong> — an opaque, random session
              ID with an expiry. It is the only cookie we set, and it exists
              solely to keep you signed in.
            </li>
            <li>
              <strong>Uploaded traces</strong> — when you (or the Claude
              Code plugin acting on your behalf) upload a trace, we store
              the trace transcript (a JSONL file) plus the repository's full
              name, the pull request number, title, and URL, the source
              platform (e.g. <code>claude-code</code>), the plugin version,
              the Claude Code session ID, the trace's byte size and message
              count, and counts of how many secrets the redaction passes
              removed.
            </li>
          </ul>

          <h2>Redaction</h2>
          <p>
            Trace transcripts can contain anything you or Claude Code typed,
            including secrets that leaked into terminal output. Every trace
            is scrubbed in two passes — once on your machine before upload,
            and again on our server before storage — for these patterns:
          </p>
          <ul>
            <li>Anthropic API keys (<code>sk-ant-…</code>)</li>
            <li>OpenAI API keys (<code>sk-…</code>)</li>
            <li>
              GitHub tokens (<code>ghp_</code>, <code>gho_</code>,{" "}
              <code>ghu_</code>, <code>ghs_</code>, <code>ghr_</code>)
            </li>
            <li>AWS access key IDs and secret access keys</li>
            <li>JSON Web Tokens (<code>eyJ…</code>)</li>
            <li>
              Environment-style assignments of the form{" "}
              <code>FOO_KEY=…</code>, <code>FOO_TOKEN=…</code>,{" "}
              <code>FOO_SECRET=…</code>, <code>FOO_PASSWORD=…</code>
            </li>
          </ul>
          <p>
            Redaction is best-effort. We catch the common shapes of credentials
            but cannot guarantee that every secret a model or a shell command
            ever emits will match a pattern. Treat a trace like the rest of
            your pull request: review it before sharing.
          </p>

          <h2>How we use what we collect</h2>
          <ul>
            <li>To authenticate you and keep you signed in.</li>
            <li>To render uploaded traces in the viewer.</li>
            <li>
              To gate private-repo traces — when someone opens a trace from
              a private repository, we use that viewer's GitHub OAuth token
              to check, against GitHub, whether they have read access to the
              repo. If they don't, we don't serve the trace.
            </li>
          </ul>
          <p>
            We don't sell your data. We don't run advertising trackers. We
            don't use your traces to train models.
          </p>

          <h2>Visibility &amp; sharing</h2>
          <p>
            A trace inherits the visibility of its repository at the moment
            it was uploaded. Traces from public repositories are viewable by
            anyone with the link. Traces from private repositories require a
            signed-in viewer with GitHub read access to that repo. Standalone
            traces uploaded without a pull request are accessible to anyone
            with the link.
          </p>

          <h2>Third parties</h2>
          <p>We rely on the following services to operate vibeshub:</p>
          <ul>
            <li>
              <strong>GitHub</strong> — for OAuth sign-in and for repository
              access checks via the GitHub API.
            </li>
            <li>
              <strong>Microsoft Azure</strong> — vibeshub runs on Azure
              Container Apps, with Azure Database for PostgreSQL for metadata
              and Azure Blob Storage for trace blobs. Access is brokered via
              managed identity.
            </li>
          </ul>
          <p>
            These providers process data on our behalf to host the service.
            We do not share your data with anyone else.
          </p>

          <h2>Retention &amp; deletion</h2>
          <p>
            You can delete any trace you uploaded at any time. Inside Claude
            Code, run{" "}
            <code>/share-pr delete &lt;pr-url-or-trace-url&gt;</code>; only
            the original uploader can delete a trace. Sessions expire on
            their own, and signing out invalidates the current session
            immediately.
          </p>
          <p>
            We keep traces and account data for as long as your account is
            active. If you want everything tied to your account removed,
            contact us at the address below.
          </p>

          <h2>Your rights &amp; contact</h2>
          <p>
            For privacy questions, access requests, or to ask us to delete
            data associated with your account, email{" "}
            <a href="mailto:bhavya@vibeshub.ai">bhavya@vibeshub.ai</a>.
          </p>

          <h2>Changes to this policy</h2>
          <p>
            If we change what we collect or how we use it, we'll update this
            page and bump the effective date at the top.
          </p>
        </article>
      </main>

      <footer className="footer">
        <span>privacy policy</span>
        <span>vibeshub</span>
      </footer>
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- src/tests/routes/Privacy.test.tsx`

Expected: PASS — all four tests pass.

- [ ] **Step 6: Commit**

```bash
git add webapp/frontend/src/routes/Privacy.tsx \
        webapp/frontend/src/tests/routes/Privacy.test.tsx \
        webapp/frontend/src/routes/Privacy.module.css
git commit -m "Fill in the privacy policy content"
```

---

## Task 3: Style the page with Privacy.module.css

**Files:**
- Create (or overwrite): `webapp/frontend/src/routes/Privacy.module.css`

Add typographic styles for the prose article and the header. Reuse existing CSS custom properties from `src/styles/tokens.css` (e.g. `--text-strong`, `--text-muted`, `--border-subtle`, `--accent`, `--bg`, `--font-mono`) so the page picks up light/dark themes for free. Keep selectors local to the module — no global selectors.

- [ ] **Step 1: Write `Privacy.module.css`**

Create `webapp/frontend/src/routes/Privacy.module.css`:

```css
/* Privacy.module.css — typographic layout for the /privacy policy page.
   Local to the Privacy route; all selectors are class-scoped via CSS Modules. */

.privacy {
  max-width: 760px;
  margin: 0 auto;
  padding: 56px 24px 96px;
}

.header {
  margin-bottom: 40px;
  padding-bottom: 28px;
  border-bottom: 1px solid var(--border-subtle);
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 14px;
}

.title {
  font-size: 36px;
  line-height: 1.15;
  letter-spacing: -0.02em;
  color: var(--text-strong);
  margin: 0 0 10px;
}

.effective {
  color: var(--text-muted);
  font-size: 14px;
  margin: 0;
}

/* ---------- prose ---------- */

.prose {
  color: var(--text);
  font-size: 16px;
  line-height: 1.7;
}

.prose h2 {
  margin: 40px 0 12px;
  font-size: 20px;
  letter-spacing: -0.01em;
  color: var(--text-strong);
}

.prose h2:first-child {
  margin-top: 0;
}

.prose p {
  margin: 0 0 14px;
}

.prose ul {
  margin: 0 0 16px;
  padding-left: 22px;
}

.prose li {
  margin-bottom: 8px;
}

.prose li > strong {
  color: var(--text-strong);
}

.prose code {
  font-family: var(--font-mono);
  font-size: 0.92em;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--accent-soft, color-mix(in oklab, var(--accent) 12%, transparent));
  color: var(--text-strong);
}

.prose a {
  color: var(--accent-strong, var(--accent));
  text-decoration: underline;
  text-underline-offset: 2px;
}

.prose a:hover {
  text-decoration-thickness: 2px;
}
```

- [ ] **Step 2: Verify the tests still pass and the page builds**

Run: `npm test -- src/tests/routes/Privacy.test.tsx` then `npx tsc -b --noEmit`

Expected: tests pass; type-check clean.

- [ ] **Step 3: Commit**

```bash
git add webapp/frontend/src/routes/Privacy.module.css
git commit -m "Style the privacy policy page"
```

---

## Task 4: Repoint Landing page links to /privacy

**Files:**
- Modify: `webapp/frontend/src/routes/Landing.tsx`

Three changes — all in `Landing.tsx`. Use `Link` from `react-router-dom` (already imported there) for the new in-app navigations. The top-nav `<a href="#privacy">` stays as an in-page jump to the existing teaser section.

- [ ] **Step 1: Repoint the hero "Privacy & redaction" button**

Find this block inside the hero (search for `Privacy &amp; redaction`):

```tsx
<a
  className={`${styles.btn} ${styles.btnGhost}`}
  href="#privacy"
>
  Privacy &amp; redaction
</a>
```

Replace it with:

```tsx
<Link
  className={`${styles.btn} ${styles.btnGhost}`}
  to="/privacy"
>
  Privacy &amp; redaction
</Link>
```

- [ ] **Step 2: Repoint the footer "Privacy" link**

Find the footer block:

```tsx
<div className={styles.footerLinks}>
  <a href="https://github.com/Bhavya6187/vibeshub">GitHub</a>
  <a href="#trace">Live trace</a>
  <a href="#privacy">Privacy</a>
  <a href="#install">Install</a>
</div>
```

Replace the Privacy entry (and only that entry):

```tsx
<div className={styles.footerLinks}>
  <a href="https://github.com/Bhavya6187/vibeshub">GitHub</a>
  <a href="#trace">Live trace</a>
  <Link to="/privacy">Privacy</Link>
  <a href="#install">Install</a>
</div>
```

- [ ] **Step 3: Add a "Read the full policy" link inside the `#privacy` teaser**

Find the closing of the `<ul className={styles.privacyPoints}>` list inside the `<section className={styles.privacy} id="privacy">` block. Immediately after that closing `</ul>` (still inside the left column `<div>`), add:

```tsx
<p style={{ marginTop: 18 }}>
  <Link to="/privacy" className={styles.ghLink}>
    Read the full privacy policy →
  </Link>
</p>
```

(The `styles.ghLink` class is the same underlined link style already used elsewhere on the landing page.)

- [ ] **Step 4: Run the landing-page tests**

Run: `npm test -- src/tests/routes`

Expected: all route tests pass. (The existing landing tests don't assert on these specific links, so the change is non-breaking.)

- [ ] **Step 5: Type-check**

Run: `npx tsc -b --noEmit`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add webapp/frontend/src/routes/Landing.tsx
git commit -m "Point Landing page Privacy links to the /privacy route"
```

---

## Task 5: Final verification

**Files:** none modified.

- [ ] **Step 1: Run the full frontend test suite**

Run (from `webapp/frontend/`): `npm test`

Expected: all tests pass, including the four new Privacy tests.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: build completes with no errors. (`tsc -b` is part of the build script; this catches any type regressions.)

- [ ] **Step 3: Manual smoke check (optional but recommended)**

Run: `npm run dev`

In a browser at `http://localhost:5173/privacy`:
- The page renders with the topbar, the `Privacy` breadcrumb, the policy content, and a footer.
- The theme toggle switches light/dark and the page restyles correctly.
- The contact email link opens a `mailto:` composer.
- From the landing page (`/`), the hero "Privacy & redaction" button and the footer "Privacy" link navigate to `/privacy`. The teaser's "Read the full privacy policy →" link does too.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin add-privacy-policy-page
```

(Open a PR through your usual flow when ready.)
