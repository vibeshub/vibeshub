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

test("AgentBody expands inline and renders subagent trace", async ({
  page,
}) => {
  const aid = "a0123456789abcdef";
  const subTrace = {
    trace_id: "00000000-0000-0000-0000-000000000099",
    short_id: "sub1234567",
    owner_login: "alice",
    repo_full_name: "alice/repo",
    pr_number: 1,
    pr_url: "https://github.com/alice/repo/pull/1",
    pr_title: "subagent demo",
    platform: "claude-code",
    byte_size: 0,
    message_count: 1,
    created_at: "2026-05-19T10:00:00Z",
    agent_count: 1,
    agents: [
      {
        agent_id: aid,
        tool_use_id: "toolu_01x",
        agent_type: "Explore",
        description: "d",
        message_count: 3,
      },
    ],
  };

  await page.route("**/api/traces/alice/repo/pull/1", (route) =>
    route.fulfill({ json: { traces: [subTrace] } }),
  );
  await page.route("**/api/traces/sub1234567", (route) =>
    route.fulfill({ json: subTrace }),
  );

  await page.route("**/api/traces/sub1234567/raw", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body:
        [
          '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hi"}]},"uuid":"u1","timestamp":"2026-05-19T10:00:00Z"}',
          '{"type":"assistant","timestamp":"2026-05-19T10:00:01Z","message":{"id":"m1","role":"assistant","content":[{"type":"tool_use","id":"toolu_01x","name":"Agent","input":{"description":"d","subagent_type":"Explore","prompt":"go"}}]},"uuid":"u2"}',
        ].join("\n") + "\n",
    }),
  );

  let agentFetchCount = 0;
  await page.route(
    `**/api/traces/sub1234567/agents/${aid}`,
    (route) => {
      agentFetchCount++;
      route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body:
          '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"go"}]},"timestamp":"2026-05-19T10:00:01Z","uuid":"s1"}\n' +
          '{"type":"assistant","timestamp":"2026-05-19T10:00:02Z","message":{"id":"m2","role":"assistant","content":[{"type":"text","text":"subagent done"}]},"uuid":"s2"}\n',
      });
    },
  );

  await page.goto("/alice/repo/pull/1/sub1234567");

  // Click the Agent tool card head to expand its body
  const agentToolHead = page.locator(".tool-head").first();
  await agentToolHead.waitFor();
  await agentToolHead.click();

  // The expand button only appears once the body is visible
  await page.getByRole("button", { name: /Open subagent trace/ }).click();
  await expect(page.getByText("subagent done")).toBeVisible();
  expect(agentFetchCount).toBe(1);

  // Collapse and re-expand — no second fetch (cached in component state)
  await page.getByRole("button", { name: /Hide subagent trace/ }).click();
  await page.getByRole("button", { name: /Open subagent trace/ }).click();
  await expect(page.getByText("subagent done")).toBeVisible();
  expect(agentFetchCount).toBe(1);
});
