# Homepage Digest Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the new trace digest feature (AI summary of every uploaded trace) on the vibeshub landing page, woven into existing sections with no new layout.

**Architecture:** Four copy/markup changes inside the existing landing route: digest rows added to the fake `vibeshub-bot` PR-comment card, a rewritten first Collaborate bullet, a touch-up of "How it works" step 03, and a digest clause added to the three SEO description surfaces. All driven by the spec at `docs/superpowers/specs/2026-06-09-homepage-digest-feature-design.md`.

**Tech Stack:** React 19 + TypeScript (Vite), CSS modules, Vitest + Testing Library.

**Branch:** `feature/homepage-digest` (already created; spec is committed on it).

**Working directory for all commands:** `/Users/bhavya/git/vibeshub/webapp/frontend`

**House rules that apply to every task:**
- User-facing strings must never contain an em-dash ("—"). Use commas, periods, or parentheses.
- Match the existing code style: CSS uses design tokens (`var(--text-muted)` etc.), copy is lowercase-calm, comments explain constraints only.

---

### Task 1: Rewrite the first Collaborate bullet to "Review starts from intent"

**Files:**
- Modify: `src/tests/routes/Landing.test.tsx:45`
- Modify: `src/routes/Landing.tsx:548-557` (first `<li>` of `styles.showoffUses`)

- [ ] **Step 1: Update the test assertion to the new bullet title**

In `src/tests/routes/Landing.test.tsx`, the test `"leads with team-collaboration messaging"` currently asserts the old bullet. Change line 45:

```tsx
    expect(screen.getByText(/Faster, deeper review/i)).toBeInTheDocument();
```

to:

```tsx
    expect(screen.getByText(/Review starts from intent/i)).toBeInTheDocument();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/routes/Landing.test.tsx`
Expected: FAIL — `Unable to find an element with the text: /Review starts from intent/i` in the test `leads with team-collaboration messaging`. The other three tests pass.

- [ ] **Step 3: Rewrite the bullet in Landing.tsx**

In `src/routes/Landing.tsx`, find the first `<li>` inside `<ul className={styles.showoffUses}>` (around line 548):

```tsx
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
```

Replace it with:

```tsx
                <li>
                  <span className={styles.mk}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>Review starts from intent.</strong> Every trace
                    lands with an AI digest, the ask, key decisions, and dead
                    ends, plus chapters that jump straight to the moment.
                    Reviewers get the story before the diff.
                  </span>
                </li>
```

The other four bullets stay untouched.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/routes/Landing.test.tsx`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tests/routes/Landing.test.tsx src/routes/Landing.tsx
git commit -m "Landing: rewrite first Collaborate bullet around the AI digest"
```

---

### Task 2: Add digest rows to the PR-comment mock card

**Files:**
- Modify: `src/tests/routes/Landing.test.tsx` (new test)
- Modify: `src/routes/Landing.tsx:505-522` (`styles.prBody`, between `prTitle` and `prStats`)
- Modify: `src/routes/Landing.module.css` (new classes after `.prTitle`, before `.prStats` at ~line 1724)

- [ ] **Step 1: Write the failing test**

Add to `src/tests/routes/Landing.test.tsx`, inside the `describe("Landing", ...)` block after the `"leads with team-collaboration messaging"` test:

```tsx
  it("shows the AI digest rows in the PR-comment mock", () => {
    renderPage();
    expect(screen.getByText("Ask")).toBeInTheDocument();
    expect(screen.getByText("Key decisions")).toBeInTheDocument();
    expect(screen.getByText("Dead ends")).toBeInTheDocument();
    expect(
      screen.getByText(/Reuse digest anchors as the nav spine/i),
    ).toBeInTheDocument();
  });
```

Note: `getByText("Ask")` with a string matches only elements whose entire text is exactly "Ask", so the label spans don't collide with the longer bullet copy that mentions "the ask" elsewhere.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/routes/Landing.test.tsx`
Expected: FAIL — `Unable to find an element with the text: Ask` in the new test. The other 4 tests pass.

