import { test, expect } from "@playwright/test";

const mockedUser = {
  id: "u-1",
  login: "octocat",
  name: "The Octocat",
  avatar_url: "https://avatars.githubusercontent.com/u/4242?v=4",
};

const mockedGhUser = {
  login: "octocat",
  name: "The Octocat",
  bio: null,
  avatar_url: mockedUser.avatar_url,
  html_url: "https://github.com/octocat",
  followers: 1,
  following: 0,
  public_repos: 0,
  total_public_stars: 0,
  top_languages: [],
  created_at: "2008-01-14T04:33:35Z",
  stars_truncated: false,
};

const overviewStub = {
  stats: {
    trace_count: 0, repo_count: 0, message_count: 0, byte_size: 0,
    last_trace_at: null,
  },
  traces: [],
  repos: [],
};

test("header flips between Sign in and @login + sign out", async ({ page }) => {
  // Anonymous: /api/auth/me returns 204.
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route("**/api/users/octocat", (route) =>
    route.fulfill({ json: overviewStub }),
  );
  await page.route("**/api/github/users/octocat", (route) =>
    route.fulfill({ json: mockedGhUser }),
  );

  await page.goto("/octocat");
  await expect(
    page.getByRole("link", { name: /sign in with github/i }),
  ).toBeVisible();

  // Authenticated: /api/auth/me returns the user.
  await page.unroute("**/api/auth/me");
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: mockedUser }),
  );

  await page.reload();
  await expect(page.getByRole("button", { name: /@octocat/ })).toBeVisible();

  // Sign out.
  await page.route("**/api/auth/logout", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.getByRole("button", { name: /@octocat/ }).click();
  await page.getByRole("button", { name: /sign out/i }).click();

  // After reload, /api/auth/me reverts to 204.
  await page.unroute("**/api/auth/me");
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 204 }),
  );
  await expect(
    page.getByRole("link", { name: /sign in with github/i }),
  ).toBeVisible();
});
