import { test, expect } from "@playwright/test";

const trace = {
  trace_id: "00000000-0000-0000-0000-000000000001",
  short_id: "abc1234567",
  owner_login: "alice",
  repo_full_name: "alice/repo",
  pr_number: 3,
  pr_url: "https://github.com/alice/repo/pull/3",
  pr_title: "Add a feature",
  platform: "claude-code",
  byte_size: 4096,
  message_count: 12,
  created_at: "2026-05-08T00:00:00Z",
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/traces/alice/repo/pull/3", (route) =>
    route.fulfill({ json: { traces: [trace] } })
  );
  await page.route("**/api/traces/abc1234567", (route) =>
    route.fulfill({ json: trace })
  );
  await page.route(
    "**/api/traces/abc1234567/rendered",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body><h1>Rendered trace body</h1></body></html>",
      })
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

test("TraceView renders the iframe with the rendered body", async ({
  page,
}) => {
  await page.goto("/alice/repo/pull/3/abc1234567");
  await expect(page.getByText("alice/repo")).toBeVisible();

  const frame = page.frameLocator("iframe");
  await expect(frame.getByRole("heading", { name: /Rendered trace body/i })).toBeVisible();
});

test("TraceView falls back to raw JSONL when render fails", async ({ page }) => {
  await page.route("**/api/traces/abc1234567/rendered", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      json: { detail: { error: "render_failed", fallback: "raw" } },
    })
  );
  await page.route("**/api/traces/abc1234567/raw", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: '{"type":"user","message":{"role":"user","content":"hi"}}\n',
    })
  );

  await page.goto("/alice/repo/pull/3/abc1234567");
  await expect(page.getByText(/Could not render this trace/i)).toBeVisible();
  await expect(page.getByText('"type":"user"')).toBeVisible();
});