- [ ] **Step 3: Add the digest rows to the card JSX**

In `src/routes/Landing.tsx`, inside the `styles.prBody` div (around line 505), between the `prTitle` div and the `prStats` div:

```tsx
              <div className={styles.prBody}>
                <div className={styles.prTitle}>
                  Claude Code session for this PR
                </div>
                <div className={styles.prStats}>
```

becomes:

```tsx
              <div className={styles.prBody}>
                <div className={styles.prTitle}>
                  Claude Code session for this PR
                </div>
                {/* Mirrors the digest rows build_comment_body posts on real PRs. */}
                <div className={styles.prDigest}>
                  <div className={styles.prDigestRow}>
                    <span className={styles.prDigestKey}>Ask</span>
                    <span className={styles.prDigestVal}>
                      Add chapter navigation to the trace viewer
                    </span>
                  </div>
                  <div className={styles.prDigestRow}>
                    <span className={styles.prDigestKey}>Key decisions</span>
                    <span className={styles.prDigestVal}>
                      Reuse digest anchors as the nav spine
                    </span>
                  </div>
                  <div className={styles.prDigestRow}>
                    <span className={styles.prDigestKey}>Dead ends</span>
                    <span className={styles.prDigestVal}>
                      IntersectionObserver thrashed, switched to scroll math
                    </span>
                  </div>
                </div>
                <div className={styles.prStats}>
```

- [ ] **Step 4: Add the CSS for the digest rows**

In `src/routes/Landing.module.css`, insert after the `.prTitle` rule (ends at line ~1723) and before `.prStats`:

