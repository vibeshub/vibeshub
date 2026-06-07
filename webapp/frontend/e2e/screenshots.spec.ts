// Captures the product screenshots embedded in the blog post.
// Run with: npx playwright test --config=e2e/playwright.config.ts screenshots
//
// Everything is driven against mocked API routes + the sample fixture, so the
// shots are reproducible and never touch live or private data. Light theme is
// forced via colorScheme so the figures sit cleanly on the article page.
import { test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "../public/blog");
const SAMPLE = readFileSync(
  join(__dirname, "../src/tests/fixtures/sample-session.jsonl"),
  "utf-8",
);

test.use({ colorScheme: "light", viewport: { width: 1440, height: 960 } });

// ---- shot 1: the trace viewer (prompts + tool cards + reasoning) ----

const viewerTrace = {
  trace_id: "00000000-0000-0000-0000-000000000001",
  short_id: "abc1234567",
  owner_login: "jordan",
  repo_full_name: "acme/web",
  pr_number: 482,
  pr_url: "https://github.com/acme/web/pull/482",
  pr_title: "Add startup credential smoke-check",
  title: "Add startup credential smoke-check",
  platform: "claude-code",
  byte_size: SAMPLE.length,
  message_count: 257,
  created_at: "2026-06-05T18:00:00Z",
  is_private: false,
  agent_count: 0,
  agents: [],
};

test("trace viewer", async ({ page }) => {
  await page.route("**/api/traces/acme/web/pull/482", (route) =>
    route.fulfill({ json: { traces: [viewerTrace] } }),
  );
  await page.route("**/api/traces/abc1234567", (route) =>
    route.fulfill({ json: viewerTrace }),
  );
  await page.route("**/api/traces/abc1234567/raw", (route) =>
    route.fulfill({ status: 200, contentType: "text/plain", body: SAMPLE }),
  );

  await page.goto("/acme/web/pull/482/abc1234567");
  await page
    .getByRole("heading", { name: "Add startup credential smoke-check" })
    .waitFor();
  // Tool cards may be nested in collapsed groups; wait if present, else proceed.
  await page
    .locator(".tool-card, .tool-group-head")
    .first()
    .waitFor({ timeout: 8000 })
    .catch(() => {});
  // Let fonts settle, then capture the top of the trace (hero + rail).
  await page.waitForTimeout(500);
  await page.screenshot({
    path: join(OUT, "trace-viewer.png"),
    clip: { x: 0, y: 0, width: 1440, height: 960 },
  });
});

// ---- shot 2: the PR comment vibeshub posts (the landing share card) ----

test("pr comment", async ({ page }) => {
  // The landing page fetches repo overview; let it degrade, the card is static.
  await page.route("**/api/repos/**", (route) =>
    route.fulfill({ json: repoOverview }),
  );
  await page.goto("/");
  const card = page.locator('[class*="shareCard"]');
  await card.waitFor();
  await page.waitForTimeout(300);
  await card.screenshot({ path: join(OUT, "pr-comment.png") });
});

// ---- shot 3: the searchable archive (browse section) ----

const t = (
  short_id: string,
  pr_number: number,
  pr_title: string,
  owner_login: string,
  platform: string,
  message_count: number,
  byte_size: number,
  created_at: string,
) => ({
  trace_id: `00000000-0000-0000-0000-0000000000${short_id.slice(0, 2)}`,
  short_id,
  owner_login,
  repo_full_name: "vibeshub/vibeshub",
  pr_number,
  pr_url: `https://github.com/vibeshub/vibeshub/pull/${pr_number}`,
  pr_title,
  title: pr_title,
  platform,
  byte_size,
  message_count,
  created_at,
  is_private: false,
  agent_count: 0,
  agents: [],
});

const repoOverview = {
  owner: "vibeshub",
  repo: "vibeshub",
  repo_full_name: "vibeshub/vibeshub",
  stats: {
    trace_count: 128,
    pr_count: 96,
    contributor_count: 7,
    message_count: 41200,
    byte_size: 58_000_000,
    last_trace_at: "2026-06-05T20:30:00Z",
  },
  contributors: [
    { login: "bhavya", trace_count: 41 },
    { login: "jordan", trace_count: 23 },
    { login: "mira", trace_count: 18 },
    { login: "devon", trace_count: 14 },
    { login: "sasha", trace_count: 9 },
  ],
  traces: [
    t("7ntgpt45el", 112, "Add Claude Code / Codex toggle to hero install pane", "bhavya", "claude-code", 257, 312_000, "2026-06-05T20:30:00Z"),
    t("8m2plq9xqr", 111, "Split landing into a standalone Pick the workflow section", "jordan", "codex", 184, 221_000, "2026-06-05T16:10:00Z"),
    t("q4k1z7vd2p", 108, "Add Cursor marketplace plugin generator", "mira", "claude-code", 312, 402_000, "2026-06-04T22:05:00Z"),
    t("la9c3mn8wt", 109, "Document Cursor and Codex support in the README", "devon", "claude-code", 96, 88_000, "2026-06-04T11:40:00Z"),
    t("z0p7rk5e1n", 104, "Gate private-repo traces on viewer GitHub access", "bhavya", "codex", 203, 264_000, "2026-06-03T19:25:00Z"),
    t("hv2t6yqw9d", 101, "Redact high-entropy tokens in the second server pass", "sasha", "claude-code", 141, 173_000, "2026-06-02T09:15:00Z"),
  ],
};

test("archive", async ({ page }) => {
  await page.route("**/api/repos/**", (route) =>
    route.fulfill({ json: repoOverview }),
  );
  await page.goto("/#browse");
  const section = page.locator("#browse");
  await section.scrollIntoViewIfNeeded();
  // Wait for real rows (not skeletons) to land.
  await page.getByText("Add Claude Code / Codex toggle").first().waitFor();
  await page.waitForTimeout(400);
  await section.screenshot({ path: join(OUT, "archive.png") });
});
