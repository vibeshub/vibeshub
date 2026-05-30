// gen-og-vibeviewer.mjs — regenerate public/og-vibeviewer.png, the social
// link-preview card for /vibeviewer (1200x630, the OG/Twitter standard).
//
//   node scripts/gen-og-vibeviewer.mjs
//
// Why a script (and not a hand-drawn PNG): it keeps the asset on-brand and
// reproducible. The card is plain HTML/CSS rendered by headless Chrome, so it
// uses the real design tokens (native oklch() colors, copied from
// src/styles/tokens.css) and the real Geist fonts (inlined from node_modules
// as base64 so the render doesn't depend on system-installed fonts). If the
// brand shifts, edit the template here and re-run rather than eyeballing a
// bitmap.
//
// No new npm dependency: the output PNG is committed like og-default.png, so
// CI never regenerates it. This script is a dev convenience that shells out to
// a locally installed Chrome. Set CHROME_BIN to override the binary path.

import { readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

const execFileP = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const OUT = resolve(root, "public/og-vibeviewer.png");
const TMP_HTML = resolve(tmpdir(), "og-vibeviewer.html");

const SANS_WOFF2 = resolve(
  root,
  "node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
);
const MONO_WOFF2 = resolve(
  root,
  "node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2",
);

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) {
    throw new Error(
      "No Chrome/Chromium found. Set CHROME_BIN to your browser binary.",
    );
  }
  return hit;
}

async function dataUri(path) {
  const b64 = (await readFile(path)).toString("base64");
  return `data:font/woff2;base64,${b64}`;
}

const [sansUri, monoUri] = await Promise.all([
  dataUri(SANS_WOFF2),
  dataUri(MONO_WOFF2),
]);

// A faux trace row for the product mock. `accent` tints the leading tool bar.
function row(accent, w1, w2) {
  return `
    <div class="row">
      <span class="bar" style="background:${accent}"></span>
      <span class="lines">
        <span class="ln" style="width:${w1}px"></span>
        <span class="ln dim" style="width:${w2}px"></span>
      </span>
    </div>`;
}

