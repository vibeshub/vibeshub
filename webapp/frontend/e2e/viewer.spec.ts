import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE = readFileSync(
  join(__dirname, "../src/tests/fixtures/sample-session.jsonl"),
  "utf-8",
);

const trace = {
  trace_id: "00000000-0000-0000-0000-000000000001",
  short_id: "abc1234567",
  owner_login: "alice",
  repo_full_name: "alice/repo",
  pr_number: 3,
  pr_url: "https://github.com/alice/repo/pull/3",
  pr_title: "Add a feature",
  platform: "claude-code",
  byte_size: SAMPLE.length,
  message_count: 100,
  created_at: "2026-05-08T00:00:00Z",
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/traces/alice/repo/pull/3", (route) =>
    route.fulfill({ json: { traces: [trace] } }),
  );
  await page.route("**/api/traces/abc1234567", (route) =>
    route.fulfill({ json: trace }),
  );
  await page.route("**/api/traces/abc1234567/raw", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: SAMPLE,
    }),
  );
});

test("PrTracesList shows the uploaded trace and links to TraceView", async ({
  page,
}) => {
  await page.goto("/alice/repo/pull/3");
  await expect(page.getByText("Add a feature")).toBeVisible();
  await page.getByRole("link", { name: /open trace/i }).click();
  await expect(page).toHaveURL(/\/alice\/repo\/pull\/3\/abc1234567$/);
});

test("TraceView renders the hero, tools chips, timeline, and thread", async ({
  page,
}) => {
  await page.goto("/alice/repo/pull/3/abc1234567");

  await expect(
    page.getByRole("heading", { name: "Add startup credential smoke-check" }),
  ).toBeVisible();

  await expect(page.locator(".tools-chips-label")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();

  await expect(
    page.getByRole("button", { name: /show reasoning/i }),
  ).toBeVisible();
});

test("clicking a tool card expands its body", async ({ page }) => {
  await page.goto("/alice/repo/pull/3/abc1234567");

  const firstToolHead = page.locator(".tool-head").first();
  await firstToolHead.waitFor();
  await firstToolHead.click();
  await expect(page.locator(".tool-card.is-open").first()).toBeVisible();
});

test("toggling Show system events surfaces system rows", async ({ page }) => {
  await page.goto("/alice/repo/pull/3/abc1234567");

  await expect(page.locator(".sys-row")).toHaveCount(0);

  await page.getByRole("button", { name: /show system events/i }).click();
  await expect(page.locator(".sys-row").first()).toBeVisible();
});
