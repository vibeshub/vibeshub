import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE = readFileSync(
  join(__dirname, "../src/tests/fixtures/sample-session.jsonl"),
  "utf-8",
);

// iPhone 14-ish portrait.
test.use({ viewport: { width: 390, height: 844 } });

const longTitle = "Note vibeshub.ai deployment in the main README";

function trace(i: number) {
  return {
    trace_id: `00000000-0000-0000-0000-00000000000${i}`,
    short_id: `abc123456${i}`,
    owner_login: "Bhavya6187",
    repo_full_name: "vibeshub/vibeshub",
    pr_number: 80 + i,
    pr_url: `https://github.com/vibeshub/vibeshub/pull/${80 + i}`,
    pr_title: longTitle,
    platform: "claude-code",
    byte_size: 60 * 1024,
    message_count: 7,
    created_at: "2026-05-26T00:00:00Z",
  };
}

const overview = {
  stats: {
    trace_count: 71,
    pr_count: 71,
    message_count: 12345,
    contributor_count: 1,
    last_trace_at: "2026-05-26T00:00:00Z",
  },
  traces: [trace(1), trace(2), trace(3), trace(4)],
  contributors: [{ login: "Bhavya6187", trace_count: 71 }],
};

const githubRepo = {
  stargazers_count: 12,
  watchers_count: 12,
  forks_count: 2,
  open_issues_count: 3,
  primary_language: "TypeScript",
  license_spdx: "MIT",
  updated_at: "2026-05-26T00:00:00Z",
  default_branch: "main",
};

const viewerTrace = {
  ...trace(1),
  short_id: "abc1234567",
  owner_login: "alice",
  repo_full_name: "alice/repo",
  pr_number: 3,
  pr_url: "https://github.com/alice/repo/pull/3",
  pr_title: "Add a feature",
  byte_size: SAMPLE.length,
  message_count: 100,
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/repos/**", (r) => r.fulfill({ json: overview }));
  await page.route("**/api/github/repos/**", (r) =>
    r.fulfill({ json: githubRepo }),
  );
  await page.route("**/api/traces/alice/repo/pull/3", (r) =>
    r.fulfill({ json: { traces: [viewerTrace] } }),
  );
  await page.route("**/api/traces/abc1234567", (r) =>
    r.fulfill({ json: viewerTrace }),
  );
  await page.route("**/api/traces/abc1234567/raw", (r) =>
    r.fulfill({ status: 200, contentType: "text/plain", body: SAMPLE }),
  );
});

async function expectNoHScroll(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => {
    const de = document.documentElement;
    const cw = de.clientWidth;
    // An element only forces page-level overflow if it (and none of its
    // ancestors) lives inside a horizontally scrollable/clipping box.
    const inScroller = (el: Element) => {
      let p = el.parentElement;
      while (p && p !== document.body) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip")
          return true;
        p = p.parentElement;
      }
      return false;
    };
    const widest = Array.from(document.querySelectorAll("body *"))
      .map((el) => ({ el: el as HTMLElement, r: (el as HTMLElement).getBoundingClientRect() }))
      .filter((x) => x.r.right > cw + 1 && !inScroller(x.el))
      // Leaf-ish: no element child also overflows (so we report the source).
      .filter(
        (x) =>
          !Array.from(x.el.children).some(
            (c) => c.getBoundingClientRect().right > cw + 1,
          ),
      )
      .sort((a, b) => b.r.width - a.r.width)
      .slice(0, 6)
      .map((x) => {
        const ws = getComputedStyle(x.el).whiteSpace;
        const txt = (x.el.textContent || "").trim().slice(0, 40);
        return `${x.el.tagName.toLowerCase()}.${(x.el.className || "").toString().slice(0, 30)} w=${Math.round(x.r.width)} ws=${ws} "${txt}"`;
      });
    // True sources: elements whose own content overflows them (and not inside
    // a scroller) — these set the page width, vs children that merely fill it.
    const sources = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .filter(
        (el) =>
          el.scrollWidth > el.clientWidth + 1 &&
          getComputedStyle(el).overflowX === "visible" &&
          !inScroller(el),
      )
      .sort((a, b) => b.scrollWidth - a.scrollWidth)
      .slice(0, 6)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 30)} sw=${el.scrollWidth} cw=${el.clientWidth} ws=${getComputedStyle(el).whiteSpace}`,
      );
    return { scrollW: de.scrollWidth, clientW: cw, widest, sources };
  });
  expect(
    overflow.scrollW,
    `horizontal overflow; sources: ${JSON.stringify(overflow.sources)}; offenders: ${JSON.stringify(overflow.widest)}`,
  ).toBeLessThanOrEqual(overflow.clientW + 1);
}

test("landing has no horizontal overflow on mobile", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "/tmp/vh-landing.png", fullPage: true });
  await expectNoHScroll(page);
});

test("repo page has no horizontal overflow on mobile", async ({ page }) => {
  await page.goto("/alice/repo");
  await expect(page.getByText(longTitle).first()).toBeVisible();
  await page.screenshot({ path: "/tmp/vh-repo.png", fullPage: true });
  await expectNoHScroll(page);
});

test("trace viewer has no horizontal overflow on mobile", async ({ page }) => {
  await page.goto("/alice/repo/pull/3/abc1234567");
  await expect(
    page.getByRole("heading", { name: "Add startup credential smoke-check" }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/vh-trace.png", fullPage: true });
  await expectNoHScroll(page);
});