```css
.prDigest {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}
.prDigestRow {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  font-size: 13px;
}
.prDigestKey {
  flex: none;
  width: 98px;
  font: 500 11px var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
.prDigestVal {
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

(`width: 98px` fits "KEY DECISIONS" in 11px mono; all three labels align as a column. `min-width: 0` lets the ellipsis engage inside the flex column.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/tests/routes/Landing.test.tsx`
Expected: PASS (all 5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/tests/routes/Landing.test.tsx src/routes/Landing.tsx src/routes/Landing.module.css
git commit -m "Landing: show AI digest rows in the PR-comment mock"
```

---

### Task 3: Mention the digest in "How it works" step 03

**Files:**
- Modify: `src/tests/routes/Landing.test.tsx` (extend the digest test)
- Modify: `src/routes/Landing.tsx:298-310` (step 03 `heroFlowText`)

- [ ] **Step 1: Extend the digest test with a step-03 assertion**

In `src/tests/routes/Landing.test.tsx`, add to the end of the `"shows the AI digest rows in the PR-comment mock"` test body:

```tsx
    expect(
      screen.getByText(/start from the story, not message one/i),
    ).toBeInTheDocument();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/routes/Landing.test.tsx`
Expected: FAIL — `Unable to find an element with the text: /start from the story, not message one/i`.

- [ ] **Step 3: Update the step 03 copy**

In `src/routes/Landing.tsx`, step 03 of the hero flow (around line 304):

```tsx
                    <p className={styles.heroFlowText}>
                      The trace uploads and the PR updates with the link,
                      automatically. Reviewers see how you built it before they
                      read the diff.
                    </p>
```

becomes:

```tsx
                    <p className={styles.heroFlowText}>
                      The trace uploads and the PR comment arrives with an AI
                      digest and the link, automatically. Reviewers start from
                      the story, not message one of 257.
                    </p>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/routes/Landing.test.tsx`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tests/routes/Landing.test.tsx src/routes/Landing.tsx
git commit -m "Landing: mention the AI digest in how-it-works step 03"
```

---

### Task 4: Add the digest clause to the three SEO description surfaces

**Files:**
- Modify: `src/routes/Landing.tsx:51-52` (`LANDING_JSONLD.description`)
- Modify: `src/routes/Landing.tsx:128` (`SeoHead` `description` prop)
- Modify: `index.html:57` (baked JSON-LD `description`)

No unit test covers head metadata; verification is the grep in Step 4. The
constraint: the two JSON-LD descriptions (Landing.tsx + index.html) must stay
character-identical; the SeoHead prop keeps its own opening clause.

- [ ] **Step 1: Update LANDING_JSONLD.description in Landing.tsx**

```ts
  description:
    "Turn your Claude Code and Codex sessions, including every subagent they spawn, into shareable, replayable traces. Public and private viewer with GitHub-mirrored access and automatic secret redaction.",
```

becomes:

```ts
  description:
    "Turn your Claude Code and Codex sessions, including every subagent they spawn, into shareable, replayable traces, each with an AI digest of the session. Public and private viewer with GitHub-mirrored access and automatic secret redaction.",
```

- [ ] **Step 2: Update the SeoHead description prop in Landing.tsx**

```tsx
        description="Your Claude Code and Codex sessions, including every subagent they spawn, become shareable, replayable traces. Public and private viewer with GitHub-mirrored access and automatic secret redaction."
```

becomes:

```tsx
        description="Your Claude Code and Codex sessions, including every subagent they spawn, become shareable, replayable traces, each with an AI digest of the session. Public and private viewer with GitHub-mirrored access and automatic secret redaction."
```

- [ ] **Step 3: Update the baked JSON-LD description in index.html**

In `index.html` line 57:

```html
        "description": "Turn your Claude Code and Codex sessions, including every subagent they spawn, into shareable, replayable traces. Public and private viewer with GitHub-mirrored access and automatic secret redaction.",
```

becomes:

```html
        "description": "Turn your Claude Code and Codex sessions, including every subagent they spawn, into shareable, replayable traces, each with an AI digest of the session. Public and private viewer with GitHub-mirrored access and automatic secret redaction.",
```

Do NOT touch the `<meta name="description">` tag at index.html line 25-28 or
the og:/twitter: tags; they are out of scope per the spec.

- [ ] **Step 4: Verify the three surfaces are updated and the JSON-LD pair is identical**

Run:
```bash
grep -c "each with an AI digest of the session" src/routes/Landing.tsx index.html
```
Expected output:
```
src/routes/Landing.tsx:2
index.html:1
```

Run:
```bash
grep -o 'Turn your Claude Code and Codex sessions[^"]*' src/routes/Landing.tsx index.html | sort | uniq -c
```
Expected: a single distinct line with count 2 (the two JSON-LD descriptions are character-identical).

- [ ] **Step 5: Commit**

```bash
git add src/routes/Landing.tsx index.html
git commit -m "Landing SEO: mention the AI digest in all three description surfaces"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole frontend test suite**

Run: `npm test`
Expected: all test files pass, no new failures anywhere (Home, TraceView, etc. untouched).

- [ ] **Step 2: Typecheck + production build**

Run: `npm run build`
Expected: `tsc -b` clean, vite build succeeds.

- [ ] **Step 3: Em-dash sweep over the touched files**

Run:
```bash
grep -n "—" src/routes/Landing.tsx index.html || echo "clean"
```
Expected: the only hits are the pre-existing og:/twitter: description tags in index.html (lines ~36 and ~45, out of scope); no hits in Landing.tsx. If any new copy from Tasks 1-4 contains an em-dash, fix it before proceeding.

- [ ] **Step 4: Visual pass**

Run: `npm run dev`, open http://localhost:5173/ in light and dark themes. Check:
- The PR-comment card shows the three digest rows, labels aligned, values ellipsizing (narrow the window to confirm).
- The Collaborate list still has five bullets and comfortable rhythm.
- Step 03 copy reads correctly in the hero.

- [ ] **Step 5: Commit anything outstanding**

Nothing should be outstanding; if a fix was needed in Steps 1-4, commit it:

```bash
git add -A && git commit -m "Landing: digest homepage polish from verification pass"
```
