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
