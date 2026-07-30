import { expect, test } from "@playwright/test";

test("a settled two-character query triggers exactly one search request", async ({
  page,
}) => {
  const searchRequests: string[] = [];

  await page.route("**/api/search**", async (route) => {
    searchRequests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.goto("/search");
  await page.getByLabel("Search for a book or author").fill("ha");

  // Wait past the 300ms debounce for the request to fire.
  await page.waitForTimeout(600);

  expect(searchRequests).toHaveLength(1);
  expect(searchRequests[0]).toContain("q=ha");
});

test("a no-match search offers the manual entry form", async ({ page }) => {
  await page.route("**/api/search**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.goto("/search");
  await page.getByLabel("Search for a book or author").fill("zzzznomatch");

  await expect(page.getByLabel("Title")).toBeVisible();
});
