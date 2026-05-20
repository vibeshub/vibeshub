# Real Trace in Homepage Hero — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the homepage hero's hand-built fake PR comment and fake trace card with a real PR comment and a real screenshot of an actual vibeshub trace, linked to the live trace URL.

**Architecture:** A committed Playwright script captures the live trace page (PR #31) in light and dark themes into `src/assets/`. `Landing.tsx` swaps its mock JSX for the real comment plus an `<img>` (theme-swapped) wrapped in a link to the live trace. Dead mock-only CSS is removed from `Landing.module.css`.

**Tech Stack:** React + TypeScript, Vite, CSS Modules, Playwright (already installed for e2e).

**Spec:** `docs/superpowers/specs/2026-05-20-homepage-real-trace-design.md`

**Featured trace:** PR #31 — `https://vibeshub.ai/Bhavya6187/vibeshub/pull/31/66jxlxariq`

All paths below are relative to the repo root. All `npm` commands run from `webapp/frontend/`.

---

## Task 1: Capture script + screenshot assets

**Files:**
- Create: `webapp/frontend/scripts/capture-hero-trace.mjs`
- Create (generated): `webapp/frontend/src/assets/hero-trace-light.png`
- Create (generated): `webapp/frontend/src/assets/hero-trace-dark.png`

- [ ] **Step 1: Write the capture script**

Create `webapp/frontend/scripts/capture-hero-trace.mjs`:

```js
// Captures the homepage hero trace screenshots from the live vibeshub.ai
// trace page, in both themes, into src/assets/. Those PNGs are committed and
// hand-captured — re-run this script if the trace viewer's design changes:
//
//   node scripts/capture-hero-trace.mjs
//
// Requires the Playwright chromium browser (already installed for e2e tests).
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const TRACE_URL = "https://vibeshub.ai/Bhavya6187/vibeshub/pull/31/66jxlxariq";

// Viewport sized to frame the trace viewer's content with minimal gutter.
// Bump these if a capture looks cramped or is cut off awkwardly.
const WIDTH = 1180;
const HEIGHT = 860;

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, "..", "src", "assets");
mkdirSync(assetsDir, { recursive: true });

async function capture(theme) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  // The viewer reads its theme from localStorage on mount.
  await context.addInitScript((t) => {
    localStorage.setItem("vibeshub.theme", t);
  }, theme);
  const page = await context.newPage();
  await page.goto(TRACE_URL, { waitUntil: "networkidle" });
  await page.waitForSelector(".vibeshub-viewer", { timeout: 30_000 });
  await page.waitForTimeout(1200);
  const out = join(assetsDir, `hero-trace-${theme}.png`);
  await page.screenshot({ path: out });
  await browser.close();
  console.log(`wrote ${out}`);
}

await capture("light");
await capture("dark");
```

- [ ] **Step 2: Run the capture script**

Run (from `webapp/frontend/`): `node scripts/capture-hero-trace.mjs`
Expected: prints `wrote .../hero-trace-light.png` and `wrote .../hero-trace-dark.png`; both files exist.

If it errors with a missing browser, run `npx playwright install chromium` first, then re-run.

- [ ] **Step 3: Visually verify the captures**

Use the Read tool on `webapp/frontend/src/assets/hero-trace-light.png` and `hero-trace-dark.png`.
Expected: each shows the trace viewer page (its topbar, the trace title/meta, and the start of the conversation thread) with no broken layout. Light capture is light-themed, dark capture is dark-themed.
If a capture has excessive empty gutter or content is cut off mid-element, adjust `WIDTH` / `HEIGHT` in the script and re-run Step 2.

- [ ] **Step 4: Commit**

```bash
git add webapp/frontend/scripts/capture-hero-trace.mjs webapp/frontend/src/assets/hero-trace-light.png webapp/frontend/src/assets/hero-trace-dark.png
git commit -m "Add hero trace screenshots + capture script"
```

---

## Task 2: Replace the hero visual in Landing.tsx + Landing.module.css

**Files:**
- Modify: `webapp/frontend/src/routes/Landing.tsx`
- Modify: `webapp/frontend/src/routes/Landing.module.css`

- [ ] **Step 1: Add imports and constants to Landing.tsx**

After the existing `import styles from "./Landing.module.css";` line, add:

```tsx
import heroTraceLight from "../assets/hero-trace-light.png";
import heroTraceDark from "../assets/hero-trace-dark.png";
```

After the `INSTALL_COPY` constant (just before `function useCopy()`), add:

```tsx
// The real Claude Code trace featured in the hero — PR #31's trace.
// The screenshots in ../assets are hand-captured by scripts/capture-hero-trace.mjs;
// re-capture them if the trace viewer's design changes.
const HERO_TRACE_URL =
  "https://vibeshub.ai/Bhavya6187/vibeshub/pull/31/66jxlxariq";
const HERO_TRACE_LABEL =
  "vibeshub.ai/Bhavya6187/vibeshub/pull/31/66jxlxariq";
```

- [ ] **Step 2: Pick the theme-matched screenshot inside the component**

In `Landing()`, the line `const { resolved, toggle } = useTheme();` already exists. Immediately after the `const { copied, copy } = useCopy();` line, add:

```tsx
  const heroShot = resolved === "dark" ? heroTraceDark : heroTraceLight;
```

- [ ] **Step 3: Replace the heroVisual JSX block**

In `Landing.tsx`, replace the entire block that currently starts with the comment `{/* right: stylized illustration of a PR bot comment + trace */}` and the `<div className={styles.heroVisual} aria-hidden="true">` element, through its matching closing `</div>` (the fake `ghComment` + `heroArrow` + `traceCard` — roughly lines 150–318), with:

```tsx
            {/* right: a real PR comment + a screenshot of the trace it links to */}
            <div className={styles.heroVisual}>
              <div className={styles.ghComment}>
                <div className={styles.ghHead}>
                  <img
                    className={styles.ghAvatar}
                    src="https://github.com/Bhavya6187.png?size=64"
                    alt=""
                    width={22}
                    height={22}
                  />
                  <span className={styles.ghUser}>Bhavya6187</span>
                  <span className={styles.ghMeta}>commented on PR #31</span>
                </div>
                <div className={styles.ghBody}>
                  Claude Code trace for this PR:{" "}
                  <a className={styles.ghLink} href={HERO_TRACE_URL}>
                    {HERO_TRACE_LABEL}
                  </a>
                  <br />
                  <span style={{ color: "var(--text-muted)" }}>
                    Uploaded by the PR author.
                  </span>
                </div>
              </div>

              <div className={styles.heroArrow} aria-hidden="true">
                <svg
                  viewBox="0 0 18 36"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 2v30" strokeDasharray="2 3" />
                  <path d="M3 27l6 6 6-6" />
                </svg>
              </div>

              <a className={styles.traceCard} href={HERO_TRACE_URL}>
                <span className={styles.tracePin}>live trace</span>
                <div className={styles.traceHead}>
                  <div className={styles.dots}>
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className={styles.urlChip}>{HERO_TRACE_LABEL}</div>
                </div>
                <img
                  className={styles.traceShot}
                  src={heroShot}
                  alt="vibeshub trace viewer showing the Claude Code session that built pull request #31"
                />
              </a>
            </div>
```

- [ ] **Step 4: Add and adjust CSS in Landing.module.css**

Add a new `.traceShot` rule (place it right after the `.traceHead` / `.dots` rules, before `.tracePin`):

```css
.traceShot {
  display: block;
  width: 100%;
  height: auto;
}
```

Change the `.traceCard` rule — it is now an `<a>` element, so it needs explicit block display and no underline. Update it to start with:

```css
.traceCard {
  display: block;
  text-decoration: none;
  position: relative;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow:
    0 1px 0 oklch(0 0 0 / 0.04),
    0 20px 40px -16px oklch(0.4 0.04 60 / 0.18),
    0 4px 12px oklch(0.4 0.02 60 / 0.06);
  overflow: hidden;
  max-width: 540px;
  margin-left: auto;
  transition:
    transform 140ms ease,
    box-shadow 140ms ease;
}
.traceCard:hover {
  transform: translateY(-2px);
}
```

Update `.ghAvatar` — it now styles an `<img>`. Add `object-fit: cover;` to the existing rule (keep the other properties; the gradient background is a harmless fallback):

```css
.ghAvatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: linear-gradient(
    135deg,
    oklch(0.68 0.13 50),
    oklch(0.55 0.1 290)
  );
  display: grid;
  place-items: center;
  color: oklch(0.98 0 0);
  font: 600 11px var(--font-mono);
  object-fit: cover;
}
```

Update `.ghLink` — it is now an `<a>`; suppress the default underline so only its dotted `border-bottom` shows. Add `text-decoration: none;` to the existing rule:

```css
.ghLink {
  color: var(--accent-strong);
  border-bottom: 1px dotted
    color-mix(in oklab, var(--accent-strong) 60%, transparent);
  font-family: var(--font-mono);
  font-size: 13px;
  text-decoration: none;
}
```

- [ ] **Step 5: Delete dead mock-only CSS from Landing.module.css**

Delete the entire contiguous block of rules that styled the deleted fake trace body — from the `.traceBody` rule through the `.tlGap` rule (originally lines ~488–649). These classes are: `.traceBody`, `.traceH1`, `.traceMeta`, `.traceMeta .crumb`, `.traceMeta .sep`, `.userPromptCard`, `.upAvatar`, `.upBody`, `.upMeta`, `.upText`, `.toolCard`, `.toolHead`, `.toolDot`, `.toolName`, `.toolArgs`, `.toolDur`, `.toolBash .toolDot`, `.toolRead .toolDot`, `.toolWrite .toolDot`, `.toolAgent .toolDot`, `.toolBody`, `.toolBody .dim`, `.toolBody .ok`, `.toolBody .err`, `.timeline`, `.timelineSeg`, `.tlBash`, `.tlRead`, `.tlWrite`, `.tlAgent`, `.tlGap`.

Do NOT delete `.tracePin` (still used), `.traceHead`, `.urlChip`, `.dots` (still used), or any `.redact .*` / `.heroInstall .*` rule. `.redact .dim` is a separate rule and must stay.

- [ ] **Step 6: Verify the dead classes are truly gone**

Run (from repo root):

```bash
grep -nE 'styles\.(traceBody|traceH1|traceMeta|crumb|sep|userPromptCard|upAvatar|upBody|upMeta|upText|toolCard|toolBash|toolWrite|toolRead|toolAgent|toolHead|toolDot|toolName|toolArgs|toolDur|toolBody|timeline|timelineSeg|tlBash|tlRead|tlWrite|tlAgent|tlGap|err|ok)\b' webapp/frontend/src/routes/Landing.tsx
```

Expected: no output (no JSX still references a removed class).

- [ ] **Step 7: Typecheck and build**

Run (from `webapp/frontend/`): `npm run build`
Expected: PASS — `tsc -b` reports no errors and `vite build` completes. A failure here usually means a leftover reference to a removed class or a bad import path.

- [ ] **Step 8: Commit**

```bash
git add webapp/frontend/src/routes/Landing.tsx webapp/frontend/src/routes/Landing.module.css
git commit -m "Show a real trace in the homepage hero"
```

---

## Task 3: Verify the rendered homepage

**Files:** none (verification only)

- [ ] **Step 1: Run the unit tests**

Run (from `webapp/frontend/`): `npm test`
Expected: PASS — existing vitest suite is green (this change touches no tested module, but confirm nothing broke).

- [ ] **Step 2: Capture the landing page in both themes**

Start the dev server in the background (from `webapp/frontend/`): `npm run dev`

Create a temporary file `/tmp/shoot-landing.mjs`:

```js
import { chromium } from "@playwright/test";
const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  await ctx.addInitScript((t) => {
    localStorage.setItem("vibeshub.theme", t);
  }, theme);
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `/tmp/landing-${theme}.png` });
}
await browser.close();
console.log("done");
```

Run (from `webapp/frontend/`): `node /tmp/shoot-landing.mjs`
Then stop the dev server.

- [ ] **Step 3: Visually confirm the result**

Use the Read tool on `/tmp/landing-light.png` and `/tmp/landing-dark.png`. Confirm:
- The hero's right column shows the real PR comment (`Bhavya6187` avatar, `commented on PR #31`, the real trace link) above the trace card.
- The trace card shows the real trace screenshot, framed by the window dots, the `live trace` pin, and the URL chip reading `vibeshub.ai/Bhavya6187/vibeshub/pull/31/66jxlxariq`.
- The light page shows the light screenshot; the dark page shows the dark screenshot (theme swap works).
- No leftover fake content ("feross", "PR #482", "Fix flake in retriever cache TTL test", invented tool cards).

If anything is wrong, fix `Landing.tsx` / `Landing.module.css`, re-run Step 2, and amend the Task 2 commit.

- [ ] **Step 4: Clean up**

```bash
rm -f /tmp/shoot-landing.mjs /tmp/landing-light.png /tmp/landing-dark.png
```

---

## Notes

- The screenshots are static: they will not reflect future trace-viewer redesigns. `scripts/capture-hero-trace.mjs` exists so a re-capture is one command. This trade-off was accepted in the spec.
- `Landing.tsx` already destructures `resolved` from `useTheme()`, so no new theme wiring is needed — only the `heroShot` selection line.