const html = `<!doctype html>
<html><head><meta charset="utf-8"/>
<style>
  @font-face {
    font-family: "Geist Variable";
    font-style: normal; font-weight: 100 900;
    src: url(${sansUri}) format("woff2");
  }
  @font-face {
    font-family: "Geist Mono Variable";
    font-style: normal; font-weight: 100 900;
    src: url(${monoUri}) format("woff2");
  }
  :root {
    --bg: oklch(0.985 0.004 75);
    --bg-elevated: oklch(1 0 0);
    --bg-inset: oklch(0.955 0.006 75);
    --text-strong: oklch(0.12 0.012 75);
    --text-muted: oklch(0.50 0.012 75);
    --text-faint: oklch(0.62 0.010 75);
    --border: oklch(0.91 0.006 75);
    --border-strong: oklch(0.84 0.008 75);
    --accent: oklch(0.66 0.13 50);
    --accent-soft: oklch(0.95 0.04 65);
    --accent-strong: oklch(0.56 0.14 45);
    --tool-bash: oklch(0.60 0.10 150);
    --sans: "Geist Variable", system-ui, sans-serif;
    --mono: "Geist Mono Variable", monospace;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    position: relative; overflow: hidden;
    font-family: var(--sans);
    background: var(--bg);
    -webkit-font-smoothing: antialiased;
  }
  /* dotted backdrop, masked to fade toward the right + bottom */
  .dots {
    position: absolute; inset: 0;
    background-image: radial-gradient(circle at 1px 1px,
      oklch(0.5 0.01 75 / 0.10) 1.5px, transparent 0);
    background-size: 26px 26px;
    -webkit-mask-image: radial-gradient(ellipse 70% 80% at 28% 32%,
      #000 30%, transparent 75%);
  }
  .glow {
    position: absolute; inset: 0;
    background: radial-gradient(ellipse 50% 55% at 30% 0%,
      var(--accent-soft) 0%, transparent 70%);
  }
  .edge { position: absolute; inset: 0; border: 2px solid var(--border); }
  .accentbar {
    position: absolute; left: 0; right: 0; bottom: 0; height: 12px;
    background: linear-gradient(90deg, var(--accent), var(--accent-strong));
  }
  .pad { position: relative; padding: 74px 80px; height: 100%; }

  /* logo lockup */
  .brand { display: flex; align-items: center; gap: 16px; }
  .mark {
    width: 52px; height: 52px; border-radius: 13px;
    background: linear-gradient(145deg, #d07843, #a84a28);
    display: grid; place-items: center;
    color: #fff; font-weight: 700; font-size: 31px;
    box-shadow: 0 6px 16px -6px oklch(0.55 0.14 45 / 0.6);
  }
  .brand .name { font-weight: 700; font-size: 29px; color: var(--text-strong); }
  .brand .crumb { font-family: var(--mono); font-size: 23px; color: var(--text-faint); }

  /* eyebrow */
  .eyebrow {
    display: inline-flex; align-items: center; gap: 10px;
    margin-top: 54px; padding: 9px 16px;
    border: 1.5px solid var(--border); border-radius: 999px;
    background: var(--bg-elevated);
    font-family: var(--mono); font-size: 14px; font-weight: 600;
    letter-spacing: 0.16em; color: var(--text-muted);
    box-shadow: 0 1px 2px oklch(0.5 0 0 / 0.05);
  }
  .eyebrow .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); }

  h1 {
    margin-top: 26px; max-width: 620px;
    font-size: 68px; line-height: 1.04; letter-spacing: -0.035em;
    font-weight: 700; color: var(--text-strong);
  }
  h1 .hl {
    color: var(--accent-strong); font-style: italic; font-weight: 500;
    font-synthesis: oblique;
  }
  .sub {
    margin-top: 24px; max-width: 560px;
    font-size: 25px; line-height: 1.5; color: var(--text-muted);
  }
  .chips { display: flex; gap: 12px; margin-top: 36px; }
  .chip {
    display: inline-flex; align-items: center; gap: 10px;
    padding: 9px 16px; border-radius: 10px;
    background: var(--bg-inset); border: 1.5px solid var(--border);
    font-family: var(--mono); font-size: 15px; color: var(--text-muted);
  }
  .chip .d { width: 9px; height: 9px; border-radius: 50%; }

  /* product mock: a "live trace" card, peeking from the right edge */
  .card {
    position: absolute; top: 150px; right: 46px; width: 430px;
    background: var(--bg-elevated); border: 1.5px solid var(--border);
    border-radius: 20px; overflow: hidden;
    box-shadow: 0 30px 60px -28px oklch(0.4 0.04 60 / 0.45);
  }
  .card .head {
    display: flex; align-items: center; gap: 14px;
    padding: 18px 20px; border-bottom: 1.5px solid var(--border);
  }
  .check {
    width: 34px; height: 34px; border-radius: 50%; flex: none;
    background: var(--tool-bash); display: grid; place-items: center;
    box-shadow: 0 0 0 4px color-mix(in oklab, var(--tool-bash) 18%, transparent);
  }
  .check svg { width: 17px; height: 17px; }
  .ttl { flex: 1; }
  .ttl .t { font-weight: 600; font-size: 18px; color: var(--text-strong); }
  .ttl .m { font-family: var(--mono); font-size: 13px; color: var(--text-muted); margin-top: 3px; }
  .badge {
    font-family: var(--mono); font-size: 12px; font-weight: 600;
    letter-spacing: 0.06em; padding: 5px 9px; border-radius: 999px;
    color: var(--tool-bash);
    background: color-mix(in oklab, var(--tool-bash) 13%, var(--bg-elevated));
    border: 1px solid color-mix(in oklab, var(--tool-bash) 24%, transparent);
  }
  .body { padding: 22px 20px 26px; display: flex; flex-direction: column; gap: 20px; }
  .row { display: flex; align-items: center; gap: 14px; }
  .bar { width: 6px; height: 34px; border-radius: 3px; flex: none; }
  .lines { display: flex; flex-direction: column; gap: 8px; }
  .ln { height: 9px; border-radius: 5px; background: var(--border-strong); display: block; }
  .ln.dim { height: 8px; background: var(--border); }
</style></head>
<body>
  <div class="dots"></div>
  <div class="glow"></div>
  <div class="pad">
    <div class="brand">
      <span class="mark">v</span>
      <span class="name">vibeshub</span>
      <span class="crumb">/ vibeviewer</span>
    </div>

    <div class="eyebrow"><span class="dot"></span>NO ACCOUNT NEEDED</div>

    <h1>Your vibe coding sessions, <span class="hl">visualized.</span></h1>
    <div class="sub">Drop a Claude Code transcript and get a clean, replayable, shareable trace in seconds.</div>

    <div class="chips">
      <span class="chip"><span class="d" style="background:var(--accent)"></span>ready in seconds</span>
      <span class="chip"><span class="d" style="background:var(--accent-strong)"></span>instant public link</span>
      <span class="chip"><span class="d" style="background:var(--tool-bash)"></span>secrets redacted</span>
    </div>
  </div>

  <div class="card">
    <div class="head">
      <span class="check"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12 5 5L20 6"/></svg></span>
      <span class="ttl"><div class="t">Your trace is live</div><div class="m">session.jsonl · 257 msgs</div></span>
      <span class="badge">PUBLIC</span>
    </div>
    <div class="body">
      ${row("var(--accent)", 250, 180)}
      ${row("var(--tool-bash)", 200, 150)}
      ${row("var(--accent-strong)", 270, 130)}
      ${row("var(--text-faint)", 170, 210)}
    </div>
  </div>

  <div class="edge"></div>
  <div class="accentbar"></div>
</body></html>`;

await writeFile(TMP_HTML, html);

const chrome = findChrome();
await execFileP(chrome, [
  "--headless",
  "--disable-gpu",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "--default-background-color=00000000",
  "--window-size=1200,630",
  `--screenshot=${OUT}`,
  `file://${TMP_HTML}`,
]);

await unlink(TMP_HTML).catch(() => {});
const bytes = (await readFile(OUT)).length;
console.log(`wrote ${OUT} (${bytes} bytes)`);
